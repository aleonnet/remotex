//! End-to-end tests of the gateway a Mac app hosts, `alumia serve --app`, and of
//! what the app asks of it (`alumia app …`).
//!
//! The real binary, started the way the app's service starts it, in a scratch
//! folder: what is under test is a property of the *process*. That it stays the
//! same process when its settings change, and when it cannot serve; that its
//! control socket is its owner's; that a session it ends is told why. None of
//! that can be seen from a router built in-process.
//!
//! `ALUMIA_TEST_BINARY` names another binary to run the same cases against: the
//! one inside the app's bundle, built as it ships, which aborts on a panic where
//! Cargo's unwinds.
//!
//! No test here waits out one of the gateway's own delays: it asks for the reload
//! instead of waiting for the retry.
#![cfg(target_os = "macos")]

mod common;

use std::io::Write as _;
use std::net::SocketAddr;
use std::os::unix::fs::{FileTypeExt as _, PermissionsExt as _};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use futures_util::{SinkExt as _, StreamExt as _};
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio_tungstenite::tungstenite::Message;

use common::Ws;

/// The binary under test.
fn binary() -> PathBuf {
    std::env::var_os("ALUMIA_TEST_BINARY").map_or_else(|| PathBuf::from(env!("CARGO_BIN_EXE_alumia")), PathBuf::from)
}

/// The binary, told where the app's folder and bundle are, and with a terminal of
/// no language unless a test gives it one.
fn alumia(dir: &Path, bundle: &Path) -> Command {
    let mut command = Command::new(binary());
    command
        .env("ALUMIA_APP_DIR", dir)
        .env("ALUMIA_APP_BUNDLE", bundle)
        .env_remove("LC_ALL")
        .env_remove("LC_MESSAGES")
        .env_remove("LANG");
    command
}

/// Held while a socket of this file's is made, and while a process is started.
///
/// macOS has no way to make a socket that a new process does not inherit: the
/// standard library makes the socket and marks it in two calls, and a process
/// another test starts between the two inherits it. That process, a gateway that
/// lives for the whole of its test, then holds the port the socket is given
/// after its test has let go of it, and the gateway that port was meant for is
/// refused it: `127.0.0.1:24163 is already in use`, measured, one run in twenty
/// with the tests side by side. The two never overlap under this lock.
static STARTING: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Start `command`, which inherits no socket a test is making ([`STARTING`]).
fn started(command: &mut Command) -> Child {
    let _alone = STARTING.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    command.spawn().expect("the gateway binary must be built")
}

/// Run `command` to its end, with nothing on its input, and what it wrote.
fn ran(command: &mut Command) -> std::process::Output {
    started(command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped())).wait_with_output().unwrap()
}

/// Listen on a port no test of this file was given before, and that the system
/// gives nobody by itself.
///
/// The tests run side by side and each lets go of ports it means to use again: a
/// gateway is told to move to one, or stops and starts on its own. A port asked
/// of the system (`:0`) is one that is free at that instant, so a test could be
/// handed the port another had just let go of and was about to take back, even
/// for the moment it takes to look at it. So the ports are counted out here
/// instead, each once for the life of the run, from below the range the system
/// picks from (49152 and up), starting where this process's number puts it; one
/// somebody else on the machine holds is passed over.
fn own_listener() -> std::net::TcpListener {
    const FIRST: u32 = 20_000;
    const SPAN: u32 = 20_000;
    static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let start = std::process::id() % SPAN;
    let _alone = STARTING.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    loop {
        let step = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        assert!(step < SPAN, "no port left to give");
        let port = (FIRST + (start + step) % SPAN) as u16;
        if let Ok(listener) = std::net::TcpListener::bind(("127.0.0.1", port)) {
            return listener;
        }
    }
}

/// A port nothing listens on, found by taking one and letting it go.
fn free_port() -> u16 {
    own_listener().local_addr().unwrap().port()
}

fn local(port: u16) -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], port))
}

/// Settings that serve the page at `port`, signed in to with the tests' login,
/// with one computer: a VNC server at `vnc`.
fn settings(port: u16, vnc: u16) -> String {
    let credential = alumia::auth::generate(common::TEST_USER, common::TEST_PASSWORD, 4).unwrap();
    format!(
        "[server]\nlisten = \"127.0.0.1:{port}\"\nsite_passwd = \"{credential}\"\n\n\
         [[targets]]\nname = \"fake\"\nprotocol = \"vnc\"\nhost = \"127.0.0.1\"\nport = {vnc}\n"
    )
}

/// The gateway, hosted in a scratch folder as the app's service hosts it.
struct Hosted {
    child: Child,
    dir: common::ScratchDir,
    bundle: common::ScratchDir,
}

impl Drop for Hosted {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Hosted {
    /// Start it with `settings` in its folder, or with none, and wait until it
    /// answers on its control socket.
    fn start(settings: Option<&str>) -> Self {
        Self::start_beside(settings, common::ScratchDir::new("app-bundle"))
    }

