//! A log file of dated lines, one per event: what the service did with a session, and
//! what a session's agent did with its channel and its capture. Nothing per frame.

use std::fs::{File, OpenOptions};
use std::io::Write as _;
use std::os::windows::fs::{MetadataExt as _, OpenOptionsExt as _};
use std::path::{Path, PathBuf};

use windows::Win32::Storage::FileSystem::{FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_OPEN_REPARSE_POINT};

/// Past this, a log is kept once as `<name>.old.log` and started again, at the next
/// start of whatever writes it.
const KEEP: u64 = 1 << 20;

pub struct Log(Option<File>);

impl Log {
    /// The log at `path`, appended to, its directory made if it is missing. A log that
    /// cannot be opened is no reason to stop: its lines are dropped, as are those of a
    /// log that is a link, which is not followed.
    pub fn open(path: &Path) -> Self {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if std::fs::symlink_metadata(path).is_ok_and(|meta| meta.len() > KEEP) {
            let _ = std::fs::rename(path, path.with_extension("old.log"));
        }
        let file = OpenOptions::new().create(true).append(true).custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0).open(path).ok();
        Self(file.filter(|file| file.metadata().is_ok_and(|meta| meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 == 0)))
    }

    /// One line, dated in UTC to the millisecond.
    pub fn say(&mut self, what: impl AsRef<str>) {
        if let Some(file) = &mut self.0 {
            let line = format!("{:.3} {}\n", jiff::Timestamp::now(), what.as_ref());
            let _ = file.write_all(line.as_bytes());
            let _ = file.flush();
        }
    }
}

/// Where the service's log of this name goes: `%SystemRoot%\System32\LogFiles\remotex-agent`,
/// where only SYSTEM and Administrators may make a file or a directory. Not
/// `%ProgramData%`, where any user may make the directory first, or write into one
/// LocalSystem made there, and have the service write through a link of theirs.
pub fn service_path(name: &str) -> PathBuf {
    let root = std::env::var_os("SystemRoot").map_or_else(|| PathBuf::from(r"C:\Windows"), PathBuf::from);
    root.join(r"System32\LogFiles\remotex-agent").join(name)
}

/// Where a session's log of this name goes: `%LOCALAPPDATA%\remotex-agent`, which is
/// its user's, as the agent is.
pub fn session_path(name: &str) -> PathBuf {
    let root = std::env::var_os("LOCALAPPDATA").map_or_else(std::env::temp_dir, PathBuf::from);
    root.join("remotex-agent").join(name)
}
