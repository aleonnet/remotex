//! The gateway a Mac app hosts: `alumia serve --app`, and what the app asks of it.
//!
//! The app is the control, not a client: it shows no remote screen. It registers
//! this gateway as a service, writes the settings the gateway serves, and reads
//! what the gateway is doing. Everything of that gateway is in one folder only its
//! owner opens ([`dir`]), a sibling of the panel's instances:
//!
//! - `alumia.toml`, the settings, which the app never writes itself: it sends a
//!   change ([`apply`]) and the gateway's own check decides ([`crate::config::check`]),
//!   so what the app accepts is what the gateway accepts;
//! - `control.sock`, where the app asks ([`Ask`]) what the gateway is doing, to end
//!   the open session, and to start over with the settings as they are now. It is
//!   a socket of the folder and not a route of the page, so nobody the page is
//!   published to reaches it;
//! - `gateway.lock`, one gateway for the folder ([`crate::embedded::Instance::claim`]);
//! - `stopped`, the mark that its owner stopped Alumia ([`is_stopped`]): the
//!   gateway of a folder that has it serves nothing, and waits to be started;
//! - `gateway.log`, what the gateway logs ([`Log`]): a service has no terminal;
//! - the mark of a built-in display held off ([`crate::mac_displays::resume_in`]).
//!
//! A change of settings starts the server over **in the same process**
//! ([`generations`]): the process is what holds a MacBook's built-in display off
//! while its lid is closed ([`crate::mac_displays`]), and a process that ended to
//! take new settings would light it. For the same reason, and because the system
//! starts a service that ends again and again, a server that cannot start does not
//! end the process: it waits, says why to whoever asks, and tries again. And a
//! gateway its owner stops does not end either: it closes the page's port and ends
//! the open session, and stands, holding what the process holds, until it is
//! started.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::Context as _;
use log::{info, warn};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt as _, AsyncReadExt as _, AsyncWriteExt as _};
use tokio::sync::{mpsc, oneshot};

use crate::cause::{Cause, Caused as _};
use crate::cli::AppCommands;
use crate::embedded::{Instance, transport};
use crate::server::{Neighbour, Neighbours};
use crate::session::HostEnd;
use crate::words::{self, Language};
use crate::{bail_known, ensure_known};

/// Names the folder instead of the one under the home directory: a test's, and
/// the folder of a copy of the app that must not touch the installed one's.
pub const DIR_VARIABLE: &str = "ALUMIA_APP_DIR";

/// Names the app's bundle instead of the one this executable is inside: a test
/// puts a stand-in for the app there.
pub const BUNDLE_VARIABLE: &str = "ALUMIA_APP_BUNDLE";

/// How long a server that did not start, or stopped by itself, waits before it is
/// tried again, and how long the work of one that is ending is given.
#[derive(Clone, Copy)]
pub struct Times {
    pub retry: Duration,
    pub grace: Duration,
}

pub const TIMES: Times = Times { retry: Duration::from_secs(5), grace: Duration::from_secs(5) };

/// How long the app is given to find the other computers with Alumia.
pub const DISCOVERY_LIMIT: Duration = Duration::from_secs(4);
/// How long what it found is the answer, without asking it again.
pub const DISCOVERY_KEPT: Duration = Duration::from_secs(60);
/// How often the bundle is looked for in the Trash.
const TRASH_STEP: Duration = Duration::from_secs(10);

/// The folder of the gateway the app hosts.
pub fn dir() -> anyhow::Result<PathBuf> {
    if let Some(dir) = std::env::var_os(DIR_VARIABLE).filter(|dir| !dir.is_empty()) {
        return Ok(PathBuf::from(dir));
    }
    let home = std::env::home_dir()
        .context("cannot find the home directory")
        .cause(|| Cause::new("AL-9902"))?;
    Ok(home.join("Library/Application Support/alumia/app"))
}

/// The settings the hosted gateway serves.
pub fn settings_path(dir: &Path) -> PathBuf {
    dir.join("alumia.toml")
}

fn control_path(dir: &Path) -> PathBuf {
    dir.join("control.sock")
}

fn stopped_path(dir: &Path) -> PathBuf {
    dir.join("stopped")
}

/// Whether its owner stopped the gateway of `dir`. A mark in the folder and not a
/// state of the process: a gateway the system starts again, after a crash or at
/// the next login, finds it and stays stopped, and a command run while no gateway
/// is ([`stand`]) leaves it for the next one.
pub fn is_stopped(dir: &Path) -> bool {
    stopped_path(dir).exists()
}

/// Leave the mark in `dir`, or take it away.
fn set_stopped(dir: &Path, stopped: bool) -> anyhow::Result<()> {
    let path = stopped_path(dir);
    let cannot = || Cause::new("AL-9905").with("path", path.display());
    if stopped {
        make_dir(dir)?;
        return std::fs::write(&path, b"")
            .with_context(|| format!("cannot write {}", path.display()))
            .cause(cannot);
    }
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).with_context(|| format!("cannot remove {}", path.display())).cause(cannot),
    }
}

// -- the log ---------------------------------------------------------------------------

/// How large the gateway's log grows before it starts another.
pub const LOG_LIMIT: u64 = 1 << 20;

/// Where the hosted gateway logs: its own folder, since a service's standard
/// error leads nowhere a person can read. Until the folder is this gateway's
/// ([`Log::keep_in`]) it is standard error, as any other command's, so that a
/// second gateway refused the folder writes nothing in the log of the first.
#[derive(Clone, Default)]
pub struct Log(Arc<Mutex<Option<Kept>>>);

/// The log's file, and how much of it is written.
struct Kept {
    file: std::fs::File,
    path: PathBuf,
    written: u64,
    limit: u64,
}

impl Kept {
    /// `gateway.log` in `dir`, its owner's alone, added to where it is there and
    /// within `limit`, and begun again where it is not: the one before it is kept
    /// beside it, as `gateway.log.1`, and no older one is.
    fn open(dir: &Path, limit: u64) -> std::io::Result<Self> {
        use std::os::unix::fs::OpenOptionsExt as _;

        let path = dir.join("gateway.log");
        if std::fs::metadata(&path).is_ok_and(|log| log.len() >= limit) {
            std::fs::rename(&path, dir.join("gateway.log.1"))?;
        }
        let file = std::fs::OpenOptions::new().append(true).create(true).mode(0o600).open(&path)?;
        let written = file.metadata()?.len();
        Ok(Self { file, path, written, limit })
    }

    fn write(&mut self, line: &[u8]) -> std::io::Result<()> {
        use std::io::Write as _;

        if self.written >= self.limit
            && let Some(dir) = self.path.parent()
        {
            *self = Self::open(dir, self.limit)?;
        }
        self.file.write_all(line)?;
        self.written += line.len() as u64;
        Ok(())
    }
}

impl Log {
    /// Log to `gateway.log` in `dir` from here on. A folder that cannot be
    /// written in leaves the log where it was, and says so there.
    pub fn keep_in(&self, dir: &Path) {
        self.keep_within(dir, LOG_LIMIT);
    }

    fn keep_within(&self, dir: &Path, limit: u64) {
        match Kept::open(dir, limit) {
            Ok(kept) => *self.0.lock().unwrap() = Some(kept),
            Err(error) => warn!("app: cannot keep the log in {}: {error}", dir.display()),
        }
    }
}

impl std::io::Write for Log {
    fn write(&mut self, line: &[u8]) -> std::io::Result<usize> {
        match &mut *self.0.lock().unwrap() {
            Some(kept) => kept.write(line)?,
            None => std::io::stderr().write_all(line)?,
        }
        Ok(line.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

// -- the settings ---------------------------------------------------------------------

/// The settings file's text, or `None` where there is none yet.
fn read(path: &Path) -> anyhow::Result<Option<String>> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error)
            .with_context(|| format!("failed to read config file {}", path.display()))
            .cause(|| Cause::new("AL-9559").with("path", path.display())),
    }
}

/// The settings as a table of whatever keys they have, so that one the app does
/// not know is carried through a change untouched.
fn table(text: &str, path: &Path) -> anyhow::Result<toml::Table> {
    text.parse::<toml::Table>()
        .with_context(|| format!("in config file {}", path.display()))
        .cause(|| Cause::new("AL-9560").with("path", path.display()))
}

/// The keys of a computer that are secrets. Neither is ever shown: the app is told
/// only whether there is one.
const SECRETS: [(&str, &str); 2] = [("password", "hasPassword"), ("vnc_password", "hasVncPassword")];

fn json_of(value: &toml::Value) -> serde_json::Value {
    match value {
        toml::Value::String(text) => text.clone().into(),
        toml::Value::Integer(number) => (*number).into(),
        toml::Value::Float(number) => (*number).into(),
        toml::Value::Boolean(flag) => (*flag).into(),
        toml::Value::Datetime(when) => when.to_string().into(),
        toml::Value::Array(values) => values.iter().map(json_of).collect(),
        toml::Value::Table(table) => {
            serde_json::Value::Object(table.iter().map(|(key, value)| (key.clone(), json_of(value))).collect())
        }
    }
}

/// `None` for a JSON null, which a change writes to take a key away, and for a
/// number TOML has no value for.
fn toml_of(value: &serde_json::Value) -> Option<toml::Value> {
    Some(match value {
        serde_json::Value::Null => return None,
        serde_json::Value::Bool(flag) => (*flag).into(),
        serde_json::Value::Number(number) => match number.as_i64() {
            Some(whole) => whole.into(),
            None => number.as_f64()?.into(),
        },
        serde_json::Value::String(text) => text.clone().into(),
        serde_json::Value::Array(values) => toml::Value::Array(values.iter().filter_map(toml_of).collect()),
        serde_json::Value::Object(map) => toml::Value::Table(
            map.iter().filter_map(|(key, value)| Some((key.clone(), toml_of(value)?))).collect(),
        ),
    })
}