    /// The same, with `bundle` for the app's.
    fn start_beside(settings: Option<&str>, bundle: common::ScratchDir) -> Self {
        let dir = common::ScratchDir::new("app");
        if let Some(settings) = settings {
            dir.write("alumia.toml", settings);
        }
        // What it says before the folder is its own, and whatever it says past
        // its log: the log itself is the gateway's to keep, in the folder.
        let said = std::fs::File::create(bundle.path().join("stderr.log")).unwrap();
        let child = started(
            alumia(dir.path(), bundle.path())
                .args(["serve", "--app"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(said),
        );
        let mut hosted = Self { child, dir, bundle };
        let deadline = Instant::now() + Duration::from_secs(20);
        while !hosted.dir.path().join("control.sock").exists() || !hosted.settled() {
            assert!(hosted.alive(), "it stopped before it answered:\n{}", hosted.log());
            assert!(Instant::now() < deadline, "it never answered:\n{}", hosted.log());
            std::thread::sleep(Duration::from_millis(25));
        }
        hosted
    }

    /// Whether it answers, and has tried its first server: its control socket
    /// answers from before that, saying neither that it serves nor why not, and a
    /// test that went on from there would find the page's port not yet open.
    fn settled(&self) -> bool {
        let (answered, status) = self.asks(&["status"]);
        answered && (status["serving"] == true || status["stopped"] == true || !status["cause"].is_null())
    }

    /// The gateway's own log, as it keeps it in its folder.
    fn kept_log(&self) -> String {
        std::fs::read_to_string(self.dir.path().join("gateway.log")).unwrap_or_default()
    }

    /// Everything it said, for a failure to show: its standard error, then its log.
    fn log(&self) -> String {
        let said = std::fs::read_to_string(self.bundle.path().join("stderr.log")).unwrap_or_default();
        format!("{said}{}", self.kept_log())
    }

    /// Whether it is still the process that was started: the same one, never
    /// another in its place, since nothing here starts a second.
    fn alive(&mut self) -> bool {
        self.child.try_wait().unwrap().is_none()
    }

    /// Run `alumia app <args>` as the app runs it: whether it was answered, and
    /// the one line of JSON it printed.
    fn asks(&self, args: &[&str]) -> (bool, serde_json::Value) {
        self.asks_with(args, "")
    }

    fn asks_with(&self, args: &[&str], stdin: &str) -> (bool, serde_json::Value) {
        asked(self.dir.path(), self.bundle.path(), args, stdin)
    }

    fn status(&self) -> serde_json::Value {
        let (answered, status) = self.asks(&["status"]);
        assert!(answered, "{status}\n{}", self.log());
        status
    }

    /// Change the settings and have the gateway take them.
    fn change(&self, change: &str) {
        let (applied, said) = self.asks_with(&["config-apply"], change);
        assert!(applied, "{said}");
        let (answered, said) = self.asks(&["reload"]);
        assert!(answered, "{said}");
        assert_eq!(said, serde_json::json!({ "reloaded": true }));
    }
}

fn asked(dir: &Path, bundle: &Path, args: &[&str], stdin: &str) -> (bool, serde_json::Value) {
    let mut child = started(
        alumia(dir, bundle)
            .arg("app")
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped()),
    );
    child.stdin.take().unwrap().write_all(stdin.as_bytes()).unwrap();
    let output = child.wait_with_output().unwrap();
    let printed = String::from_utf8_lossy(&output.stdout);
    let line = printed.trim_end();
    assert_eq!(line.lines().count(), 1, "one line of JSON, not {printed:?} and {:?}", String::from_utf8_lossy(&output.stderr));
    let said = serde_json::from_str(line).unwrap_or_else(|error| panic!("not JSON ({error}): {line}"));
    (output.status.success(), said)
}

async fn get(addr: SocketAddr, path: &str, cookie: Option<&str>) -> (u16, String) {
    let cookie = cookie.map(|cookie| format!("Cookie: {cookie}\r\n")).unwrap_or_default();
    let request = format!("GET {path} HTTP/1.1\r\nHost: {addr}\r\n{cookie}Connection: close\r\n\r\n");
    let (status, _head, body) = common::http_request(addr, &request).await;
    (status, body)
}

/// A VNC server that offers a desktop of a few pixels and sends it once: enough
/// for a session to open and stay open.
async fn fake_vnc() -> u16 {
    let listener = own_listener();
    listener.set_nonblocking(true).unwrap();
    let listener = tokio::net::TcpListener::from_std(listener).unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            tokio::spawn(async move {
                let _ = serve_fake_vnc(stream).await;
            });
        }
    });
    port
}

