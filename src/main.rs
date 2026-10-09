use anyhow::Context;
use log::info;
#[cfg(unix)]
use log::warn;
use alumia::cause::{Cause, Caused as _};
use alumia::cli::{Cli, Commands};
use alumia::config::{AppConfig, ListenAddr};
use alumia::server;

// jemalloc rather than glibc's malloc. Every session runs its engine on a thread of
// its own and encodes on tokio's blocking pool, and glibc gives each allocating
// thread an arena that keeps what it frees: over six motion sessions against one RDP
// target the gateway sat at 289 MB between sessions and still climbing, where
// jemalloc held 31–37 MB for the same run. Windows' heap has no such arenas.
#[cfg(not(windows))]
#[global_allocator]
static ALLOCATOR: tikv_jemallocator::Jemalloc = tikv_jemallocator::Jemalloc;

fn main() -> std::process::ExitCode {
    // Read before anything is logged: it says where the log goes, and logs
    // nothing itself.
    let cli = alumia::cli::parse();
    // Changed only where there is a hosted gateway to log elsewhere.
    #[cfg_attr(not(all(target_os = "macos", feature = "embedded-gateway")), allow(unused_mut))]
    let mut logger = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"));
    // The gateway a Mac app hosts is a service, whose standard error leads
    // nowhere a person can read: it logs to its own folder, once that folder is
    // its own (see `alumia::app::Log`).
    #[cfg(all(target_os = "macos", feature = "embedded-gateway"))]
    let log = alumia::app::Log::default();
    #[cfg(all(target_os = "macos", feature = "embedded-gateway"))]
    if matches!(cli.command, Commands::Serve { app: true, .. }) {
        logger.target(env_logger::Target::Pipe(Box::new(log.clone())));
    }
    logger.init();

    #[cfg(feature = "embedded-gateway")]
    let worker = matches!(cli.command, Commands::ServeEmbedded { .. });
    #[cfg(not(feature = "embedded-gateway"))]
    let worker = false;
    // The runtime is made here, where `#[tokio::main]` would make it, because the
    // gateway a Mac app hosts makes its own: one for the process, and one for each
    // run of the server (see `hosted`).
    #[cfg(all(target_os = "macos", feature = "embedded-gateway"))]
    let result = if matches!(cli.command, Commands::Serve { app: true, .. }) {
        hosted::serve(&log)
    } else {
        runtime().block_on(run(cli))
    };
    #[cfg(not(all(target_os = "macos", feature = "embedded-gateway")))]
    let result = runtime().block_on(run(cli));
    match result {
        Ok(()) => std::process::ExitCode::SUCCESS,
        // Whoever ran the command is told why in their own language, with the
        // error's own sentence under it (see alumia::words). A worker's words are
        // read by the panel that started it, which shows them to its own reader.
        Err(e) if worker => {
            eprintln!("{}", alumia::words::tell(&e, "AL-9800"));
            std::process::ExitCode::FAILURE
        }
        Err(e) => {
            eprintln!("{}", alumia::words::tell(&e, "AL-9400"));
            std::process::ExitCode::FAILURE
        }
    }
}

/// The runtime a command runs on, as `#[tokio::main]` builds it.
fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("failed to build the runtime")
}