/// The settings in `dir` as the app shows them: where the page is served, who
/// signs in to it, and each computer with the keys it has. No password is in it,
/// and neither is the hash of the page's: a secret is told only as being there.
pub fn show(dir: &Path) -> anyhow::Result<serde_json::Value> {
    let path = settings_path(dir);
    shown(read(&path)?.as_deref(), &path)
}

fn shown(text: Option<&str>, path: &Path) -> anyhow::Result<serde_json::Value> {
    let settings = table(text.unwrap_or_default(), path)?;
    let server = settings.get("server").and_then(toml::Value::as_table);
    let said = |key: &str| server.and_then(|server| server.get(key)).and_then(toml::Value::as_str);
    let computers: Vec<serde_json::Value> = settings
        .get("targets")
        .and_then(toml::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(toml::Value::as_table)
        .map(|computer| {
            let mut shown = serde_json::Map::new();
            for (key, value) in computer {
                if !SECRETS.iter().any(|(secret, _)| secret == key) {
                    shown.insert(key.clone(), json_of(value));
                }
            }
            for (secret, has) in SECRETS {
                let there = computer.get(secret).and_then(toml::Value::as_str).is_some_and(|text| !text.is_empty());
                shown.insert(has.to_owned(), there.into());
            }
            serde_json::Value::Object(shown)
        })
        .collect();
    let of = |table: &str, key: &str| settings.get(table).and_then(toml::Value::as_table).and_then(|table| table.get(key));
    Ok(serde_json::json!({
        "configured": text.is_some(),
        "listen": said("listen").unwrap_or(crate::config::DEFAULT_LISTEN),
        // The name before the colon of `username:bcrypt_hash`.
        "username": said("site_passwd").and_then(|credential| credential.split_once(':')).map(|(name, _)| name),
        // What the page calls this gateway, where the settings say; and whether
        // the throughput is recorded.
        "brand": of("branding", "text").and_then(toml::Value::as_str),
        "meter": of("meter", "enabled").and_then(toml::Value::as_bool).unwrap_or(false),
        "computers": computers,
    }))
}

/// The table `name` of `settings`, made where there is none.
fn table_of<'a>(settings: &'a mut toml::Table, name: &str, path: &Path) -> anyhow::Result<&'a mut toml::Table> {
    settings
        .entry(name)
        .or_insert_with(|| toml::Table::new().into())
        .as_table_mut()
        .with_context(|| format!("[{name}] is not a table"))
        .cause(|| Cause::new("AL-9560").with("path", path.display()))
}

/// What the app asks to be different in the settings. Whatever it leaves out stays
/// as it is.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Change {
    /// Where the page is served.
    listen: Option<String>,
    /// Who signs in to the page.
    login: Option<Login>,
    /// What the page calls this gateway. Empty is the name it has by itself.
    brand: Option<String>,
    /// Whether the throughput is recorded.
    meter: Option<bool>,
    /// Every computer, in the order of the list. One the list leaves out is
    /// removed. Each is the keys to set on it: a key left out keeps what it has,
    /// which is how a password not typed again is kept, and a `null` takes the key
    /// away. `was` is the name it had before, where it was renamed. `fresh` says
    /// it is another computer in that one's place, of which no key is kept.
    computers: Option<Vec<serde_json::Map<String, serde_json::Value>>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Login {
    username: String,
    password: String,
}

/// `text`, the settings, with `change` made in it. `cost` is what hashing the
/// page's password costs ([`crate::auth::generate`]).
fn changed(text: &str, change: Change, path: &Path, cost: u32) -> anyhow::Result<String> {
    let mut settings = table(text, path)?;
    if change.listen.is_some() || change.login.is_some() {
        let server = table_of(&mut settings, "server", path)?;
        if let Some(listen) = change.listen {
            server.insert("listen".to_owned(), listen.into());
        }
        if let Some(login) = change.login {
            let credential = crate::auth::generate(&login.username, &login.password, cost)?;
            server.insert("site_passwd".to_owned(), credential.into());
        }
    }
    if let Some(brand) = change.brand {
        let branding = table_of(&mut settings, "branding", path)?;
        if brand.trim().is_empty() {
            branding.remove("text");
        } else {
            branding.insert("text".to_owned(), brand.into());
        }
    }
    if let Some(meter) = change.meter {
        // The table says whether it records in as many words, and keeps whatever
        // else was written under it.
        table_of(&mut settings, "meter", path)?.insert("enabled".to_owned(), meter.into());
    }
    if let Some(computers) = change.computers {
        let mut before: Vec<toml::Table> = match settings.remove("targets") {
            Some(toml::Value::Array(computers)) => {
                computers.into_iter().filter_map(|computer| computer.try_into().ok()).collect()
            }
            _ => Vec::new(),
        };
        let mut after = Vec::new();
        for mut keys in computers {
            let was = keys.remove("was");
            // Another computer in the place of the one named: nothing of that
            // one is kept, its passwords least of all.
            let fresh = keys.remove("fresh") == Some(true.into());
            let name = was.as_ref().or(keys.get("name")).and_then(serde_json::Value::as_str);
            let Some(name) = name else {
                bail_known!("AL-9904"; "a computer in the change has no name");
            };
            let named = |computer: &toml::Table| computer.get("name").and_then(toml::Value::as_str) == Some(name);
            // Taken out of what was there, so that a name given twice is two
            // computers for the gateway's check to refuse, not one written twice.
            let mut computer = match before.iter().position(named) {
                Some(at) if fresh => {
                    before.remove(at);
                    toml::Table::new()
                }
                Some(at) => before.remove(at),
                None => toml::Table::new(),
            };
            for (key, value) in &keys {
                match toml_of(value) {
                    Some(value) => computer.insert(key.clone(), value),
                    None => computer.remove(key),
                };
            }
            after.push(toml::Value::Table(computer));
        }
        settings.insert("targets".to_owned(), toml::Value::Array(after));
    }
    toml::to_string(&settings)
        .context("cannot write the settings as TOML")
        .cause(|| Cause::new("AL-9905").with("path", path.display()))
}

/// Make `change`, the app's JSON, in the settings of `dir`, where the gateway
/// takes the result. A change it refuses leaves the file as it was, and the error
/// says why as the gateway's own check says it.
pub fn apply(dir: &Path, change: &str) -> anyhow::Result<()> {
    apply_at(dir, change, crate::auth::DEFAULT_COST)
}

fn apply_at(dir: &Path, change: &str, cost: u32) -> anyhow::Result<()> {
    let change: Change = serde_json::from_str(change)
        .context("the change is not one this gateway reads")
        .cause(|| Cause::new("AL-9904"))?;
    let path = settings_path(dir);
    let text = changed(&read(&path)?.unwrap_or_default(), change, &path, cost)?;
    crate::config::check(&text)?;
    write_private(dir, &path, &text)
}

/// Write `text` at `path`, in `dir`, for its owner alone, by a file beside it that
/// takes its place whole: nobody reads half a file, and a failure leaves the one
/// that was there.
fn write_private(dir: &Path, path: &Path, text: &str) -> anyhow::Result<()> {
    use std::io::Write as _;
    use std::os::unix::fs::OpenOptionsExt as _;

    make_dir(dir)?;
    let temporary = dir.join(format!("alumia.toml.{}.new", std::process::id()));
    let cannot = || Cause::new("AL-9905").with("path", path.display());
    let written = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temporary)
            .with_context(|| format!("cannot create {}", temporary.display()))
            .cause(cannot)?;
        file.write_all(text.as_bytes())
            .and_then(|()| file.sync_all())
            .with_context(|| format!("cannot write {}", temporary.display()))
            .cause(cannot)?;
        std::fs::rename(&temporary, path)
            .with_context(|| format!("cannot install {}", path.display()))
            .cause(cannot)
    })();
    let _ = std::fs::remove_file(&temporary);
    written
}

/// The folder, there and its owner's alone: it holds the computers' credentials.
fn make_dir(dir: &Path) -> anyhow::Result<()> {
    std::fs::create_dir_all(dir)
        .with_context(|| format!("cannot create {}", dir.display()))
        .cause(|| Cause::new("AL-9907").with("path", dir.display()))?;
    transport::make_private(dir)
}

// -- what the app asks of the running gateway -------------------------------------------

/// One line of JSON the app writes to the control socket, answered by one line.
#[derive(Deserialize)]
#[serde(tag = "ask", rename_all = "kebab-case", deny_unknown_fields)]
enum Ask {
    /// What the gateway is doing. `language` is the one a cause is said in: a
    /// service has no terminal to take it from.
    Status {
        #[serde(default)]
        language: Option<String>,
    },
    /// End the open session, from this Mac.
    EndSession,
    /// Start the server over with the settings as they are now.
    Reload,
}

/// What the hosted gateway is doing, as the app reads it.
#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Status {
    pub version: String,
    /// Whether the page is being served.
    pub serving: bool,
    /// Whether it is not served because its owner stopped Alumia: no fault, and
    /// so no cause.
    pub stopped: bool,
    /// Where, as the settings write it.
    pub listen: Option<String>,
    /// The computer the open session is on, by the name the settings give it.
    pub session: Option<String>,
    /// Whether this Mac has the FFmpeg a Mac's picture is decoded with.
    pub ffmpeg: bool,
    /// Why the page is not being served.
    pub cause: Option<Refusal>,
    /// The file this gateway was started from ([`own_binary`]).
    pub binary: Option<String>,
}