async fn serve_fake_vnc(mut stream: tokio::net::TcpStream) -> std::io::Result<()> {
    const SIDE: u16 = 16;

    // Version, security (None), ClientInit and ServerInit.
    stream.write_all(b"RFB 003.008\n").await?;
    stream.read_exact(&mut [0u8; 12]).await?;
    stream.write_all(&[1, 1]).await?;
    stream.read_exact(&mut [0u8; 1]).await?;
    stream.write_all(&0u32.to_be_bytes()).await?;
    stream.read_exact(&mut [0u8; 1]).await?;
    let mut server_init = Vec::new();
    server_init.extend_from_slice(&SIDE.to_be_bytes());
    server_init.extend_from_slice(&SIDE.to_be_bytes());
    server_init.extend_from_slice(&[0u8; 16]);
    server_init.extend_from_slice(&4u32.to_be_bytes());
    server_init.extend_from_slice(b"fake");
    stream.write_all(&server_init).await?;

    loop {
        let mut kind = [0u8; 1];
        stream.read_exact(&mut kind).await?;
        match kind[0] {
            // SetPixelFormat
            0 => stream.read_exact(&mut [0u8; 19]).await.map(drop)?,
            // SetEncodings
            2 => {
                let mut head = [0u8; 3];
                stream.read_exact(&mut head).await?;
                let count = usize::from(u16::from_be_bytes([head[1], head[2]]));
                stream.read_exact(&mut vec![0u8; count * 4]).await?;
            }
            // FramebufferUpdateRequest: the whole desktop once, raw, and nothing
            // for an incremental one.
            3 => {
                let mut request = [0u8; 9];
                stream.read_exact(&mut request).await?;
                if request[0] == 0 {
                    let mut update = vec![0u8, 0];
                    update.extend_from_slice(&1u16.to_be_bytes());
                    update.extend_from_slice(&[0u8; 4]);
                    update.extend_from_slice(&SIDE.to_be_bytes());
                    update.extend_from_slice(&SIDE.to_be_bytes());
                    update.extend_from_slice(&0i32.to_be_bytes());
                    update.extend_from_slice(&vec![0x40u8; usize::from(SIDE) * usize::from(SIDE) * 4]);
                    stream.write_all(&update).await?;
                }
            }
            // KeyEvent, PointerEvent
            4 => stream.read_exact(&mut [0u8; 7]).await.map(drop)?,
            5 => stream.read_exact(&mut [0u8; 5]).await.map(drop)?,
            // ClientCutText
            6 => {
                let mut head = [0u8; 7];
                stream.read_exact(&mut head).await?;
                let length = u32::from_be_bytes([head[3], head[4], head[5], head[6]]);
                stream.read_exact(&mut vec![0u8; length as usize]).await?;
            }
            other => return Err(std::io::Error::other(format!("unexpected message type {other}"))),
        }
    }
}

/// What the session socket carries next, as a browser takes it: each control
/// message is handed to `wanted` until it says this is the one. The session
/// socket alone, and not the display's beside it: what a host says of a session
/// it ends is said there, and the display's socket ends with the generation it
/// was opened on, with no word of its own.
async fn next(ws: &mut Ws, what: &str, wanted: impl Fn(&serde_json::Value) -> bool) -> serde_json::Value {
    tokio::time::timeout(Duration::from_secs(20), async {
        while let Some(message) = ws.session_socket().next().await {
            match message.unwrap_or_else(|error| panic!("the socket failed while waiting for {what}: {error}")) {
                Message::Text(text) => {
                    let control: serde_json::Value = serde_json::from_str(&text).unwrap();
                    if wanted(&control) {
                        return control;
                    }
                }
                Message::Close(frame) => panic!("closed while waiting for {what}: {frame:?}"),
                _ => {}
            }
        }
        panic!("the socket ended while waiting for {what}");
    })
    .await
    .unwrap_or_else(|_| panic!("timed out waiting for {what}"))
}

async fn control(ws: &mut Ws, kind: &'static str) -> serde_json::Value {
    next(ws, kind, |control| control["type"] == kind).await
}

/// The first picture of the session, acknowledged: the desktop is open.
async fn picture(ws: &mut Ws) {
    tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            match ws.next().await.expect("a picture before the socket ends").unwrap() {
                Message::Binary(frame) => {
                    ws.send(Message::text(common::paint_ack(&frame))).await.unwrap();
                    return;
                }
                Message::Text(text) => assert!(!text.contains(r#""type":"error""#), "the session failed: {text}"),
                Message::Close(frame) => panic!("closed while waiting for the first picture: {frame:?}"),
                // The socket's own heartbeat.
                _ => {}
            }
        }
    })
    .await
    .expect("timed out waiting for the first picture");
}

/// Sign in, take the session and open the computer `fake`.
async fn open_session(port: u16) -> Ws {
    let addr = local(port);
    let cookie = common::login(addr).await;
    let token = common::claim_session(addr, &cookie).await;
    let mut ws = common::connect_ws(addr, &token, &cookie).await;
    control(&mut ws, "picker").await;
    common::connect_target(&mut ws, "fake").await;
    assert_eq!(control(&mut ws, "connected").await["name"], "fake");
    picture(&mut ws).await;
    ws
}