async fn run(cli: Cli) -> anyhow::Result<()> {
    match cli.command {
        Commands::Serve { config, listen, .. } => {
            // The listen address is the one thing a deployment says outside the
            // file — `--listen`, or `ALUMIA_LISTEN` for a container that has an
            // environment but no argv to edit. Everything else comes from the
            // TOML file, credentials included (see src/config.rs for why). Every
            // target is served; the browser picks one after login.
            info!("alumia {}, features: {}", env!("CARGO_PKG_VERSION"), alumia::cli::features_line());
            let (file, path) = alumia::config::load(config.as_deref())?;
            info!("config: {}", path.display());
            let state_dir = alumia::config::state_dir(&path);
            let config = file.resolve_with(
                listen.as_deref(),
                &state_dir,
                &alumia::config::data_dir(path.parent().unwrap_or(std::path::Path::new(""))),
            )?;
            serve(config, &state_dir).await?;
        }
        #[cfg(feature = "embedded-gateway")]
        Commands::Tui { port, instances_dir } => {
            alumia::ensure_known!("AL-9401"; port != 0, "--port must be between 1 and 65535");
            alumia::embedded::run_tui(alumia::embedded::TuiOptions {
                port,
                instances_dir: instances_dir
                    .map(Ok)
                    .unwrap_or_else(alumia::embedded::default_instances_dir)?,
            })
            .await?;
        }
        #[cfg(feature = "embedded-gateway")]
        Commands::ServeEmbedded { instance_dir } => {
            serve_embedded(&alumia::embedded::Instance::new(instance_dir)).await?;
        }
        Commands::CheckConfig {
            config,
            #[cfg(feature = "embedded-gateway")]
            embedded,
        } => {
            // The message is the product here: an instance manager can run this for
            // its configuration editor and show stderr to somebody about to fix the
            // file. It is told as every error is (alumia::words), and the sentence
            // under the catalogue's keeps the whole `anyhow` chain, which is what
            // names the target the complaint is about.
            let text = alumia::config::read_candidate(config.as_deref())?;
            #[cfg(feature = "embedded-gateway")]
            let result = if embedded {
                alumia::embedded::check(&text)
            } else {
                alumia::config::check(&text)
            };
            #[cfg(not(feature = "embedded-gateway"))]
            let result = alumia::config::check(&text);
            if let Err(e) = result {
                eprintln!("{}", alumia::words::tell(&e, "AL-9500"));
                std::process::exit(1);
            }
        }
        Commands::GenPasswd { username } => gen_passwd(&username)?,
        #[cfg(all(target_os = "macos", feature = "embedded-gateway"))]
        Commands::App { language, asked } => {
            // What it printed is its answer, a refusal included: the app reads
            // that line, and the status says only whether it was one.
            if !alumia::app::command(asked, language.as_deref()).await {
                std::process::exit(1);
            }
        }
    }

    Ok(())
}

/// Generate the `[server].site_passwd` value: prompt for the password (hidden,
/// asked twice on a TTY; read as one line when piped) and print the encoded
/// credential to stdout, pipeable straight into the config.
fn gen_passwd(username: &str) -> anyhow::Result<()> {
    use std::io::IsTerminal as _;

    let password = if std::io::stdin().is_terminal() {
        let password = rpassword::prompt_password(alumia::words::say("prompt.password", &[]))?;
        let confirm = rpassword::prompt_password(alumia::words::say("prompt.confirm", &[]))?;
        alumia::ensure_known!("AL-9402"; password == confirm, "passwords do not match");
        password
    } else {
        let mut line = String::new();
        std::io::stdin().read_line(&mut line)?;
        line.trim_end_matches(['\r', '\n']).to_owned()
    };
    let encoded = alumia::auth::generate(username, &password, alumia::auth::DEFAULT_COST)?;
    println!("{encoded}");
    Ok(())
}

/// Run a managed embedded gateway, and stop when its parent does.
///
/// Three ways out, and the first is the one the guarantee rests on: the parent's
/// end of our stdin closing, which happens however the parent ended — see
/// [`alumia::embedded::parent_closed`]. The signal handler is for a run started by
/// hand, and the server arm only completes by failing.
#[cfg(feature = "embedded-gateway")]
async fn serve_embedded(instance: &alumia::embedded::Instance) -> anyhow::Result<()> {
    // As in `serve`.
    #[cfg(target_os = "macos")]
    let _displays = alumia::mac_displays::ReleaseOnExit;
    // Ahead of the race below, because asking for the claim can wait, and waiting
    // is what `serve` must not do before it has refused.
    let claim = instance.claim().await?;
    tokio::select! {
        // In order, and the order is the point. `serve` reads and checks the config
        // before its first `await`, so it is ready with a refusal on the very first
        // poll — while `parent_closed` can be ready on *its* first poll too, when
        // the reading thread gets to an already-closed stdin before this one gets
        // back from `spawn`. Under the unbiased default the two race, and the arm
        // that wins decides whether a refused config is reported at all: `[server]`
        // in the file, and one run in five exits 0 with nothing on stderr.
        biased;
        result = alumia::embedded::serve(instance, claim) => result?,
        _ = alumia::embedded::parent_closed() => {
            info!("stdin closed: whatever started this gateway is gone; stopping");
        }
        _ = shutdown_signal() => info!("shutdown signal received; stopping"),
    }
    Ok(())
}