/// The file `path` is, as the system tells one file from another: the device it
/// is on and its number there.
fn binary_of(path: &Path) -> Option<String> {
    use std::os::unix::fs::MetadataExt as _;

    let file = std::fs::metadata(path).ok()?;
    Some(format!("{}-{}", file.dev(), file.ino()))
}

/// The file this process was started from. A gateway reads it as it starts and
/// says it for as long as it runs ([`Status::binary`]), and the command that asks
/// it reads its own ([`told_current`]): an app put in the place of the one that
/// was installed is other files at the same paths, and the gateway of the one
/// before goes on running from a file that is no longer there to be opened.
fn own_binary() -> Option<String> {
    binary_of(&std::env::current_exe().ok()?)
}

/// `answer`, what a gateway said of itself, with whether it is `current`: started
/// from the file this command is, `own`. A gateway from before it said which file
/// is not; a command that cannot tell its own accuses nobody. The app, which runs
/// this command from its own bundle, starts a gateway that is not current over
/// (`Renewal`, in the app).
fn told_current(answer: &str, own: Option<&str>) -> String {
    let Ok(serde_json::Value::Object(mut said)) = serde_json::from_str(answer) else {
        return answer.to_owned();
    };
    let current = own.is_none_or(|own| said.get("binary").and_then(serde_json::Value::as_str) == Some(own));
    said.insert("current".to_owned(), current.into());
    serde_json::Value::Object(said).to_string()
}

/// Why not, as the app shows it: the catalogue's code and its sentence in the
/// language asked for, and the gateway's own words for whoever wants them.
#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Refusal {
    pub code: String,
    pub says: String,
    pub detail: String,
}

fn refusal(language: Language, error: &anyhow::Error) -> Refusal {
    let told = words::told_to_app(language, error, "AL-9900");
    Refusal { code: told.code.to_owned(), says: told.sentence, detail: told.own }
}

/// One run of the server with the settings as they were read: a generation.
pub trait Serving: Send + Sync + 'static {
    /// Where it listens, as the settings write it.
    fn listen(&self) -> String;
    /// The computer its open session is on, where there is one.
    fn session(&self) -> Option<String>;
    /// End its open session from this Mac, reporting whether there was one.
    fn end_session(&self, why: HostEnd) -> impl Future<Output = bool> + Send;
    /// Resolves when what it serves fails by itself, and not before.
    fn failed(&self) -> impl Future<Output = anyhow::Error> + Send;
    /// End all it runs. What runs on a thread of its own has up to `grace` to
    /// end; a task is dropped where it next waits, so whatever a task still owes
    /// somebody is asked for, and waited for, before this.
    fn end(&self, grace: Duration) -> impl Future<Output = ()> + Send;
}

/// Where the hosted gateway stands, for whoever asks.
enum Standing<S> {
    /// The first server has not been tried yet.
    Starting,
    Serving(Arc<S>),
    /// Not serving, and why: it is tried again by itself, and when it is asked to
    /// start over.
    Waiting(Arc<anyhow::Error>),
    /// Not serving, because its owner stopped it ([`is_stopped`]): nothing is
    /// tried until it is asked to start over.
    Stopped,
}

impl<S> Clone for Standing<S> {
    fn clone(&self) -> Self {
        match self {
            Self::Starting => Self::Starting,
            Self::Serving(serving) => Self::Serving(Arc::clone(serving)),
            Self::Waiting(error) => Self::Waiting(Arc::clone(error)),
            Self::Stopped => Self::Stopped,
        }
    }
}

/// What the control socket and the generations share.
pub struct Shared<S> {
    standing: Mutex<Standing<S>>,
    /// Each asks for the server to start over, and is answered once it has.
    reloads: mpsc::Sender<oneshot::Sender<()>>,
    /// The file this process was started from, read as it starts: by the time
    /// somebody asks, another may be at its path.
    binary: Option<String>,
}

type Reloads = mpsc::Receiver<oneshot::Sender<()>>;

impl<S: Serving> Shared<S> {
    fn new() -> (Arc<Self>, Reloads) {
        Self::started_from(std::env::current_exe().ok().as_deref())
    }

    /// The same, for a process started from `executable`: the file is read here,
    /// once, and never again.
    fn started_from(executable: Option<&Path>) -> (Arc<Self>, Reloads) {
        let (reloads, asked) = mpsc::channel(1);
        let binary = executable.and_then(binary_of);
        (Arc::new(Self { standing: Mutex::new(Standing::Starting), reloads, binary }), asked)
    }

    fn stand(&self, standing: Standing<S>) {
        *self.standing.lock().unwrap() = standing;
    }

    async fn status(&self, language: Language) -> Status {
        let standing = self.standing.lock().unwrap().clone();
        // Looked for each time, on a thread that may block: an FFmpeg installed
        // while the gateway runs is found by the next question.
        let ffmpeg = tokio::task::spawn_blocking(|| crate::vnc::apple_decoders().is_ok()).await.unwrap_or(false);
        let (listen, session, cause) = match &standing {
            Standing::Starting | Standing::Stopped => (None, None, None),
            Standing::Serving(serving) => (Some(serving.listen()), serving.session(), None),
            Standing::Waiting(error) => (None, None, Some(refusal(language, error))),
        };
        Status {
            version: env!("CARGO_PKG_VERSION").to_owned(),
            serving: matches!(standing, Standing::Serving(_)),
            stopped: matches!(standing, Standing::Stopped),
            listen,
            session,
            ffmpeg,
            cause,
            binary: self.binary.clone(),
        }
    }

    async fn answer(&self, ask: Ask) -> serde_json::Value {
        match ask {
            Ask::Status { language } => {
                let language = language.as_deref().map_or_else(words::language, Language::named);
                serde_json::to_value(self.status(language).await).unwrap_or_default()
            }
            Ask::EndSession => {
                let standing = self.standing.lock().unwrap().clone();
                let ended = match standing {
                    Standing::Serving(serving) => serving.end_session(HostEnd::Ended).await,
                    _ => false,
                };
                serde_json::json!({ "ended": ended })
            }
            Ask::Reload => {
                let (done, reloaded) = oneshot::channel();
                let asked = self.reloads.send(done).await.is_ok();
                serde_json::json!({ "reloaded": asked && reloaded.await.is_ok() })
            }
        }
    }
}

/// The longest line the control socket reads: an ask is a few dozen bytes.
const ASK_LIMIT: u64 = 4096;

/// Answer the one ask a connection to the control socket carries.
async fn answer_one<S: Serving>(stream: tokio::net::UnixStream, shared: Arc<Shared<S>>) {
    let (reading, mut writing) = stream.into_split();
    let mut line = String::new();
    if tokio::io::BufReader::new(reading.take(ASK_LIMIT)).read_line(&mut line).await.is_err() {
        return;
    }
    let answer = match serde_json::from_str::<Ask>(&line) {
        Ok(ask) => shared.answer(ask).await,
        Err(error) => {
            let error = Cause::new("AL-9904").of(anyhow::Error::new(error).context("the ask is not one this gateway reads"));
            serde_json::json!({ "refused": refusal(words::language(), &error) })
        }
    };
    let _ = writing.write_all(format!("{answer}\n").as_bytes()).await;
}

/// Ask the gateway hosted in `dir`, returning its one line of answer.
async fn ask(dir: &Path, ask: serde_json::Value) -> anyhow::Result<String> {
    let path = control_path(dir);
    let mut stream = tokio::net::UnixStream::connect(&path)
        .await
        .with_context(|| format!("nothing answers at {}", path.display()))
        .cause(|| Cause::new("AL-9903"))?;
    let unanswered = || Cause::new("AL-9906");
    stream
        .write_all(format!("{ask}\n").as_bytes())
        .await
        .context("the hosted gateway did not take the ask")
        .cause(unanswered)?;
    let mut answer = String::new();
    tokio::io::BufReader::new(stream)
        .read_line(&mut answer)
        .await
        .context("the hosted gateway did not answer")
        .cause(unanswered)?;
    ensure_known!("AL-9906"; !answer.trim().is_empty(), "the hosted gateway closed without an answer");
    Ok(answer.trim_end().to_owned())
}

/// Stop the gateway hosted in `dir`, or start it: the mark is left or taken away
/// ([`set_stopped`]), and the gateway that is running is asked to start over, which
/// is when it reads it. As a change of settings is made: where no gateway runs
/// the mark is left all the same, and the next one to start finds it.
async fn stand(dir: &Path, stopped: bool) -> anyhow::Result<String> {
    set_stopped(dir, stopped)?;
    match ask(dir, serde_json::json!({ "ask": "reload" })).await {
        Ok(_) => {}
        // Nobody to ask: the mark is the whole of it.
        Err(error) if crate::cause::find(&error).is_some_and(|cause| cause.code == "AL-9903") => {}
        Err(error) => return Err(error),
    }
    Ok(serde_json::json!({ "stopped": stopped }).to_string())
}

/// Run one of the app's requests (`alumia app …`), printing its one line of JSON:
/// the answer, or `{"refused": …}` with the cause in `language`, the terminal's
/// where none is given. Reports whether it was answered.
pub async fn command(asked: AppCommands, language: Option<&str>) -> bool {
    let language = language.map_or_else(words::language, Language::named);
    let answered = async {
        let dir = dir()?;
        match asked {
            AppCommands::ConfigShow => Ok(show(&dir)?.to_string()),
            AppCommands::ConfigApply => {
                // On stdin and never an argument: the change carries passwords, and
                // every process on the machine reads another's arguments. On a
                // thread that may block: reading waits, and hashing the page's
                // password takes its time by design.
                let applied = tokio::task::spawn_blocking(move || {
                    let change = std::io::read_to_string(std::io::stdin())
                        .context("failed to read the change from stdin")
                        .cause(|| Cause::new("AL-9904"))?;
                    apply(&dir, &change)
                });
                applied.await.map_err(anyhow::Error::from)??;
                Ok(serde_json::json!({ "applied": true }).to_string())
            }
            AppCommands::Status => ask(&dir, serde_json::json!({ "ask": "status", "language": language.tag() }))
                .await
                .map(|answer| told_current(&answer, own_binary().as_deref())),
            AppCommands::EndSession => ask(&dir, serde_json::json!({ "ask": "end-session" })).await,
            AppCommands::Reload => ask(&dir, serde_json::json!({ "ask": "reload" })).await,
            AppCommands::Stop => stand(&dir, true).await,
            AppCommands::Start => stand(&dir, false).await,
        }
    };
    let answered: anyhow::Result<String> = answered.await;
    match answered {
        Ok(answer) => {
            println!("{answer}");
            true
        }
        Err(error) => {
            println!("{}", serde_json::json!({ "refused": refusal(language, &error) }));
            false
        }
    }
}