/// Every error a command writes is told first in the language of whoever runs it,
/// by the catalogue's sentence with its code, with the gateway's own sentence
/// under it.
#[test]
fn the_terminal_says_the_cause_in_the_persons_language() {
    let nowhere = Path::new("/nonexistent");
    let checked = |language: Option<(&str, &str)>| {
        let mut command = alumia(nowhere, nowhere);
        if let Some((variable, value)) = language {
            command.env(variable, value);
        }
        let mut child = started(
            command.arg("check-config").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()),
        );
        let config = "[[targets]]\nname = \"sala\"\nprotocol = \"rdp\"\nhost = \"\"\n";
        child.stdin.take().unwrap().write_all(config.as_bytes()).unwrap();
        let output = child.wait_with_output().unwrap();
        assert_eq!(output.status.code(), Some(1));
        assert!(output.stdout.is_empty());
        String::from_utf8(output.stderr).unwrap()
    };
    let own = "target \"sala\" has an empty host";
    for portuguese in [("LANG", "pt_BR.UTF-8"), ("LC_ALL", "pt_PT"), ("LC_MESSAGES", "pt_BR")] {
        let said = checked(Some(portuguese));
        let mut lines = said.lines();
        assert_eq!(
            lines.next(),
            Some("O computador sala está com o endereço vazio. Preencha host. (AL-9520)"),
            "{portuguese:?}: {said}"
        );
        assert!(lines.next().is_some_and(|line| line.trim_end().ends_with(own)), "its own sentence under it: {said}");
    }
    for english in [Some(("LANG", "en_US.UTF-8")), Some(("LANG", "C")), None] {
        let said = checked(english);
        assert!(
            said.starts_with("The computer sala has an empty address. Fill in host. (AL-9520)\n"),
            "{english:?}: {said}"
        );
        assert!(said.contains(own), "{said}");
    }

    // And a command that fails, not only a configuration that is checked.
    let served = ran(
        alumia(nowhere, nowhere).env("LANG", "pt_BR.UTF-8").args(["serve", "--config", "/nonexistent/alumia.toml"]),
    );
    let said = String::from_utf8(served.stderr).unwrap();
    let told = said.lines().find(|line| line.contains("(AL-")).unwrap_or_else(|| panic!("no code in: {said}"));
    assert_eq!(
        told,
        "Não foi possível ler o arquivo de configuração /nonexistent/alumia.toml. \
         Confira se ele existe e se o seu usuário pode lê-lo. (AL-9559)"
    );
    assert!(said.contains("failed to read config file /nonexistent/alumia.toml"), "{said}");
}

/// A Mac nobody has set up yet has a gateway that stands, serves nothing and says
/// so.
#[test]
fn without_settings_it_waits_and_says_why() {
    let mut hosted = Hosted::start(None);
    let status = hosted.status();
    assert_eq!(status["serving"], false, "{status}");
    assert_eq!(status["listen"], serde_json::Value::Null, "no port is open: {status}");
    assert_eq!(status["session"], serde_json::Value::Null);
    assert_eq!(status["cause"]["code"], "AL-9901", "{status}");
    assert_eq!(status["version"], env!("CARGO_PKG_VERSION"));
    assert!(hosted.alive(), "it stands, to be told when there are settings:\n{}", hosted.log());

    // And it serves the moment it is given some, the same process.
    let port = free_port();
    std::fs::write(hosted.dir.path().join("alumia.toml"), settings(port, free_port())).unwrap();
    let (_, said) = hosted.asks(&["reload"]);
    assert_eq!(said, serde_json::json!({ "reloaded": true }));
    let status = hosted.status();
    assert_eq!(status["serving"], true, "{status}\n{}", hosted.log());
    assert_eq!(status["listen"], format!("127.0.0.1:{port}"));
    assert!(hosted.alive());
}

/// The status is said in the language the app asks in: a service has no terminal
/// to take one from.
#[test]
fn the_status_says_the_cause_in_the_language_asked() {
    let hosted = Hosted::start(None);
    let (_, portuguese) = hosted.asks(&["--language", "pt-BR", "status"]);
    assert_eq!(portuguese["cause"]["code"], "AL-9901");
    assert_eq!(
        portuguese["cause"]["says"],
        "O Alumia ainda não foi configurado neste Mac. Abra o Alumia e conclua a configuração."
    );
    let (_, english) = hosted.asks(&["--language", "en-US", "status"]);
    assert_eq!(english["cause"]["code"], "AL-9901");
    assert_eq!(english["cause"]["says"], "Alumia has not been set up on this Mac yet. Open Alumia and finish setting it up.");
    assert_eq!(english["cause"]["detail"], portuguese["cause"]["detail"], "its own words are the same in both");
    assert!(english["cause"]["detail"].as_str().unwrap().starts_with("no settings yet at "));
}

/// The settings are the owner's alone, written whole, and a key the app does not
/// know of is still there after a change.
#[test]
fn settings_are_written_for_the_owner_alone() {
    let dir = common::ScratchDir::new("app");
    // A folder the app's change has to make private, and settings with what the
    // app never writes.
    std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
    let before = format!("{}video_quality = 80\n\n[branding]\ntext = \"casa\"\n", settings(52380, 5901));
    dir.write("alumia.toml", &before);
    std::fs::set_permissions(dir.path().join("alumia.toml"), std::fs::Permissions::from_mode(0o644)).unwrap();

    let change = r#"{"listen":"127.0.0.1:52399","computers":[{"name":"fake","host":"192.0.2.7"}]}"#;
    let (applied, said) = asked(dir.path(), dir.path(), &["config-apply"], change);
    assert!(applied, "{said}");
    assert_eq!(said, serde_json::json!({ "applied": true }));

    let mode = |path: &Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode(&dir.path().join("alumia.toml")), 0o600, "the file is the owner's alone");
    assert_eq!(mode(dir.path()), 0o700, "and so is its folder");
    let after: toml::Table = std::fs::read_to_string(dir.path().join("alumia.toml")).unwrap().parse().unwrap();
    assert_eq!(after["server"]["listen"].as_str(), Some("127.0.0.1:52399"));
    assert_eq!(after["targets"][0]["host"].as_str(), Some("192.0.2.7"));
    assert_eq!(after["targets"][0]["video_quality"].as_integer(), Some(80), "a key the app does not know");
    assert_eq!(after["branding"]["text"].as_str(), Some("casa"), "and a table it does not know");
    let left: Vec<_> = std::fs::read_dir(dir.path()).unwrap().map(|entry| entry.unwrap().file_name()).collect();
    assert_eq!(left, ["alumia.toml"], "nothing is left beside it");

    // What the app is shown of it has no secret.
    let (shown, said) = asked(dir.path(), dir.path(), &["config-show"], "");
    assert!(shown);
    assert_eq!(said["username"], common::TEST_USER);
    assert!(!said.to_string().contains("$2"), "{said}");
}