/// BETA: read the software HEVC decoder the config resolved to, before the
/// gateway listens, so an archive it cannot serve is a refused start.
fn load_hevc_decoder(config: &AppConfig) -> anyhow::Result<Option<alumia::hevc_wasm::HevcDecoder>> {
    let Some(archive) = &config.hevc_wasm else {
        return Ok(None);
    };
    let decoder = alumia::hevc_wasm::HevcDecoder::load(archive)?;
    info!(
        "serving the software HEVC decoder hevc-wasm v{} from {}",
        alumia::hevc_wasm::VERSION,
        archive.display()
    );
    Ok(Some(decoder))
}

/// Serve `config`. `state_dir` is where the gateway keeps what outlives it: the
/// `[meter]` database the config already resolved there, and the kept logins.
async fn serve(config: AppConfig, state_dir: &std::path::Path) -> anyhow::Result<()> {
    // Gives back a built-in display the gateway turned off, however it stops.
    #[cfg(target_os = "macos")]
    let _displays = alumia::mac_displays::ReleaseOnExit;
    let (mut opened, ()) = open(&config, state_dir, |config, logins, throughput, hevc_decoder| {
        (server::router_with_logins(config, logins, throughput, hevc_decoder), ())
    })
    .await?;

    // Race the servers against an explicit shutdown signal. Relying on the OS
    // default SIGINT disposition to terminate proved flaky on macOS — Ctrl+C
    // was intermittently ignored while a detached engine thread was still
    // running, forcing a SIGKILL. An installed handler makes it deterministic.
    tokio::select! {
        // The first server to *finish* has failed — `axum::serve` only returns on
        // error — so it is reported rather than waited on for the others.
        Some(result) = opened.servers.join_next() => finished(result)?,
        _ = shutdown_signal() => info!("shutdown signal received; stopping"),
    }
    Ok(())
}

/// Why a server that finished did.
fn finished(result: Result<std::io::Result<()>, tokio::task::JoinError>) -> anyhow::Result<()> {
    result.context("the server task panicked")?.context("server error")
}

/// The servers of one gateway, listening: one for each socket, over one router.
struct Opened {
    servers: tokio::task::JoinSet<std::io::Result<()>>,
    /// Takes the socket file away when the gateway stops, by any way out. `None`
    /// for TCP, which leaves nothing behind to clean up.
    #[cfg(unix)]
    _socket_file: Option<SocketFile>,
}