// -- the generations ----------------------------------------------------------------------

/// What ends the wait on a generation, or on the lack of one.
enum Next {
    Stop,
    Reload(oneshot::Sender<()>),
    Failed(anyhow::Error),
    Retry,
}

/// Serve, one generation after another, until `stop` resolves: `start` reads the
/// settings and starts a server with them, and a server is ended and another
/// started each time the app asks ([`Ask::Reload`]). The open session is ended
/// first, with the reason, and so is the work the generation runs.
///
/// A generation that does not start, or stops by itself, leaves the process
/// standing with the reason for whoever asks, and is tried again after
/// `times.retry` and whenever the app asks.
///
/// `wanted` says whether the gateway's owner wants it serving ([`is_stopped`]),
/// asked before each generation: where they do not, none is started, nothing is
/// tried again by the clock, and the process stands until it is asked to start
/// over, which is how it is started as well as how it is stopped.
///
/// `held` is what the process holds for as long as it runs, whatever generation
/// is serving and whether one is: it is given back once, after the last.
async fn generations<S: Serving, Held>(
    mut start: impl FnMut() -> anyhow::Result<S>,
    wanted: impl Fn() -> bool,
    shared: &Shared<S>,
    reloads: &mut Reloads,
    stop: impl Future<Output = ()>,
    times: Times,
    held: Held,
) {
    tokio::pin!(stop);
    let mut asked: Option<oneshot::Sender<()>> = None;
    loop {
        let on = wanted();
        let serving = if on {
            match start() {
                Ok(serving) => {
                    let serving = Arc::new(serving);
                    info!("app: serving on {}", serving.listen());
                    shared.stand(Standing::Serving(Arc::clone(&serving)));
                    Some(serving)
                }
                Err(error) => {
                    warn!("app: not serving: {error:#}");
                    shared.stand(Standing::Waiting(Arc::new(error)));
                    None
                }
            }
        } else {
            info!("app: stopped by its owner; serving nothing until it is started");
            shared.stand(Standing::Stopped);
            None
        };
        // Whoever asked is answered once the settings they changed are what is
        // served, or what is refused: the next thing they ask is which.
        if let Some(done) = asked.take() {
            let _ = done.send(());
        }
        let next = match &serving {
            Some(serving) => tokio::select! {
                biased;
                () = &mut stop => Next::Stop,
                ask = reloads.recv() => ask.map_or(Next::Stop, Next::Reload),
                error = serving.failed() => Next::Failed(error),
            },
            // Stopped, there is nothing to try again: only its owner starts it.
            None if !on => tokio::select! {
                biased;
                () = &mut stop => Next::Stop,
                ask = reloads.recv() => ask.map_or(Next::Stop, Next::Reload),
            },
            None => tokio::select! {
                biased;
                () = &mut stop => Next::Stop,
                ask = reloads.recv() => ask.map_or(Next::Stop, Next::Reload),
                () = tokio::time::sleep(times.retry) => Next::Retry,
            },
        };
        if let Some(serving) = serving {
            if matches!(next, Next::Reload(_)) {
                // Told before anything of this generation ends, and waited for
                // until the browser's socket has written the reason and ended,
                // since ending the generation drops that socket where it stands.
                // Not past the grace: a socket that takes nothing is not a reason
                // to keep the old settings served. The reason is the one this
                // start over has: its owner stopped Alumia, or changed a setting.
                let why = if wanted() { HostEnd::SettingsChanged } else { HostEnd::Stopped };
                let told = serving.end_session(why);
                if tokio::time::timeout(times.grace, told).await.is_err() {
                    warn!("app: the open session's browser did not take the reason in time");
                }
            }
            serving.end(times.grace).await;
        }
        match next {
            Next::Stop => break,
            Next::Reload(done) => asked = Some(done),
            Next::Retry => {}
            Next::Failed(error) => {
                warn!("app: the server stopped: {error:#}");
                shared.stand(Standing::Waiting(Arc::new(error)));
                tokio::select! {
                    biased;
                    () = &mut stop => break,
                    ask = reloads.recv() => match ask {
                        Some(done) => asked = Some(done),
                        None => break,
                    },
                    () = tokio::time::sleep(times.retry) => {}
                }
            }
        }
    }
    drop(held);
}

/// Host the gateway of `dir` until `stop` resolves, or the app's bundle is found
/// in the Trash and its traces are cleaned.
///
/// The folder, its lock and the control socket come first, and failing at any of
/// them is the one error this returns: without them nothing can ask this process
/// anything, and there is no reason to stand. Everything after is
/// [`generations`]'s, which does not end on a failure.
///
/// `log` is where this process logs, kept in the folder once the folder is this
/// gateway's and not before.
pub async fn host<S: Serving, Held>(
    dir: &Path,
    start: impl FnMut() -> anyhow::Result<S>,
    stop: impl Future<Output = ()>,
    held: Held,
    log: &Log,
) -> anyhow::Result<()> {
    make_dir(dir)?;
    // One gateway for the folder, as for an instance of the panel's: a second is
    // refused here, before it touches the socket of the first, or its log.
    let claim = Instance::new(dir).claim().await?;
    let mut listener = transport::WorkerListener::bind(&control_path(dir).to_string_lossy(), &claim)?;
    log.keep_in(dir);
    info!(
        "alumia {}, features: {}, hosted by the app in {}",
        env!("CARGO_PKG_VERSION"),
        crate::cli::features_line(),
        dir.display()
    );
    crate::mac_displays::resume_in(dir);

    let (shared, mut reloads) = Shared::new();
    let control = tokio::spawn({
        let shared = Arc::clone(&shared);
        async move {
            loop {
                let (stream, _) = axum::serve::Listener::accept(&mut listener).await;
                tokio::spawn(answer_one(stream, Arc::clone(&shared)));
            }
        }
    });
    let stop = async {
        tokio::select! {
            () = stop => {}
            moved = trashed(bundle(), TRASH_STEP) => clean_up(&moved).await,
        }
    };
    generations(start, || !is_stopped(dir), &shared, &mut reloads, stop, TIMES, held).await;
    // The socket's file goes with the task that holds its listener.
    control.abort();
    let _ = control.await;
    drop(claim);
    Ok(())
}

// -- the app's bundle ---------------------------------------------------------------------

/// The bundle of the app that hosts this gateway: the one named, or the one this
/// executable is inside, at `Contents/Helpers`.
pub fn bundle() -> Option<PathBuf> {
    if let Some(bundle) = std::env::var_os(BUNDLE_VARIABLE).filter(|bundle| !bundle.is_empty()) {
        return Some(PathBuf::from(bundle));
    }
    bundle_of(&std::env::current_exe().ok()?)
}

fn bundle_of(executable: &Path) -> Option<PathBuf> {
    let helpers = executable.parent()?;
    let contents = helpers.parent()?;
    (helpers.file_name()? == "Helpers" && contents.file_name()? == "Contents").then(|| contents.parent()).flatten().map(Path::to_path_buf)
}

/// The app itself, which a gateway runs with no window for what only the app can
/// do: finding the other computers, and cleaning its own traces.
fn app_of(bundle: &Path) -> PathBuf {
    bundle.join("Contents/MacOS/Alumia")
}

/// Who finds the other computers with Alumia: the app in `bundle`, run with no
/// window (`Alumia --discover`), cut at `limit`, and asked again only once what it
/// found is older than `kept`. It is asked when the list is, so it works with the
/// app's menu hidden. No bundle, no neighbours.
pub fn neighbours(bundle: Option<PathBuf>, limit: Duration, kept: Duration) -> Neighbours {
    type Found = Option<(tokio::time::Instant, Vec<Neighbour>)>;
    let found = Arc::new(tokio::sync::Mutex::new(Found::None));
    Arc::new(move || {
        let (bundle, found) = (bundle.clone(), Arc::clone(&found));
        Box::pin(async move {
            let Some(bundle) = bundle else {
                return Vec::new();
            };
            // Held across the asking: a second list asked meanwhile waits for the
            // first one's answer rather than running the app beside it.
            let mut found = found.lock().await;
            if let Some((at, list)) = &*found
                && at.elapsed() < kept
            {
                return list.clone();
            }
            let list = discovered(&app_of(&bundle), limit).await;
            *found = Some((tokio::time::Instant::now(), list.clone()));
            list
        })
    })
}

/// What `app --discover` prints, held to what a list may show. Nothing where it
/// fails, prints something else or takes longer than `limit`: the list of
/// computers is shown either way.
async fn discovered(app: &Path, limit: Duration) -> Vec<Neighbour> {
    let asked = tokio::process::Command::new(app)
        .arg("--discover")
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .output();
    match tokio::time::timeout(limit, asked).await {
        Ok(Ok(said)) if said.status.success() => vetted(&said.stdout),
        Ok(Ok(said)) => {
            warn!("app: looking for other computers ended with {}", said.status);
            Vec::new()
        }
        Ok(Err(error)) => {
            warn!("app: cannot run {} to look for other computers: {error}", app.display());
            Vec::new()
        }
        Err(_) => {
            warn!("app: looking for other computers took longer than {} ms", limit.as_millis());
            Vec::new()
        }
    }
}