/// A change the gateway's own check refuses changes nothing, and says why in the
/// language asked for.
#[test]
fn a_refused_change_leaves_the_file_as_it_was() {
    let dir = common::ScratchDir::new("app");
    let path = dir.write("alumia.toml", &settings(52380, 5901));
    let before = std::fs::read(&path).unwrap();

    let change = r#"{"computers":[{"name":"fake","host":""}]}"#;
    let (applied, said) = asked(dir.path(), dir.path(), &["--language", "pt-BR", "config-apply"], change);
    assert!(!applied, "{said}");
    assert_eq!(said["refused"]["code"], "AL-9520", "{said}");
    // In the app's words, which name what a window has, and not in a terminal's,
    // which name the file's key.
    assert_eq!(said["refused"]["says"], "O computador fake está com o endereço vazio. Informe o nome dele na rede ou o IP.");
    assert_eq!(std::fs::read(&path).unwrap(), before, "not a byte of it changed");

    let (_, said) = asked(dir.path(), dir.path(), &["--language", "en-US", "config-apply"], change);
    assert_eq!(said["refused"]["says"], "The computer fake has an empty address. Give its name on the network, or its IP.");
    // And what is not a change at all is refused the same way.
    let (applied, said) = asked(dir.path(), dir.path(), &["config-apply"], "{\"porta\": 1}");
    assert!(!applied);
    assert_eq!(said["refused"]["code"], "AL-9904", "{said}");
    assert_eq!(std::fs::read(&path).unwrap(), before);
}