/// Open everything `config` serves, and listen. `router` builds the router over
/// what was opened for it, and may hand back something of its own beside it: the
/// gateway a Mac app hosts keeps the session slot ([`server::router_for_host`]).
async fn open<Kept>(
    config: &AppConfig,
    state_dir: &std::path::Path,
    router: impl FnOnce(
        AppConfig,
        alumia::auth::AuthSessions,
        alumia::throughput::Throughput,
        Option<alumia::hevc_wasm::HevcDecoder>,
    ) -> (axum::Router, Kept),
) -> anyhow::Result<(Opened, Kept)> {
    if let Some(recording) = &config.meter {
        info!("recording websocket throughput to {}", recording.database.display());
    }
    let throughput = alumia::throughput::start(
        config.meter.as_ref(),
        config.targets.iter().map(|target| target.name.clone()).collect(),
    )
        .context("cannot record websocket throughput ([meter].database)")
        .cause(|| Cause::new("AL-9403"))?;
    let hevc_decoder = load_hevc_decoder(config)?;
    config.hp_decoders.load()?;
    let logins = match config.auth.login() {
        Some(site_passwd) => {
            let kept = state_dir.join(alumia::auth::LOGINS_FILE);
            info!("kept logins: {}", kept.display());
            alumia::auth::AuthSessions::open(&kept, site_passwd)
        }
        // A gateway with no login mints no session.
        None => alumia::auth::AuthSessions::default(),
    };
    let (app, kept) = router(config.clone(), logins, throughput, hevc_decoder);

    // One server per listener over the same router — `Router` is `Clone`, and the
    // session slot behind it is a single `Arc`, so which socket a browser arrived on
    // is invisible from here. That matters: two listeners are two doors to one
    // gateway, not two gateways.
    let mut servers = tokio::task::JoinSet::new();
    #[cfg(unix)]
    let mut socket_file = None;

    match &config.listen {
        ListenAddr::Tcp(addr) => {
            // **Every** address the host resolves to, not the first one.
            //
            // `listen = "localhost:52380"` is the case that made this necessary: it
            // resolves to both `::1` and `127.0.0.1`, `TcpListener::bind` takes
            // whichever the resolver returned first (on macOS, `::1`), and the other
            // loopback is then simply refused. The startup line said `listening on
            // http://localhost:52675`, which is exactly the wrong thing to print when
            // only half of localhost answers — a client resolving `localhost` to
            // `127.0.0.1` was refused, and nothing in the log hinted why.
            //
            // Binding each of them is also what makes "both loopbacks" expressible at
            // all. `::` would reach `127.0.0.1` too — `bind_all` binds the wildcard
            // as `[::]` and `0.0.0.0` on every platform, Windows included — but that
            // is every interface on the machine, which is not what somebody asking
            // for localhost is asking for.
            //
            // A literal is unaffected: `127.0.0.1`, `::1` and `0.0.0.0` each resolve
            // to themselves and bind exactly one socket, as before.
            let listeners = server::bind_all(&resolved_addrs(addr).await?, addr)
                .cause(|| Cause::new("AL-9411").with("address", addr))?;
            for listener in &listeners {
                if let Ok(socket) = listener.local_addr() {
                    info!("listening on http://{socket}");
                }
            }
            for listener in listeners {
                // `bind_all` takes the sockets synchronously so the all-or-nothing
                // check needs no runtime and is testable on its own; tokio wants them
                // non-blocking before it will drive them.
                listener
                    .set_nonblocking(true)
                    .context("cannot make a listening socket non-blocking")?;
                let listener = tokio::net::TcpListener::from_std(listener)
                    .context("cannot hand a listening socket to the runtime")?;
                servers.spawn(
                    axum::serve(server::NodelayListener(listener), app.clone()).into_future(),
                );
            }
        }
        #[cfg(unix)]
        ListenAddr::Unix(path) => {
            let listener = bind_unix(path)?;
            // Armed the moment the socket exists, so every way out from here on
            // takes it away with it.
            socket_file = Some(SocketFile(path.clone()));
            info!("listening on unix:{}", path.display());
            listener
                .set_nonblocking(true)
                .context("cannot make the listening socket non-blocking")?;
            let listener = tokio::net::UnixListener::from_std(listener)
                .context("cannot hand the listening socket to the runtime")?;
            // No `NodelayListener`: Nagle is a TCP algorithm, and a Unix socket has
            // none of it to switch off.
            servers.spawn(axum::serve(listener, app.clone()).into_future());
        }
        // `parse_listen` refuses `unix:` before anything is bound where there are no
        // Unix sockets; the arm is for the compiler, not for a reachable state.
        #[cfg(not(unix))]
        ListenAddr::Unix(path) => alumia::bail_known!(
            "AL-9550", path = path.display();
            "unix:{} — Unix sockets are not supported on Windows",
            path.display()
        ),
        // Only `resolve_embedded` names a pipe, and `serve-embedded` serves it.
        #[cfg(all(feature = "embedded-gateway", windows))]
        ListenAddr::Pipe(name) => {
            alumia::bail_known!("AL-9404", name = name; "{name} is an embedded worker's private pipe")
        }
    }

    info!("{} target(s) available in the post-login picker:", config.targets.len());
    for target in &config.targets {
        info!(
            "  target {:?}: {}:{} ({:?})",
            target.name, target.host, target.port, target.protocol
        );
    }
    if let Some(site_passwd) = config.auth.login() {
        info!("web login: user {:?}", site_passwd.username());
    }

    let opened = Opened {
        servers,
        #[cfg(unix)]
        _socket_file: socket_file,
    };
    Ok((opened, kept))
}