/// The neighbours in `said` a list may show: each with a name, and with an
/// address that is `https` and nothing a browser would read as anything else.
fn vetted(said: &[u8]) -> Vec<Neighbour> {
    serde_json::from_slice::<Vec<Neighbour>>(said)
        .unwrap_or_default()
        .into_iter()
        .filter(|neighbour| {
            let host = neighbour.url.strip_prefix("https://");
            !neighbour.name.trim().is_empty()
                && host.is_some_and(|host| !host.is_empty() && !host.chars().any(|c| c.is_whitespace() || c.is_control()))
        })
        .collect()
}

/// Whether `path` is in a Trash: the user's, or a volume's.
fn in_trash(path: &Path) -> bool {
    path.components().any(|part| matches!(part.as_os_str().to_str(), Some(".Trash" | ".Trashes")))
}

/// Where the folder opened as `held` is now. An open folder is followed where it
/// is moved, which is how a running app learns it was dragged to the Trash.
fn where_now(held: &std::fs::File) -> Option<PathBuf> {
    use std::os::fd::AsRawFd as _;
    use std::os::unix::ffi::OsStrExt as _;

    let mut path = [0u8; libc::PATH_MAX as usize];
    // SAFETY: `F_GETPATH` writes at most `PATH_MAX` bytes, a terminator among
    // them, into the buffer it is given, which is that long.
    let got = unsafe { libc::fcntl(held.as_raw_fd(), libc::F_GETPATH, path.as_mut_ptr()) };
    if got == -1 {
        return None;
    }
    let path = std::ffi::CStr::from_bytes_until_nul(&path).ok()?;
    Some(PathBuf::from(std::ffi::OsStr::from_bytes(path.to_bytes())))
}

/// Resolves with where the bundle is once it is in a Trash, looked at every
/// `step`; never without a bundle.
async fn trashed(bundle: Option<PathBuf>, step: Duration) -> PathBuf {
    let Some(held) = bundle.and_then(|bundle| std::fs::File::open(bundle).ok()) else {
        return std::future::pending().await;
    };
    loop {
        tokio::time::sleep(step).await;
        if let Some(now) = where_now(&held).filter(|now| in_trash(now)) {
            return now;
        }
    }
}