/// New settings are served by the process that served the old ones: a process
/// that ended to take them would light a MacBook's built-in display.
#[tokio::test]
async fn a_reload_keeps_the_process() {
    let (old, new) = (free_port(), free_port());
    let mut hosted = Hosted::start(Some(&settings(old, free_port())));
    assert_eq!(hosted.status()["listen"], format!("127.0.0.1:{old}"));
    assert_eq!(get(local(old), "/api/health", None).await.0, 200);

    hosted.change(&format!(r#"{{"listen":"127.0.0.1:{new}"}}"#));

    let status = hosted.status();
    assert_eq!(status["serving"], true, "{status}\n{}", hosted.log());
    assert_eq!(status["listen"], format!("127.0.0.1:{new}"));
    assert_eq!(get(local(new), "/api/health", None).await.0, 200, "it serves where the settings now say");
    assert!(tokio::net::TcpStream::connect(local(old)).await.is_err(), "and no longer where they said");
    assert!(hosted.alive(), "the same process:\n{}", hosted.log());

    // The same port again is the same socket taken twice, which the first run has
    // to have let go of.
    hosted.change(&format!(r#"{{"listen":"127.0.0.1:{new}"}}"#));
    assert_eq!(get(local(new), "/api/health", None).await.0, 200);
    assert!(hosted.alive());
}

/// The control socket is a file of the owner's in a folder of the owner's, and
/// the page's port does not answer what it answers.
#[tokio::test]
async fn the_control_socket_is_the_owners() {
    let port = free_port();
    let hosted = Hosted::start(Some(&settings(port, free_port())));
    let socket = std::fs::metadata(hosted.dir.path().join("control.sock")).unwrap();
    assert!(socket.file_type().is_socket());
    assert_eq!(socket.permissions().mode() & 0o777, 0o600);
    assert_eq!(std::fs::metadata(hosted.dir.path()).unwrap().permissions().mode() & 0o777, 0o700);

    // The same line, sent to the port the page is published on.
    let mut stream = tokio::net::TcpStream::connect(local(port)).await.unwrap();
    stream.write_all(b"{\"ask\":\"status\"}\n").await.unwrap();
    stream.shutdown().await.unwrap();
    let mut answer = String::new();
    let _ = stream.read_to_string(&mut answer).await;
    assert!(!answer.contains("serving"), "the page's port answered the app's ask: {answer}");
    for path in ["/api/status", "/api/reload", "/api/end-session", "/control.sock"] {
        let (status, body) = get(local(port), path, None).await;
        assert!(!body.contains("\"serving\""), "{path}: {status} {body}");
    }

    // And a second gateway in the folder is refused, leaving the first as it was.
    let second = ran(alumia(hosted.dir.path(), hosted.bundle.path()).args(["serve", "--app"]));
    assert!(!second.status.success());
    assert!(String::from_utf8_lossy(&second.stderr).contains("already served by another gateway"));
    assert_eq!(hosted.status()["serving"], true);
}

/// A port somebody else has is a reason to wait and say so, not to end: ended, the
/// system would start it again and again, and each end would light the display.
#[tokio::test]
async fn a_busy_port_keeps_the_process_and_says_why() {
    let taken = own_listener();
    let port = taken.local_addr().unwrap().port();
    let mut hosted = Hosted::start(Some(&settings(port, free_port())));

    let (_, status) = hosted.asks(&["--language", "pt-BR", "status"]);
    assert_eq!(status["serving"], false, "{status}");
    assert_eq!(status["cause"]["code"], "AL-9411", "{status}");
    let says = status["cause"]["says"].as_str().unwrap();
    assert!(says.starts_with(&format!("Não foi possível escutar em 127.0.0.1:{port}.")), "{says}");
    assert!(hosted.alive(), "it stands:\n{}", hosted.log());

    // The port is let go of, and the gateway asked to try again.
    drop(taken);
    let (_, said) = hosted.asks(&["reload"]);
    assert_eq!(said, serde_json::json!({ "reloaded": true }));
    let status = hosted.status();
    assert_eq!(status["serving"], true, "{status}\n{}", hosted.log());
    assert_eq!(status["cause"], serde_json::Value::Null);
    assert_eq!(get(local(port), "/api/health", None).await.0, 200);
    assert!(hosted.alive(), "and it is the process that waited");
}

/// Somebody at the Mac ends the open session: the browser is told that, and not
/// that another browser took it, and stays where it can open one again.
#[tokio::test]
async fn ending_the_session_from_the_host_says_so() {
    let port = free_port();
    let hosted = Hosted::start(Some(&settings(port, fake_vnc().await)));
    assert_eq!(hosted.status()["session"], serde_json::Value::Null);
    let (_, said) = hosted.asks(&["end-session"]);
    assert_eq!(said, serde_json::json!({ "ended": false }), "there is none to end yet");

    let mut ws = open_session(port).await;
    assert_eq!(hosted.status()["session"], "fake", "the app sees the session and which computer it is on");

    let (_, said) = hosted.asks(&["end-session"]);
    assert_eq!(said, serde_json::json!({ "ended": true }));
    let error = control(&mut ws, "error").await;
    assert_eq!(error["cause"]["code"], "AL-7801", "{error}");
    control(&mut ws, "picker").await;
    assert_eq!(hosted.status()["session"], serde_json::Value::Null);

    // Still attached, and still signed in: the same socket opens it again.
    common::connect_target(&mut ws, "fake").await;
    assert_eq!(control(&mut ws, "connected").await["name"], "fake");
    assert_eq!(hosted.status()["session"], "fake");
}

/// New settings end the open session with that reason, in the same process, and
/// the page opens a session again on the gateway that took them.
#[tokio::test]
async fn a_reload_with_a_session_open_ends_it_and_serves_again() {
    let port = free_port();
    let vnc = fake_vnc().await;
    let mut hosted = Hosted::start(Some(&settings(port, vnc)));
    let mut ws = open_session(port).await;
    let cookie = common::login(local(port)).await;

    // A second computer, on the same port: the page's address does not change.
    hosted.change(&format!(
        r#"{{"computers":[{{"name":"fake"}},{{"name":"outro","protocol":"vnc","host":"127.0.0.1","port":{vnc}}}]}}"#
    ));

    let error = control(&mut ws, "error").await;
    assert_eq!(error["cause"]["code"], "AL-7802", "the reason came before the socket ended: {error}");
    control(&mut ws, "picker").await;
    assert!(hosted.alive(), "the same process:\n{}", hosted.log());
    assert_eq!(hosted.status()["session"], serde_json::Value::Null);

    // A login that was not kept ends with the settings it was made under.
    assert_eq!(get(local(port), "/api/targets", Some(&cookie)).await.0, 401);
    let cookie = common::login(local(port)).await;
    let (status, listed) = get(local(port), "/api/targets", Some(&cookie)).await;
    assert_eq!(status, 200);
    assert!(listed.contains("\"outro\""), "the new settings are what is served: {listed}");
    drop(ws);
    let _ws = open_session(port).await;
    assert_eq!(hosted.status()["session"], "fake");
}

/// The reason reaches a browser that is sending input all the while, as one whose
/// pointer moves is: what it sent last is still on its way when the gateway lets
/// go of its socket, and the socket ending under that is not the reason lost.
///
/// It is the case as it happens, and no proof of the wait itself: on one machine
/// a socket writes sooner than a gateway ends, so a gateway that did not wait for
/// it passes here too. What proves the wait is
/// `session::tests::the_host_ends_a_session_with_its_cause`.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_reload_tells_a_browser_that_keeps_sending_input() {
    let port = free_port();
    let vnc = fake_vnc().await;
    let mut hosted = Hosted::start(Some(&settings(port, vnc)));
    let (mut sent, mut taken) = open_session(port).await.split();
    let moving = tokio::spawn(async move {
        let mut at = 0;
        // Until the socket ends under it.
        while sent.send(Message::text(format!(r#"{{"type":"mouseMove","x":{at},"y":{at}}}"#))).await.is_ok() {
            at = (at + 1) % 500;
            tokio::task::yield_now().await;
        }
    });

    tokio::task::block_in_place(|| hosted.change(r#"{"brand":"outro"}"#));

    let told = tokio::time::timeout(Duration::from_secs(20), async {
        let mut told = Vec::new();
        // To the end of both sockets, however each ends: the display's ends
        // with the generation it was opened on, with no word of its own, and
        // that is not the session's socket ending.
        while let Some(message) = taken.next().await {
            if let Ok(Message::Text(text)) = message {
                let control: serde_json::Value = serde_json::from_str(&text).unwrap();
                match control["type"].as_str() {
                    Some("error") => told.push(control["cause"]["code"].as_str().unwrap_or_default().to_owned()),
                    Some("picker") => told.push("picker".to_owned()),
                    _ => {}
                }
            }
        }
        told
    })
    .await
    .expect("the socket ends once the gateway has let go of it");
    moving.abort();
    assert_eq!(told, ["AL-7802", "picker"], "the reason and the list, before the socket ended");
    assert!(hosted.alive(), "the same process:\n{}", hosted.log());
}

/// Its owner stops Alumia: the page's port closes, the open session is told that
/// and not that a setting changed, and the process that served is the one that
/// stands, says it is stopped, and serves again when it is started. A process
/// that ended to stop would light a MacBook's built-in display, and one the
/// system started in its place would serve again by itself.
#[tokio::test]
async fn stopping_closes_the_page_and_keeps_the_process() {
    let port = free_port();
    let mut hosted = Hosted::start(Some(&settings(port, fake_vnc().await)));
    let mut ws = open_session(port).await;
    let status = hosted.status();
    assert_eq!((&status["serving"], &status["stopped"]), (&true.into(), &false.into()), "{status}");

    let (answered, said) = hosted.asks(&["stop"]);
    assert!(answered, "{said}");
    assert_eq!(said, serde_json::json!({ "stopped": true }));
    let error = control(&mut ws, "error").await;
    assert_eq!(error["cause"]["code"], "AL-7803", "the reason came before the socket ended: {error}");
    control(&mut ws, "picker").await;

    let status = hosted.status();
    assert_eq!(status["serving"], false, "{status}");
    assert_eq!(status["stopped"], true, "{status}");
    assert_eq!(status["cause"], serde_json::Value::Null, "stopped by its owner is no fault: {status}");
    assert_eq!(status["listen"], serde_json::Value::Null);
    assert_eq!(status["session"], serde_json::Value::Null);
    assert!(tokio::net::TcpStream::connect(local(port)).await.is_err(), "the page's port is closed");
    assert!(hosted.alive(), "the same process stands:\n{}", hosted.log());
    assert!(hosted.dir.path().join("stopped").exists(), "the mark is the folder's, for the next process to find");

    // Asked to start over while it is stopped, it is still stopped: only
    // starting it starts it.
    let (_, said) = hosted.asks(&["reload"]);
    assert_eq!(said, serde_json::json!({ "reloaded": true }));
    assert_eq!(hosted.status()["stopped"], true);
    assert!(tokio::net::TcpStream::connect(local(port)).await.is_err());

    let (answered, said) = hosted.asks(&["start"]);
    assert!(answered, "{said}");
    assert_eq!(said, serde_json::json!({ "stopped": false }));
    let status = hosted.status();
    assert_eq!((&status["serving"], &status["stopped"]), (&true.into(), &false.into()), "{status}\n{}", hosted.log());
    assert_eq!(status["listen"], format!("127.0.0.1:{port}"));
    assert_eq!(get(local(port), "/api/health", None).await.0, 200, "it serves where it served");
    assert!(hosted.alive(), "and it is the process that was stopped");
    assert!(!hosted.dir.path().join("stopped").exists());
    drop(ws);
    let _ws = open_session(port).await;
    assert_eq!(hosted.status()["session"], "fake");
}

/// Stopped with no gateway running, the mark is left all the same, and the
/// gateway that starts next in that folder stands stopped until it is started.
#[test]
fn a_gateway_starts_as_its_owner_left_it() {
    let (dir, bundle) = (common::ScratchDir::new("app"), common::ScratchDir::new("app-bundle"));
    let (answered, said) = asked(dir.path(), bundle.path(), &["stop"], "");
    assert!(answered, "{said}");
    assert_eq!(said, serde_json::json!({ "stopped": true }), "nobody to ask, and the mark is the whole of it");
    assert!(dir.path().join("stopped").exists());
    let mode = std::fs::metadata(dir.path()).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o700, "the folder it made is its owner's alone");

    let port = free_port();
    dir.write("alumia.toml", &settings(port, free_port()));
    let mut child = started(
        alumia(dir.path(), bundle.path())
            .args(["serve", "--app"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null()),
    );
    let deadline = Instant::now() + Duration::from_secs(20);
    let status = loop {
        if dir.path().join("control.sock").exists() {
            let (answered, status) = asked(dir.path(), bundle.path(), &["status"], "");
            if answered {
                break status;
            }
        }
        assert!(Instant::now() < deadline, "it never answered");
        std::thread::sleep(Duration::from_millis(25));
    };
    assert_eq!(status["stopped"], true, "{status}");
    assert_eq!(status["serving"], false, "{status}");
    assert!(std::net::TcpStream::connect(local(port)).is_err(), "it opened no port");

    let (_, said) = asked(dir.path(), bundle.path(), &["start"], "");
    assert_eq!(said, serde_json::json!({ "stopped": false }));
    let (_, status) = asked(dir.path(), bundle.path(), &["status"], "");
    assert_eq!(status["serving"], true, "{status}");
    assert!(child.try_wait().unwrap().is_none(), "the process that waited is the one that serves");
    let _ = child.kill();
    let _ = child.wait();
}

/// A service's standard error leads nowhere, so the hosted gateway logs to its
/// own folder, for its owner alone; and a second gateway, refused the folder,
/// writes nothing in the log of the first.
#[test]
fn the_hosted_gateway_keeps_a_log() {
    let port = free_port();
    let hosted = Hosted::start(Some(&settings(port, free_port())));
    let path = hosted.dir.path().join("gateway.log");
    let log = hosted.kept_log();
    assert!(log.contains("hosted by the app in"), "the line it starts with:\n{log}");
    assert!(log.contains(&format!("app: serving on 127.0.0.1:{port}")), "{log}");
    assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600, "the owner's alone");

    let second = ran(alumia(hosted.dir.path(), hosted.bundle.path()).args(["serve", "--app"]));
    assert!(!second.status.success());
    assert!(String::from_utf8_lossy(&second.stderr).contains("already served by another gateway"));
    // The first goes on logging what it does, so its log may have grown: what it
    // must not have is anything of the second, which says where it is hosted the
    // moment a folder is its own, and here was told why not on its standard error.
    let after = hosted.kept_log();
    assert!(after.starts_with(&log), "nothing of the first was lost:\n{after}");
    assert_eq!(after.matches("hosted by the app in").count(), 1, "the second gateway wrote in it:\n{after}");
    assert!(!after.contains("already served"), "{after}");
    assert!(!hosted.dir.path().join("gateway.log.1").exists());
}

/// An app put in the place of the one installed finds the gateway of the one
/// before still running: asked by the binary it was started from, the gateway is
/// current, and asked by another file, the same bytes at another place, it is not.
#[test]
fn a_gateway_started_from_another_file_is_said_not_current() {
    let hosted = Hosted::start(None);
    let status = hosted.status();
    assert_eq!(status["current"], true, "{status}");
    assert!(status["binary"].is_string(), "{status}");

    let newer = hosted.bundle.path().join("alumia-newer");
    std::fs::copy(binary(), &newer).unwrap();
    let asked = ran(Command::new(&newer).env("ALUMIA_APP_DIR", hosted.dir.path()).args(["app", "status"]));
    assert!(asked.status.success(), "{}", String::from_utf8_lossy(&asked.stderr));
    let said: serde_json::Value = serde_json::from_slice(&asked.stdout).unwrap();
    assert_eq!(said["current"], false, "{said}");
    assert_eq!(said["binary"], status["binary"], "the gateway is the one it was");
}

/// A stand-in for the app in a bundle: a script where its executable is.
fn stand_in(script: &str) -> common::ScratchDir {
    let bundle = common::ScratchDir::new("app-bundle");
    let app = bundle.path().join("Contents/MacOS/Alumia");
    std::fs::create_dir_all(app.parent().unwrap()).unwrap();
    std::fs::write(&app, format!("#!/bin/sh\n{script}\n")).unwrap();
    std::fs::set_permissions(&app, std::fs::Permissions::from_mode(0o755)).unwrap();
    bundle
}

/// The other computers are the ones the app finds, asked when the list is and not
/// again within the minute; an address that is not `https` is not listed, and
/// neither is anything of an app that answers something else.
#[tokio::test]
async fn neighbours_come_from_the_app_and_are_kept_a_minute() {
    let counted = common::ScratchDir::new("app-asked");
    let count = counted.path().join("asked");
    let bundle = stand_in(&format!(
        "[ \"$1\" = --discover ] || exit 64\necho asked >> '{}'\n\
         echo '[{{\"name\":\"MacBook da Ana\",\"url\":\"https://macbook-da-ana.example.ts.net\"}},\
         {{\"name\":\"sem cadeado\",\"url\":\"http://mini.example.ts.net\"}}]'",
        count.display()
    ));
    let port = free_port();
    let _hosted = Hosted::start_beside(Some(&settings(port, free_port())), bundle);

    assert_eq!(get(local(port), "/api/neighbours", None).await.0, 401, "the list is for whoever is signed in");
    let cookie = common::login(local(port)).await;
    let expected = serde_json::json!([{ "name": "MacBook da Ana", "url": "https://macbook-da-ana.example.ts.net" }]);
    for _ in 0..2 {
        let (status, body) = get(local(port), "/api/neighbours", Some(&cookie)).await;
        assert_eq!(status, 200);
        assert_eq!(serde_json::from_str::<serde_json::Value>(&body).unwrap(), expected);
    }
    assert_eq!(std::fs::read_to_string(&count).unwrap().lines().count(), 1, "asked once for the two lists");

    // An app that prints something else is nobody found, and the list is still
    // answered.
    let port = free_port();
    let _hosted = Hosted::start_beside(Some(&settings(port, free_port())), stand_in("echo 'no such thing'"));
    let cookie = common::login(local(port)).await;
    assert_eq!(get(local(port), "/api/neighbours", Some(&cookie)).await, (200, "[]".to_owned()));
}