/// The gateway a Mac app hosts, `serve --app`: see [`alumia::app`].
#[cfg(all(target_os = "macos", feature = "embedded-gateway"))]
mod hosted {
    use std::path::Path;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use anyhow::Context as _;

    use alumia::app::{self, Serving};
    use alumia::server::{self, Neighbours};
    use alumia::session::{HostEnd, SessionManager};

    /// One run of the server with the settings as they were read, on a runtime of
    /// its own: ending the runtime is ending everything the run started, its
    /// tasks, its connections and its recorder, with nothing to track one by one.
    struct Generation {
        runtime: Mutex<Option<tokio::runtime::Runtime>>,
        opened: tokio::sync::Mutex<Option<super::Opened>>,
        sessions: Arc<SessionManager>,
        /// The computers' names, in the settings' order: the session slot says
        /// which is open by its place among them.
        computers: Vec<String>,
        listen: String,
    }

    impl Generation {
        /// Read the settings in `dir` and serve them.
        fn start(dir: &Path, neighbours: Neighbours) -> anyhow::Result<Self> {
            // Whoever asks for a run is a task of the process's runtime, and this
            // blocks: on the files, and on the run's own runtime while it binds.
            tokio::task::block_in_place(|| {
                let path = app::settings_path(dir);
                alumia::ensure_known!("AL-9901"; path.exists(), "no settings yet at {}", path.display());
                let (file, _) = alumia::config::load(Some(&path))?;
                let config = file.resolve_with(None, dir, &alumia::config::data_dir(dir))?;
                let runtime =
                    tokio::runtime::Runtime::new().context("cannot start a runtime for the server")?;
                let (opened, sessions) =
                    runtime.block_on(super::open(&config, dir, |config, logins, throughput, hevc_decoder| {
                        server::router_for_host(config, logins, throughput, hevc_decoder, neighbours)
                    }))?;
                Ok(Self {
                    runtime: Mutex::new(Some(runtime)),
                    opened: tokio::sync::Mutex::new(Some(opened)),
                    sessions,
                    computers: config.targets.iter().map(|target| target.name.clone()).collect(),
                    listen: config.listen.to_string(),
                })
            })
        }
    }

    impl Serving for Generation {
        fn listen(&self) -> String {
            self.listen.clone()
        }

        fn session(&self) -> Option<String> {
            self.sessions.selected_target().and_then(|at| self.computers.get(at).cloned())
        }

        async fn end_session(&self, why: HostEnd) -> bool {
            self.sessions.end_from_host(why).await
        }

        async fn failed(&self) -> anyhow::Error {
            let mut opened = self.opened.lock().await;
            let Some(opened) = opened.as_mut() else {
                return std::future::pending().await;
            };
            while let Some(result) = opened.servers.join_next().await {
                if let Err(error) = super::finished(result) {
                    return error;
                }
            }
            std::future::pending().await
        }

        async fn end(&self, grace: Duration) {
            // The listening sockets first, and waited for: the next run binds the
            // same ones.
            if let Some(mut opened) = self.opened.lock().await.take() {
                opened.servers.shutdown().await;
            }
            let runtime = self.runtime.lock().unwrap().take();
            if let Some(runtime) = runtime {
                tokio::task::block_in_place(|| runtime.shutdown_timeout(grace));
            }
        }
    }