/// The app was put in the Trash at `moved`: have it take its traces away
/// (`Alumia --cleanup`), the service this process is among them.
async fn clean_up(moved: &Path) {
    info!("app: the app is in the Trash at {}; removing what it installed", moved.display());
    match tokio::process::Command::new(app_of(moved)).arg("--cleanup").status().await {
        Ok(status) if status.success() => {}
        Ok(status) => warn!("app: the clean-up ended with {status}"),
        Err(error) => warn!("app: cannot run the clean-up: {error}"),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    const BEFORE: &str = include_str!("../macos/Alumia/Tests/Fixtures/settings-before.toml");
    const CHANGE: &str = include_str!("../macos/Alumia/Tests/Fixtures/change.json");
    const SHOWN: &str = include_str!("../macos/Alumia/Tests/Fixtures/shown-after.json");
    const REPLACED: &str = include_str!("../macos/Alumia/Tests/Fixtures/replaced.json");
    const REFUSED: &str = include_str!("../macos/Alumia/Tests/Fixtures/refused.json");
    const SERVING: &str = include_str!("../macos/Alumia/Tests/Fixtures/status-serving.json");
    const WAITING: &str = include_str!("../macos/Alumia/Tests/Fixtures/status-waiting.json");
    const STOPPED: &str = include_str!("../macos/Alumia/Tests/Fixtures/status-stopped.json");
    const NEIGHBOURS: &str = include_str!("../macos/Alumia/Tests/Fixtures/neighbours.json");

    /// bcrypt's cheapest, so a test's login is not a wait.
    const COST: u32 = 4;

    fn json(text: &str) -> serde_json::Value {
        serde_json::from_str(text).unwrap()
    }

    fn settings(text: &str) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(settings_path(dir.path()), text).unwrap();
        dir
    }

    /// Nothing the app is shown carries a password, of a computer or of the page.
    #[test]
    fn what_is_shown_has_no_secret() {
        let dir = settings(BEFORE);
        let shown = show(dir.path()).unwrap().to_string();
        for secret in ["a-senha-do-mac", "a-senha-do-pc", "a-senha-antiga-do-vnc", "$2b$"] {
            assert!(BEFORE.contains(secret), "the settings under test have {secret}");
            assert!(!shown.contains(secret), "{secret} in {shown}");
        }
        let shown = json(&shown);
        assert_eq!(shown["configured"], true);
        assert_eq!(shown["username"], "ana");
        assert_eq!(shown["listen"], "127.0.0.1:52380");
        let computers = shown["computers"].as_array().unwrap();
        assert_eq!(computers.len(), 5);
        assert_eq!(computers[0]["hasPassword"], true);
        assert_eq!(computers[0]["hasVncPassword"], false);
        assert_eq!(computers[3]["hasVncPassword"], true);
        for computer in computers {
            assert!(computer.get("password").is_none() && computer.get("vnc_password").is_none(), "{computer}");
        }

        // And a Mac nobody has set up is shown as that, with where it would serve.
        let empty = tempfile::tempdir().unwrap();
        let shown = show(empty.path()).unwrap();
        assert_eq!(
            shown,
            serde_json::json!({
                "configured": false, "listen": "127.0.0.1:52380", "username": null, "brand": null, "meter": false,
                "computers": [],
            })
        );
    }

    /// The name the page shows and whether the throughput is recorded are the
    /// app's to change too, each in the table the gateway reads it from.
    #[test]
    fn the_name_and_the_meter_are_changed_where_the_gateway_reads_them() {
        let dir = settings(BEFORE);
        assert_eq!(show(dir.path()).unwrap()["brand"], "casa");
        assert_eq!(show(dir.path()).unwrap()["meter"], false);

        apply_at(dir.path(), r#"{"brand":"Estúdio","meter":true}"#, COST).unwrap();
        let after: toml::Table = std::fs::read_to_string(settings_path(dir.path())).unwrap().parse().unwrap();
        assert_eq!(after["branding"]["text"].as_str(), Some("Estúdio"));
        assert_eq!(after["meter"]["enabled"].as_bool(), Some(true));
        assert_eq!(after["targets"].as_array().unwrap().len(), 5, "and nothing else moved");
        let shown = show(dir.path()).unwrap();
        assert_eq!((&shown["brand"], &shown["meter"]), (&serde_json::json!("Estúdio"), &serde_json::json!(true)));

        // An empty name is the gateway's own again, and off is said, not left out.
        apply_at(dir.path(), r#"{"brand":" ","meter":false}"#, COST).unwrap();
        let after: toml::Table = std::fs::read_to_string(settings_path(dir.path())).unwrap().parse().unwrap();
        assert!(after["branding"].as_table().unwrap().get("text").is_none());
        assert_eq!(after["meter"]["enabled"].as_bool(), Some(false));
        assert_eq!(show(dir.path()).unwrap()["brand"], serde_json::Value::Null);
    }

    /// A computer the change names without a password keeps the one it had, a
    /// renamed one as well; a key the app does not know is carried through; and a
    /// computer the list leaves out is removed.
    #[test]
    fn a_password_not_sent_is_kept() {
        let dir = settings(BEFORE);
        apply_at(dir.path(), CHANGE, COST).unwrap();
        let after = std::fs::read_to_string(settings_path(dir.path())).unwrap();
        let after: toml::Table = after.parse().unwrap();
        let computers = after["targets"].as_array().unwrap();
        let of = |name: &str| {
            computers.iter().find(|computer| computer["name"].as_str() == Some(name)).unwrap_or_else(|| panic!("{name}"))
        };
        assert_eq!(computers.len(), 4, "the one left out of the list is gone");
        for mode in ["Mac da Ana virtual", "Mac da Ana mirrored"] {
            assert_eq!(of(mode)["password"].as_str(), Some("a-senha-do-mac"), "not sent, so kept");
        }
        // One the change names and says nothing else of is as it was, whole.
        let before: toml::Table = BEFORE.parse().unwrap();
        assert_eq!(of("estacao"), &before["targets"][4], "named alone, so kept as it was");
        assert_eq!(of("escritorio")["password"].as_str(), Some("a-senha-do-pc"), "kept through its new name");
        assert_eq!(of("escritorio")["host"].as_str(), Some("192.0.2.20"), "what was sent is set");
        assert_eq!(of("escritorio")["video_quality"].as_integer(), Some(80), "a key the app does not know");
        assert_eq!(after["server"]["listen"].as_str(), Some("127.0.0.1:52399"));
        assert_eq!(after["branding"]["text"].as_str(), Some("casa"), "a table the app does not know");
        let credential = after["server"]["site_passwd"].as_str().unwrap();
        assert!(crate::auth::SitePasswd::parse(credential).unwrap().verify("ana", "a-senha-nova-da-pagina"));

        // A password that is sent replaces, and a null takes the key away.
        let change = r#"{"computers":[{"name":"Mac da Ana virtual","password":"outra","username":null}]}"#;
        let refused = apply_at(dir.path(), change, COST).expect_err("a Mac's Screen Sharing asks for a user");
        assert!(crate::cause::find(&refused).is_some(), "{refused:#}");
        let change = r#"{"computers":[{"name":"Mac da Ana virtual","password":"outra"}]}"#;
        apply_at(dir.path(), change, COST).unwrap();
        let after: toml::Table = std::fs::read_to_string(settings_path(dir.path())).unwrap().parse().unwrap();
        assert_eq!(after["targets"][0]["password"].as_str(), Some("outra"));
    }

    /// Two displays the app asks for are written on the computer that takes them,
    /// shown back as the app reads them, and taken away by a null; on a computer
    /// that opens one display only they are refused, and nothing is written.
    #[test]
    fn two_displays_the_app_asks_for_are_written_where_they_are_taken() {
        let dir = settings(BEFORE);
        let read = || -> toml::Table { std::fs::read_to_string(settings_path(dir.path())).unwrap().parse().unwrap() };
        let pc = |two: &str| {
            format!(
                r#"{{"computers":[{{"name":"w","protocol":"rdp","host":"192.0.2.9","username":"u","password":"p","virtual_displays":{two}}}]}}"#
            )
        };
        apply_at(dir.path(), &pc("2"), COST).unwrap();
        assert_eq!(read()["targets"][0]["virtual_displays"].as_integer(), Some(2));
        assert_eq!(show(dir.path()).unwrap()["computers"][0]["virtual_displays"], 2);
        // A Mac's Virtual mode takes them too.
        let virtual_mode = r#"{"computers":[{"name":"m","protocol":"vnc","subtype":"ard-high-performance","host":"192.0.2.8","username":"u","password":"p","virtual_displays":2}]}"#;
        apply_at(dir.path(), virtual_mode, COST).unwrap();
        assert_eq!(read()["targets"][0]["virtual_displays"].as_integer(), Some(2));

        // Turned off, the key goes: one display is what a computer has unasked.
        apply_at(dir.path(), &pc("null"), COST).unwrap();
        assert!(read()["targets"][0].get("virtual_displays").is_none());

        // Its Mirrored mode shows the Mac's own screens: asked for two it is
        // refused, and the settings stay as they were.
        let before = std::fs::read_to_string(settings_path(dir.path())).unwrap();
        let mirrored = r#"{"computers":[{"name":"m","protocol":"vnc","subtype":"ard-mirror","host":"192.0.2.8","username":"u","password":"p","virtual_displays":2}]}"#;
        let refused = apply_at(dir.path(), mirrored, COST).expect_err("a mirrored Mac opens its own screens");
        assert_eq!(crate::cause::find(&refused).map(|cause| cause.code), Some("AL-9564"));
        assert_eq!(std::fs::read_to_string(settings_path(dir.path())).unwrap(), before);
    }

    /// The same files the app's own tests read: what the app sends is what this
    /// takes, and what this says is what the app reads.
    #[test]
    fn what_the_app_sends_and_reads_is_what_the_server_takes_and_says() {
        // A change, and the settings as shown after it.
        let dir = settings(BEFORE);
        apply_at(dir.path(), CHANGE, COST).unwrap();
        assert_eq!(show(dir.path()).unwrap(), json(SHOWN));

        // A computer that became one of another kind is another computer in the
        // old one's place: it is written with what was sent and nothing else, the
        // old one's password and the keys the app does not know gone with it.
        let other = settings(BEFORE);
        apply_at(other.path(), REPLACED, COST).unwrap();
        let after: toml::Table = std::fs::read_to_string(settings_path(other.path())).unwrap().parse().unwrap();
        let replaced: toml::Table =
            "name = \"pc-da-sala\"\nprotocol = \"vnc\"\nhost = \"192.0.2.10\"\nport = 5900".parse().unwrap();
        assert_eq!(after["targets"][2].as_table(), Some(&replaced), "nothing of the Windows host it was");
        assert_eq!(after["targets"].as_array().unwrap().len(), 5, "and the others are all there");
        assert_eq!(after["targets"][3]["vnc_password"].as_str(), Some("a-senha-antiga-do-vnc"));

        // A change the gateway refuses, as the app is told it in the language it
        // asks in.
        let refused = apply_at(dir.path(), r#"{"computers":[{"name":"escritorio","host":""}]}"#, COST)
            .expect_err("an empty address");
        let told = serde_json::json!({ "refused": refusal(Language::Portuguese, &refused) });
        assert_eq!(told, json(REFUSED));

        // What the gateway is doing, serving and not.
        let serving = Status {
            version: "0.0.325".to_owned(),
            serving: true,
            stopped: false,
            listen: Some("127.0.0.1:52380".to_owned()),
            session: Some("Mac da Ana virtual".to_owned()),
            ffmpeg: true,
            cause: None,
            binary: Some("16777234-48213".to_owned()),
        };
        assert_eq!(serde_json::to_value(&serving).unwrap(), json(SERVING));
        assert_eq!(serde_json::from_str::<Status>(SERVING).unwrap(), serving);
        let unset = Cause::new("AL-9901").of(anyhow::anyhow!("no settings yet at /a/alumia.toml"));
        let waiting = Status {
            version: "0.0.325".to_owned(),
            serving: false,
            stopped: false,
            listen: None,
            session: None,
            ffmpeg: false,
            cause: Some(refusal(Language::Portuguese, &unset)),
            binary: Some("16777234-48213".to_owned()),
        };
        assert_eq!(serde_json::to_value(&waiting).unwrap(), json(WAITING));

        // What the app prints of the other computers it found: all of it passes.
        let found = vetted(NEIGHBOURS.as_bytes());
        assert_eq!(serde_json::to_value(&found).unwrap(), json(NEIGHBOURS));
        assert!(!found.is_empty());

        // And each ask the app writes is one this reads.
        for asked in [r#"{"ask":"status","language":"pt-BR"}"#, r#"{"ask":"status"}"#, r#"{"ask":"end-session"}"#, r#"{"ask":"reload"}"#] {
            serde_json::from_str::<Ask>(asked).unwrap_or_else(|error| panic!("{asked}: {error}"));
        }
        // Stopping and starting are a mark in the folder and a reload: the
        // gateway reads no ask of their own.
        for asked in [r#"{"ask":"quit"}"#, r#"{"ask":"stop"}"#, r#"{"ask":"start"}"#] {
            assert!(serde_json::from_str::<Ask>(asked).is_err(), "{asked}");
        }
    }

    /// A list may show only a name and an `https` address.
    #[test]
    fn only_a_named_https_address_is_a_neighbour() {
        let said = br#"[
            {"name":"MacBook da Ana","url":"https://macbook-da-ana.example.ts.net"},
            {"name":"sem cadeado","url":"http://mini.example.ts.net"},
            {"name":"outra coisa","url":"javascript:alert(1)"},
            {"name":"","url":"https://sem-nome.example.ts.net"},
            {"name":"vazio","url":"https://"},
            {"name":"com espaco","url":"https://a b"}
        ]"#;
        let found = vetted(said);
        assert_eq!(found.len(), 1, "{found:?}");
        assert_eq!(found[0].name, "MacBook da Ana");
        assert!(vetted(b"not json at all").is_empty(), "what is not a list is no neighbour, and no error");
        assert!(vetted(br#"{"name":"um","url":"https://um.example"}"#).is_empty());
    }

    /// A stand-in for the app: a script at the place of its executable.
    fn stand_in(script: &str) -> tempfile::TempDir {
        use std::os::unix::fs::PermissionsExt as _;

        let bundle = tempfile::tempdir().unwrap();
        let app = app_of(bundle.path());
        std::fs::create_dir_all(app.parent().unwrap()).unwrap();
        std::fs::write(&app, format!("#!/bin/sh\n{script}\n")).unwrap();
        std::fs::set_permissions(&app, std::fs::Permissions::from_mode(0o755)).unwrap();
        bundle
    }

    /// An app that takes longer than the limit to find the others is not waited
    /// for: the list is shown without them.
    #[tokio::test]
    async fn a_slow_discovery_is_cut_at_the_limit() {
        let slow = stand_in("exec sleep 30");
        let limit = Duration::from_millis(200);
        let asked = std::time::Instant::now();
        let found = discovered(&app_of(slow.path()), limit).await;
        assert!(found.is_empty());
        assert!(asked.elapsed() >= limit, "it was given the limit");
        assert!(asked.elapsed() < Duration::from_secs(10), "and not the app's own time: {:?}", asked.elapsed());

        // One that answers is read, and one that is not there is nobody.
        let quick = stand_in(r#"echo '[{"name":"Mac mini","url":"https://mini.example.ts.net"}]'"#);
        let found = discovered(&app_of(quick.path()), Duration::from_secs(10)).await;
        assert_eq!(found, [Neighbour { name: "Mac mini".to_owned(), url: "https://mini.example.ts.net".to_owned() }]);
        assert!(discovered(Path::new("/nonexistent/Alumia"), limit).await.is_empty());
    }

    /// The bundle is the one this executable is the helper of, and no other
    /// place an executable runs from is a bundle.
    #[test]
    fn the_bundle_is_the_one_the_helper_is_in() {
        assert_eq!(
            bundle_of(Path::new("/Applications/Alumia.app/Contents/Helpers/alumia")),
            Some(PathBuf::from("/Applications/Alumia.app"))
        );
        assert_eq!(bundle_of(Path::new("/usr/local/bin/alumia")), None);
        assert_eq!(bundle_of(Path::new("/x/Contents/MacOS/alumia")), None);
    }

    /// A folder held open is found where it was moved to, which is what tells a
    /// running gateway its app is in the Trash.
    #[test]
    fn a_folder_moved_to_the_trash_is_followed() {
        let home = tempfile::tempdir().unwrap();
        let installed = home.path().join("Applications/Alumia.app");
        std::fs::create_dir_all(&installed).unwrap();
        let held = std::fs::File::open(&installed).unwrap();
        let before = where_now(&held).expect("an open folder has a path");
        assert!(before.ends_with("Applications/Alumia.app"), "{}", before.display());
        assert!(!in_trash(&before));

        let trash = home.path().join(".Trash");
        std::fs::create_dir(&trash).unwrap();
        std::fs::rename(&installed, trash.join("Alumia.app")).unwrap();
        let after = where_now(&held).expect("and still has one where it went");
        assert!(after.ends_with(".Trash/Alumia.app"), "{}", after.display());
        assert!(in_trash(&after));
        assert!(in_trash(Path::new("/Volumes/Disco/.Trashes/501/Alumia.app")));
        assert!(!in_trash(Path::new("/Users/ana/Trash/Alumia.app")), "a folder of that name is not the Trash");
    }

    /// A scripted generation: it serves until told to fail, and notes what is
    /// done to it.
    struct Scripted {
        number: usize,
        log: Arc<Mutex<Vec<String>>>,
        fail: tokio::sync::Notify,
    }

    impl Serving for Scripted {
        fn listen(&self) -> String {
            format!("generation {}", self.number)
        }

        fn session(&self) -> Option<String> {
            None
        }

        async fn end_session(&self, why: HostEnd) -> bool {
            self.log.lock().unwrap().push(format!("{} told {why:?}", self.number));
            true
        }

        async fn failed(&self) -> anyhow::Error {
            self.fail.notified().await;
            anyhow::anyhow!("generation {} stopped", self.number)
        }

        async fn end(&self, _grace: Duration) {
            self.log.lock().unwrap().push(format!("{} ended", self.number));
        }
    }

    /// Notes its own end, as what a process holds is given back.
    struct Held(Arc<Mutex<Vec<String>>>);

    impl Drop for Held {
        fn drop(&mut self) {
            self.0.lock().unwrap().push("given back".to_owned());
        }
    }

    const QUICK: Times = Times { retry: Duration::from_secs(5), grace: Duration::from_secs(5) };

    /// Two changes of settings and then a stop are three generations, each ended
    /// before the next starts and the open session told why, and what the process
    /// holds is given back once, after the last of them.
    #[tokio::test]
    async fn what_is_held_is_given_back_once_after_the_last_generation() {
        let log = Arc::new(Mutex::new(Vec::new()));
        let (shared, mut reloads) = Shared::<Scripted>::new();
        let (stop, stopped) = oneshot::channel::<()>();
        let started = AtomicUsize::new(0);
        let start = || {
            let number = started.fetch_add(1, Ordering::SeqCst) + 1;
            log.lock().unwrap().push(format!("{number} started"));
            Ok(Scripted { number, log: Arc::clone(&log), fail: tokio::sync::Notify::new() })
        };
        let asking = async {
            for _ in 0..2 {
                assert_eq!(shared.answer(Ask::Reload).await, serde_json::json!({ "reloaded": true }));
            }
            let status = shared.status(Language::English).await;
            assert!(status.serving && status.cause.is_none());
            assert_eq!(status.listen.as_deref(), Some("generation 3"), "answered once the new one serves");
            stop.send(()).unwrap();
        };
        let stop = async {
            let _ = stopped.await;
        };
        tokio::join!(generations(start, || true, &shared, &mut reloads, stop, QUICK, Held(Arc::clone(&log))), asking);

        assert_eq!(
            *log.lock().unwrap(),
            [
                "1 started",
                "1 told SettingsChanged",
                "1 ended",
                "2 started",
                "2 told SettingsChanged",
                "2 ended",
                "3 started",
                "3 ended",
                "given back",
            ]
        );
    }

    /// A generation that does not start is tried again after the wait, and not
    /// before, with the reason said meanwhile; and one that stops by itself is
    /// ended and tried again the same way.
    #[tokio::test(start_paused = true)]
    async fn a_generation_that_fails_is_tried_again_after_the_wait() {
        let log = Arc::new(Mutex::new(Vec::new()));
        let (shared, mut reloads) = Shared::<Scripted>::new();
        let (stop, stopped) = oneshot::channel::<()>();
        let tried = Mutex::new(Vec::new());
        let began = tokio::time::Instant::now();
        let start = || {
            let mut tried = tried.lock().unwrap();
            tried.push(began.elapsed());
            match tried.len() {
                // The port is somebody else's twice, and then free.
                1 | 2 => Err(Cause::new("AL-9411").with("address", "127.0.0.1:52380").of(anyhow::anyhow!("in use"))),
                number => Ok(Scripted { number, log: Arc::clone(&log), fail: tokio::sync::Notify::new() }),
            }
        };
        let watching = async {
            // Before the first wait is over: tried once, and saying why.
            tokio::time::sleep(QUICK.retry / 2).await;
            assert_eq!(tried.lock().unwrap().len(), 1, "not before the wait");
            let status = shared.status(Language::Portuguese).await;
            assert!(!status.serving);
            let cause = status.cause.expect("the reason is said while it waits");
            assert_eq!(cause.code, "AL-9411");
            assert!(cause.says.starts_with("Não foi possível escutar em 127.0.0.1:52380."), "{}", cause.says);
            assert_eq!(cause.detail, "in use");

            // The third serves, and then stops by itself, three waits in.
            tokio::time::sleep(QUICK.retry * 5 / 2).await;
            let Standing::Serving(serving) = shared.standing.lock().unwrap().clone() else {
                panic!("the third try serves");
            };
            assert_eq!(began.elapsed(), QUICK.retry * 3);
            serving.fail.notify_one();
            tokio::time::sleep(QUICK.retry / 2).await;
            let cause = shared.status(Language::English).await.cause.expect("a server that stopped says so");
            assert_eq!(cause.code, "AL-9900", "the general code, for a reason nobody named");
            assert_eq!(cause.detail, "generation 3 stopped");
            tokio::time::sleep(QUICK.retry).await;
            stop.send(()).unwrap();
        };
        let stop = async {
            let _ = stopped.await;
        };
        tokio::join!(generations(start, || true, &shared, &mut reloads, stop, QUICK, ()), watching);

        let tried = tried.lock().unwrap();
        assert_eq!(
            *tried,
            [Duration::ZERO, QUICK.retry, QUICK.retry * 2, QUICK.retry * 4],
            "each a wait after the one before, and the fourth a wait after the third stopped"
        );
        assert_eq!(*log.lock().unwrap(), ["3 ended", "4 ended"], "nobody is told of settings that did not change");
    }

    /// A gateway its owner stopped starts no server and tries nothing by the
    /// clock: it stands, says it is stopped and no fault, and serves when it is
    /// asked to start over with the mark gone. Stopped while it serves, it ends
    /// the open session by that reason, and what the process holds is still held.
    #[tokio::test(start_paused = true)]
    async fn a_stopped_gateway_waits_to_be_started() {
        let log = Arc::new(Mutex::new(Vec::new()));
        let (shared, mut reloads) = Shared::<Scripted>::new();
        let (stop, stopped) = oneshot::channel::<()>();
        let started = AtomicUsize::new(0);
        let start = || {
            let number = started.fetch_add(1, Ordering::SeqCst) + 1;
            log.lock().unwrap().push(format!("{number} started"));
            Ok(Scripted { number, log: Arc::clone(&log), fail: tokio::sync::Notify::new() })
        };
        // The mark, as the folder has it: there when the process starts.
        let on = std::sync::atomic::AtomicBool::new(false);
        let wanted = || on.load(Ordering::SeqCst);
        let asking = async {
            // Many waits in, nothing was tried.
            tokio::time::sleep(QUICK.retry * 10).await;
            assert_eq!(started.load(Ordering::SeqCst), 0, "a stopped gateway starts no server by itself");
            let status = shared.status(Language::Portuguese).await;
            assert!(status.stopped && !status.serving, "{status:?}");
            assert_eq!(status.cause, None, "stopped by its owner is no fault");
            assert_eq!(status.listen, None);

            // Started: the mark goes, and it is asked to start over.
            on.store(true, Ordering::SeqCst);
            assert_eq!(shared.answer(Ask::Reload).await, serde_json::json!({ "reloaded": true }));
            let status = shared.status(Language::Portuguese).await;
            assert!(status.serving && !status.stopped, "{status:?}");
            assert_eq!(status.listen.as_deref(), Some("generation 1"));

            // And stopped again, while it serves.
            on.store(false, Ordering::SeqCst);
            assert_eq!(shared.answer(Ask::Reload).await, serde_json::json!({ "reloaded": true }));
            assert!(shared.status(Language::English).await.stopped);
            tokio::time::sleep(QUICK.retry * 10).await;
            stop.send(()).unwrap();
        };
        let stop = async {
            let _ = stopped.await;
        };
        tokio::join!(generations(start, wanted, &shared, &mut reloads, stop, QUICK, Held(Arc::clone(&log))), asking);

        assert_eq!(
            *log.lock().unwrap(),
            ["1 started", "1 told Stopped", "1 ended", "given back"],
            "one server, ended by the stop, and what is held given back only as the process ends"
        );
    }

    /// The mark is the folder's: left and taken away by the commands, there or
    /// not for whichever process looks, and a stopped gateway says so in the
    /// example the app's own tests read.
    #[test]
    fn a_stopped_gateway_says_so_as_the_app_reads_it() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!is_stopped(dir.path()));
        set_stopped(dir.path(), true).unwrap();
        assert!(is_stopped(dir.path()));
        set_stopped(dir.path(), true).unwrap();
        set_stopped(dir.path(), false).unwrap();
        assert!(!is_stopped(dir.path()));
        set_stopped(dir.path(), false).expect("taking away a mark that is not there is no error");

        let stopped = Status {
            version: "0.0.325".to_owned(),
            serving: false,
            stopped: true,
            listen: None,
            session: None,
            ffmpeg: true,
            cause: None,
            binary: Some("16777234-48213".to_owned()),
        };
        assert_eq!(serde_json::to_value(&stopped).unwrap(), json(STOPPED));
        assert_eq!(serde_json::from_str::<Status>(STOPPED).unwrap(), stopped);
    }

    /// A gateway says which file it was started from, and the command that asks
    /// it says whether that is the file the command itself is: an app replaced
    /// by a newer one finds the gateway of the one before still running.
    #[tokio::test]
    async fn a_gateway_says_the_file_it_was_started_from() {
        let own = own_binary().expect("a test is run from a file");
        let (shared, _reloads) = Shared::<Scripted>::new();
        let status = shared.status(Language::English).await;
        assert_eq!(status.binary.as_deref(), Some(own.as_str()));
        // Another file, the same bytes: another number.
        let dir = tempfile::tempdir().unwrap();
        let copy = dir.path().join("alumia");
        std::fs::copy(std::env::current_exe().unwrap(), &copy).unwrap();
        assert_ne!(binary_of(&copy).unwrap(), own);
        assert_eq!(binary_of(Path::new("/nonexistent/alumia")), None);

        // The file is the one the process was started from, read then: with
        // another put at its path, as an app that replaces the installed one
        // does, the gateway that was running still says the one it runs.
        let (replaced, _reloads) = Shared::<Scripted>::started_from(Some(&copy));
        let before = binary_of(&copy).unwrap();
        std::fs::rename(&copy, dir.path().join("alumia-before")).unwrap();
        std::fs::copy(std::env::current_exe().unwrap(), &copy).unwrap();
        assert_ne!(binary_of(&copy).unwrap(), before, "another file is at its path now");
        let said = replaced.status(Language::English).await.binary;
        assert_eq!(said.as_deref(), Some(before.as_str()), "and the gateway says the one it was started from");

        let said = serde_json::to_string(&status).unwrap();
        let current = |answer: &str, own: Option<&str>| json(&told_current(answer, own))["current"].clone();
        assert_eq!(current(&said, Some(&own)), true);
        assert_eq!(current(&said, Some("1-2")), false, "started from another file than the command's");
        // A gateway from before it said so is not the one in the bundle either.
        assert_eq!(current(r#"{"version":"0.0.325","serving":true}"#, Some(&own)), false);
        assert_eq!(current(r#"{"version":"0.0.325","binary":null}"#, Some(&own)), false);
        // A command that cannot tell its own file accuses nobody.
        assert_eq!(current(&said, None), true);
        // Everything else the gateway said is passed on as it was, and what is
        // not an answer of its own is passed on whole.
        let mut passed = json(&told_current(&said, Some(&own)));
        passed.as_object_mut().unwrap().remove("current");
        assert_eq!(passed, json(&said));
        assert_eq!(told_current("not json", Some(&own)), "not json");
    }

    /// The log is a file of the folder's, its owner's alone, added to from one
    /// run to the next, and begun again past its limit with the one before it
    /// kept beside it.
    #[test]
    fn the_log_is_the_owners_and_starts_over_at_its_limit() {
        use std::io::Write as _;
        use std::os::unix::fs::PermissionsExt as _;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("gateway.log");
        let before = dir.path().join("gateway.log.1");
        let read = |path: &Path| std::fs::read_to_string(path).unwrap();

        let mut log = Log::default();
        log.keep_within(dir.path(), 64);
        log.write_all(b"the first line\n").unwrap();
        assert_eq!(read(&path), "the first line\n");
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600, "the owner's alone");
        assert!(!before.exists());

        // The next process adds to it.
        let mut log = Log::default();
        log.keep_within(dir.path(), 64);
        log.write_all(b"the second line\n").unwrap();
        assert_eq!(read(&path), "the first line\nthe second line\n");

        // Past its limit while it runs, the next line begins another.
        let long = format!("{}\n", "x".repeat(48));
        log.write_all(long.as_bytes()).unwrap();
        assert!(!before.exists(), "the line that passes the limit is still this log's");
        log.write_all(b"after the limit\n").unwrap();
        assert_eq!(read(&path), "after the limit\n");
        assert_eq!(read(&before), format!("the first line\nthe second line\n{long}"), "the one before is kept whole");
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);

        // And one found past its limit at the start is begun again the same
        // way, the older of the two kept ones gone.
        log.write_all(long.as_bytes()).unwrap();
        let mut log = Log::default();
        log.keep_within(dir.path(), 64);
        log.write_all(b"a new run\n").unwrap();
        assert_eq!(read(&path), "a new run\n");
        assert_eq!(read(&before), format!("after the limit\n{long}"));
        let left: std::collections::BTreeSet<_> =
            std::fs::read_dir(dir.path()).unwrap().map(|entry| entry.unwrap().file_name()).collect();
        assert_eq!(left.len(), 2, "one log and the one before it: {left:?}");

        // A folder that is not there keeps the log where it was, and no file.
        let nowhere = Log::default();
        nowhere.keep_within(Path::new("/nonexistent/alumia"), 64);
        assert!(nowhere.0.lock().unwrap().is_none());
    }

    /// What a form of the app can be refused for is said in the app's words: a
    /// pane and a field, where the terminal's sentence for the same cause names a
    /// key of the settings file or an option of the command line.
    #[test]
    fn a_form_is_refused_in_the_apps_words() {
        let mac = |extra: &str| format!(r#"{{"name":"m","protocol":"vnc","subtype":"ard-mirror","host":"192.0.2.9"{extra}}}"#);
        // Each refusal a form reaches, by the change that makes it.
        let refused = [
            ("AL-9511", r#"{"computers":[]}"#.to_owned()),
            ("AL-9519", r#"{"computers":[{"name":"","protocol":"vnc","host":"192.0.2.9"}]}"#.to_owned()),
            ("AL-9520", r#"{"computers":[{"name":"pc-da-sala","host":""}]}"#.to_owned()),
            (
                "AL-9521",
                r#"{"computers":[{"name":"a","protocol":"vnc","host":"192.0.2.9"},{"name":"a","protocol":"vnc","host":"192.0.2.8"}]}"#
                    .to_owned(),
            ),
            ("AL-9536", format!(r#"{{"computers":[{}]}}"#, mac(""))),
            ("AL-9538", r#"{"computers":[{"name":"v","protocol":"vnc","host":"192.0.2.9","username":"ana"}]}"#.to_owned()),
            ("AL-9540", r#"{"computers":[{"name":"w","protocol":"rdp","host":"192.0.2.9"}]}"#.to_owned()),
            (
                "AL-9563",
                r#"{"computers":[{"name":"w","protocol":"rdp","host":"192.0.2.9","username":"u","password":"p","virtual_displays":3}]}"#
                    .to_owned(),
            ),
            ("AL-9564", format!(r#"{{"computers":[{}]}}"#, mac(r#","username":"u","password":"p","virtual_displays":2"#))),
        ];
        // What only a terminal's sentence has: the file's own syntax, an option, a
        // command to run, and a key of the file written as a word of the
        // sentence. English has `host`, `name`, `username`, `password` and
        // `listen` as words of its own, so there only the keys that are none.
        let syntax = ["[[", "[server]", "--", "`", "site_passwd", "vnc_password"];
        let keys = |language: Language| -> &'static [&'static str] {
            match language {
                Language::Portuguese => {
                    &["host", "name", "username", "password", "subtype", "subtipo", "rdp", "vnc", "listen", "targets"]
                }
                Language::English => &["subtype", "rdp", "vnc", "targets"],
            }
        };
        let of_the_app = |code: &str, language: Language, says: &str| {
            for mark in syntax {
                assert!(!says.contains(mark), "{code} says {mark:?} to the app: {says}");
            }
            for word in says.split(|c: char| !c.is_alphanumeric() && c != '_') {
                assert!(!keys(language).contains(&word), "{code} names the key {word:?} to the app: {says}");
            }
            assert!(!says.contains('{'), "{code} has a place nothing fills: {says}");
        };
        for (code, change) in &refused {
            let dir = settings(BEFORE);
            let error = apply_at(dir.path(), change, COST).expect_err(code);
            let both = [Language::Portuguese, Language::English].map(|language| (language, refusal(language, &error)));
            for (language, told) in &both {
                assert_eq!(&told.code, code, "{change}: {told:?}");
                of_the_app(code, *language, &told.says);
            }
            let both = both.map(|(_, told)| told);
            assert_ne!(both[0].says, both[1].says, "{code} in each language");
            // And a terminal is still told the same cause in its own words.
            let terminal_says = words::message_in(Language::English, &crate::cause::or_general(&error, "AL-9900")).unwrap();
            assert_ne!(terminal_says, both[1].says, "{code}: the terminal's sentence is its own");
        }

        // The other causes a form reaches by the gateway and not by the check:
        // a port somebody else has, a port that is not one, a page with no login.
        for (code, fill) in [("AL-9411", Some(("address", "127.0.0.1:52380"))), ("AL-9545", None), ("AL-9546", None), ("AL-9547", None)] {
            let mut cause = Cause::new(code);
            if let Some((hole, value)) = fill {
                cause = cause.with(hole, value);
            }
            let error = cause.of(anyhow::anyhow!("its own words"));
            for language in [Language::Portuguese, Language::English] {
                let told = refusal(language, &error);
                assert_eq!(told.code, code);
                of_the_app(code, language, &told.says);
            }
        }
        // A cause with no words of the app's is told as the terminal is told it.
        let unset = Cause::new("AL-9901").of(anyhow::anyhow!("no settings yet"));
        assert_eq!(
            refusal(Language::English, &unset).says,
            words::message_in(Language::English, &Cause::new("AL-9901")).unwrap()
        );
    }
}