    /// Host the gateway of the app's folder until the process is told to stop.
    /// `log` is where this process logs, which the folder takes once it is this
    /// gateway's ([`app::host`]).
    pub fn serve(log: &app::Log) -> anyhow::Result<()> {
        let dir = app::dir()?;
        super::runtime().block_on(async {
            let neighbours = app::neighbours(app::bundle(), app::DISCOVERY_LIMIT, app::DISCOVERY_KEPT);
            let start = || Generation::start(&dir, Arc::clone(&neighbours));
            // What the process holds whatever run is serving: a built-in display it
            // turned off is given back when the process stops, and not when its
            // settings change.
            let held = alumia::mac_displays::ReleaseOnExit;
            app::host(&dir, start, super::shutdown_signal(), held, log).await
        })
    }
}

/// The socket file, removed when the gateway stops.
///
/// A `Drop` rather than a line at the end of `serve`, because the ways out include
/// a server that failed and a `?` on the way there. It cannot cover a `SIGKILL` — a
/// socket file outlives the process that made it — which is why [`bind_unix`] has to
/// tell a leftover from a live one rather than assume the file is always ours.
#[cfg(unix)]
struct SocketFile(std::path::PathBuf);

#[cfg(unix)]
impl Drop for SocketFile {
    fn drop(&mut self) {
        // A socket that is already gone is the outcome this wanted, not a failure:
        // an operator can remove it by hand, and saying so on the way out would be
        // a warning about nothing.
        match std::fs::remove_file(&self.0) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => warn!("cannot remove the socket {}: {e}", self.0.display()),
        }
    }
}

/// Take the Unix socket, replacing a leftover from a gateway that was killed but
/// never one that is still being served.
///
/// The difference is asked of the socket itself: a listener that is gone refuses a
/// connection, and one that is there accepts it. A bare `remove_file` before binding
/// would be the same mistake in file form that a preflight port probe is in socket
/// form — it would quietly evict a running gateway, whose clients then hold sockets
/// to a path nothing can be reached at again.
///
/// The mode is `0o660` rather than whatever the umask leaves: the reason to be on a
/// socket at all is that the filesystem decides who may connect, and world-writable
/// is not a decision. Owner and group, so a proxy sharing the group can reach it —
/// which is what the directory it lives in should be arranged around.
#[cfg(unix)]
fn bind_unix(path: &std::path::Path) -> anyhow::Result<std::os::unix::net::UnixListener> {
    use std::os::unix::fs::PermissionsExt as _;
    use std::os::unix::net::{UnixListener, UnixStream};

    let listener = match UnixListener::bind(path) {
        Ok(listener) => listener,
        Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
            alumia::ensure_known!(
                "AL-9405", path = path.display();
                UnixStream::connect(path).is_err(),
                "{} is already being served by another process",
                path.display()
            );
            warn!("replacing the leftover socket {}", path.display());
            std::fs::remove_file(path)
                .with_context(|| format!("cannot remove the leftover socket {}", path.display()))
                .cause(|| Cause::new("AL-9406").with("path", path.display()))?;
            UnixListener::bind(path).map_err(|e| unix_bind_error(path, e))?
        }
        Err(e) => return Err(unix_bind_error(path, e)),
    };
    // After the bind, because there is no bind that takes a mode. The window is the
    // few microseconds between the two lines, and what is behind it is a gateway
    // that still asks for a login.
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o660))
        .with_context(|| format!("cannot set the mode of {}", path.display()))
        .cause(|| Cause::new("AL-9407").with("path", path.display()))?;
    Ok(listener)
}

/// Why the socket could not be taken, with the length said out loud when that is
/// what it was.
///
/// A socket address is a fixed-size field in the kernel — 104 bytes on macOS, 108
/// on Linux — so a path under a long directory fails with `InvalidInput` and, from
/// the standard library, the words "path must be shorter than SUN_LEN". That is a
/// limit somebody hits by keeping the socket beside the config in a deep home
/// directory, and it is worth one sentence rather than a search.
#[cfg(unix)]
fn unix_bind_error(path: &std::path::Path, e: std::io::Error) -> anyhow::Error {
    let hint = if e.kind() == std::io::ErrorKind::InvalidInput {
        format!(
            " (this path is {} bytes, and a socket address holds about 100 — \
             put the socket somewhere shorter, such as /tmp/alumia.sock)",
            path.as_os_str().len()
        )
    } else {
        String::new()
    };
    Cause::new("AL-9408")
        .with("path", path.display())
        .of(anyhow::Error::new(e).context(format!("cannot listen on unix:{}{hint}", path.display())))
}

/// Every socket address `addr` names, in the resolver's order and without
/// duplicates.
///
/// Deduplicated because a name can resolve to the same address twice — `localhost`
/// does on a machine with both an `/etc/hosts` entry and a DNS answer — and two
/// binds of one address is a spurious "address already in use" against ourselves.
async fn resolved_addrs(addr: &str) -> anyhow::Result<Vec<std::net::SocketAddr>> {
    let mut seen = Vec::new();
    for socket in tokio::net::lookup_host(addr)
        .await
        .with_context(|| format!("cannot resolve {addr}"))
        .cause(|| Cause::new("AL-9409").with("address", addr))?
    {
        if !seen.contains(&socket) {
            seen.push(socket);
        }
    }
    alumia::ensure_known!("AL-9410", address = addr; !seen.is_empty(), "{addr} resolves to no address at all");
    Ok(seen)
}

/// Resolve when the process is asked to stop: Ctrl+C (SIGINT) on any platform,
/// or SIGTERM under a service manager on Unix. The engine threads are detached
/// and hold no state worth draining (a dropped remote session just reconnects),
/// so returning from `main` — which exits the process and reaps them — is the
/// whole shutdown: no graceful HTTP drain that a lingering WebSocket could hang.
async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install the Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install the SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {}
        _ = terminate => {}
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    /// The socket is created with a mode the filesystem can act on, which is the
    /// only reason to prefer one to a loopback port.
    #[test]
    fn a_unix_socket_is_bound_owner_and_group_only() {
        use std::os::unix::fs::PermissionsExt as _;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("gateway.sock");
        let listener = bind_unix(&path).expect("a fresh path binds");

        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o660, "owner and group, and nobody else");
        assert!(
            std::os::unix::net::UnixStream::connect(&path).is_ok(),
            "and it is a socket something can reach"
        );
        drop(listener);
    }

    /// A gateway that was killed leaves its socket file behind. The next start
    /// takes it over — it is the same address, and refusing would need somebody to
    /// delete a file by hand before the service could come back.
    #[test]
    fn a_leftover_socket_is_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("gateway.sock");

        // Bound and dropped without the `SocketFile` guard: exactly what a `SIGKILL`
        // leaves on disk.
        drop(std::os::unix::net::UnixListener::bind(&path).unwrap());
        assert!(path.exists(), "the file outlives the listener");

        let listener = bind_unix(&path).expect("a leftover is not a reason to refuse");
        assert!(std::os::unix::net::UnixStream::connect(&path).is_ok());
        drop(listener);
    }

    /// ...but a socket something is still serving is not a leftover, and taking it
    /// would evict a running gateway whose clients could never reach it again.
    #[test]
    fn a_socket_that_is_still_served_refuses_the_start() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("gateway.sock");
        let live = std::os::unix::net::UnixListener::bind(&path).unwrap();

        let err = bind_unix(&path).expect_err("something is already serving it");
        let text = format!("{err:#}");
        assert!(text.contains("already being served"), "{text}");
        assert!(text.contains("gateway.sock"), "it must name the socket: {text}");

        // And the live one still answers: the refusal took nothing away.
        assert!(std::os::unix::net::UnixStream::connect(&path).is_ok());
        drop(live);
    }

    /// The socket file goes when the gateway does, so the next start is an ordinary
    /// one rather than a takeover.
    #[test]
    fn stopping_removes_the_socket_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("gateway.sock");
        let listener = bind_unix(&path).unwrap();

        let guard = SocketFile(path.clone());
        drop(guard);
        drop(listener);
        assert!(!path.exists(), "a stopped gateway leaves no socket behind");
    }
}
