//! The Mac's own built-in display, for a gateway that runs on the Mac it serves.
//!
//! A High Performance session's virtual display is destroyed by the Mac the moment
//! the connection closes, and macOS then enables every physical display, the
//! built-in one of a MacBook whose lid is closed included: `WindowServer` logs
//! `Display 1 setEnabled:1` in the same millisecond as `virtualDisplayDestroy`, where
//! creating the virtual display had disabled only the external one. Both displays
//! on brings back the arrangement macOS keeps for the pair, so the external display
//! changes its scaled size as well. Nothing undoes it but the lid: `powerd` logs
//! `Clamshell state changed` when the lid is lifted and lowered, and only then does
//! `WindowServer` disable the built-in display again. Measured on macOS 27.0.1 with
//! a MacBook Pro driving a Studio Display, lid closed, in every session.
//!
//! So after such a session ends on this host, the gateway disables the built-in
//! display itself while the lid stays closed, and enables it again when the lid
//! opens or the gateway stops. macOS has no public call that disables a display:
//! this uses `CGSConfigureDisplayEnabled`, which CoreGraphics exports from SkyLight
//! and which display utilities use for the same purpose. It is looked up when it is
//! needed, so a macOS without it costs a warning and nothing else; its declaration
//! is display utilities' (displayplacer's `src/Header.h`: `CGError
//! CGSConfigureDisplayEnabled(CGDisplayConfigRef config, CGDirectDisplayID display,
//! bool enabled);`). The change is completed for this process alone
//! (`kCGConfigureForAppOnly`), which Apple's `CGDisplayConfiguration.h` documents
//! the system as reverting when the process ends: a gateway killed outright leaves
//! the display on, as macOS left it, and never dark. The gateway enables it itself
//! when the lid opens and when it stops.
//!
//! A process that ends therefore lights the display, and the Mac app's gateway is
//! restarted without anybody at the Mac: by an update, or after a crash. So that
//! gateway leaves a mark in its own folder while it holds the display off
//! ([`resume_in`]), and the process that starts there next takes the hold up
//! again where the mark is and the rule still says off: the lid closed and the
//! display on. The mark outlives the process, which is its point, and goes when
//! the lid opens.

use std::ffi::{c_char, c_void};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use log::{debug, info, warn};

type CGDirectDisplayID = u32;
type CGDisplayConfigRef = *mut c_void;
type CGError = i32;

/// `kCGConfigureForAppOnly`: the change lasts while this process runs.
const CONFIGURE_FOR_APP_ONLY: u32 = 0;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGGetOnlineDisplayList(max: u32, displays: *mut CGDirectDisplayID, count: *mut u32) -> CGError;
    fn CGDisplayIsBuiltin(display: CGDirectDisplayID) -> u32;
    fn CGDisplayIsActive(display: CGDirectDisplayID) -> u32;
    fn CGBeginDisplayConfiguration(config: *mut CGDisplayConfigRef) -> CGError;
    fn CGCompleteDisplayConfiguration(config: CGDisplayConfigRef, option: u32) -> CGError;
    fn CGCancelDisplayConfiguration(config: CGDisplayConfigRef) -> CGError;
}

#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    fn IOServiceMatching(name: *const c_char) -> *mut c_void;
    fn IOServiceGetMatchingService(main_port: u32, matching: *mut c_void) -> u32;
    fn IORegistryEntryCreateCFProperty(entry: u32, key: *const c_void, allocator: *const c_void, options: u32) -> *const c_void;
    fn IOObjectRelease(object: u32) -> i32;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFStringCreateWithCString(allocator: *const c_void, text: *const c_char, encoding: u32) -> *const c_void;
    fn CFGetTypeID(value: *const c_void) -> usize;
    fn CFBooleanGetTypeID() -> usize;
    fn CFBooleanGetValue(value: *const c_void) -> u8;
    fn CFRelease(value: *const c_void);
}

unsafe extern "C" {
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
}

/// `RTLD_DEFAULT` on macOS: every image the process has loaded.
const RTLD_DEFAULT: *mut c_void = -2isize as *mut c_void;

/// `kCFStringEncodingUTF8`.
const UTF8: u32 = 0x0800_0100;

/// How long the Mac may take, after a session ends, to bring its physical displays
/// back: it enables them about a second after the connection closes.
const SETTLE: Duration = Duration::from_secs(5);
/// How often the displays are looked at while they settle.
const SETTLE_STEP: Duration = Duration::from_millis(250);
/// How often the lid is looked at while the gateway holds the built-in display off.
const LID_STEP: Duration = Duration::from_secs(1);

/// The built-in display the gateway has disabled, and so owes enabling again.
static HELD: Mutex<Option<CGDirectDisplayID>> = Mutex::new(None);

/// What to do once a session that put this Mac on a virtual display has ended:
/// the built-in display to disable, where the lid is closed and that display came
/// back on. Unknown either way is no action.
fn to_disable(lid_closed: Option<bool>, built_in: Option<(CGDirectDisplayID, bool)>) -> Option<CGDirectDisplayID> {
    match (lid_closed, built_in) {
        (Some(true), Some((display, true))) => Some(display),
        _ => None,
    }
}

/// Whether a built-in display the gateway holds off is owed back on: the lid
/// opened, or it can no longer be read, which is no reason to keep a display dark.
fn to_enable(lid_closed: Option<bool>) -> bool {
    lid_closed != Some(true)
}

/// The built-in display a starting gateway takes up holding off again: only where
/// the process before it left its mark, and where what [`to_disable`] asks still
/// holds. Without the mark nothing here ever turned that display off, and it is
/// nobody's to touch.
fn to_resume(
    marked: bool,
    lid_closed: Option<bool>,
    built_in: Option<(CGDirectDisplayID, bool)>,
) -> Option<CGDirectDisplayID> {
    if marked { to_disable(lid_closed, built_in) } else { None }
}

/// The note that a gateway of this folder holds the built-in display off.
struct Mark(PathBuf);

impl Mark {
    fn in_dir(dir: &Path) -> Self {
        Self(dir.join("display-held"))
    }

    fn is_there(&self) -> bool {
        self.0.exists()
    }

    fn write(&self) {
        if let Err(e) = std::fs::write(&self.0, b"") {
            warn!("mac: could not note the built-in display as held in {}: {e}", self.0.display());
        }
    }

    fn remove(&self) {
        match std::fs::remove_file(&self.0) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => warn!("mac: could not remove {}: {e}", self.0.display()),
        }
    }
}

/// The mark of the gateway this process is, where it keeps one ([`resume_in`]).
static MARK: OnceLock<Mark> = OnceLock::new();

/// Whether the lid is closed, from the power manager's `AppleClamshellState`.
fn lid_closed() -> Option<bool> {
    // SAFETY: each Create/Matching result is checked before use and released once;
    // `IOServiceMatching`'s dictionary is consumed by `IOServiceGetMatchingService`.
    unsafe {
        let service = IOServiceGetMatchingService(0, IOServiceMatching(c"IOPMrootDomain".as_ptr()));
        if service == 0 {
            return None;
        }
        let key = CFStringCreateWithCString(std::ptr::null(), c"AppleClamshellState".as_ptr(), UTF8);
        let value = if key.is_null() {
            std::ptr::null()
        } else {
            IORegistryEntryCreateCFProperty(service, key, std::ptr::null(), 0)
        };
        if !key.is_null() {
            CFRelease(key);
        }
        IOObjectRelease(service);
        if value.is_null() {
            return None;
        }
        let closed = (CFGetTypeID(value) == CFBooleanGetTypeID()).then(|| CFBooleanGetValue(value) != 0);
        CFRelease(value);
        closed
    }
}

/// The built-in display, and whether it is active.
fn built_in() -> Option<(CGDirectDisplayID, bool)> {
    let mut displays = [0 as CGDirectDisplayID; 16];
    let mut count = 0u32;
    // SAFETY: the list holds `displays.len()` entries, and `count` says how many
    // were written.
    let err = unsafe { CGGetOnlineDisplayList(displays.len() as u32, displays.as_mut_ptr(), &mut count) };
    if err != 0 {
        return None;
    }
    displays[..count as usize]
        .iter()
        // SAFETY: plain queries on display ids the system just listed.
        .find(|&&display| unsafe { CGDisplayIsBuiltin(display) } != 0)
        .map(|&display| (display, unsafe { CGDisplayIsActive(display) } != 0))
}

/// Enable or disable `display`, for as long as this process runs.
fn set_enabled(display: CGDirectDisplayID, enabled: bool) -> anyhow::Result<()> {
    type ConfigureEnabled = unsafe extern "C" fn(CGDisplayConfigRef, CGDirectDisplayID, bool) -> CGError;
    // SAFETY: a symbol of this name is CoreGraphics' re-export of SkyLight's, with
    // this signature; a missing one is refused before any configuration begins.
    let symbol = unsafe { dlsym(RTLD_DEFAULT, c"CGSConfigureDisplayEnabled".as_ptr()) };
    anyhow::ensure!(!symbol.is_null(), "this macOS has no CGSConfigureDisplayEnabled");
    let configure: ConfigureEnabled = unsafe { std::mem::transmute(symbol) };
    let mut config: CGDisplayConfigRef = std::ptr::null_mut();
    // SAFETY: a configuration is begun, then completed or cancelled, exactly once.
    unsafe {
        let err = CGBeginDisplayConfiguration(&mut config);
        anyhow::ensure!(err == 0, "could not begin a display configuration (CGError {err})");
        let err = configure(config, display, enabled);
        if err != 0 {
            CGCancelDisplayConfiguration(config);
            anyhow::bail!("could not set display {display} enabled={enabled} (CGError {err})");
        }
        let err = CGCompleteDisplayConfiguration(config, CONFIGURE_FOR_APP_ONLY);
        anyhow::ensure!(err == 0, "could not complete the display configuration (CGError {err})");
    }
    Ok(())
}

/// Held by a session that put a Mac on a virtual display, from its connect on: the
/// session's end, by any way out, is when the Mac at `dest` brings its physical
/// displays back. Acts only where `dest` is this host.
pub struct AfterPrivateSession {
    pub dest: String,
}

impl Drop for AfterPrivateSession {
    fn drop(&mut self) {
        let dest = std::mem::take(&mut self.dest);
        let spawned = std::thread::Builder::new()
            .name("mac-displays".into())
            .spawn(move || settle(&dest));
        if let Err(e) = spawned {
            warn!("mac: could not watch the displays after the session: {e}");
        }
    }
}

/// Wait for the Mac at `dest`, this one, to bring its physical displays back, and
/// with the lid closed turn the built-in one off again; then hold it off until the
/// lid opens. One thread holds the display at a time: a later session's end that
/// finds it already held turns it off again and leaves the watching to the holder.
fn settle(dest: &str) {
    if !crate::engine::is_this_host(dest) {
        return;
    }
    let deadline = std::time::Instant::now() + SETTLE;
    let display = loop {
        if let Some(display) = to_disable(lid_closed(), built_in()) {
            break display;
        }
        if std::time::Instant::now() >= deadline {
            debug!("mac: the built-in display stayed as the lid has it after the session");
            return;
        }
        std::thread::sleep(SETTLE_STEP);
    };
    hold(display, MARK.get());
}

/// Turn `display`, the built-in one, off and hold it off until the lid opens,
/// noting the hold in `mark` where the gateway keeps one.
fn hold(display: CGDirectDisplayID, mark: Option<&Mark>) {
    {
        // Held across the change, so a release cannot slip between the two.
        let mut held = HELD.lock().unwrap();
        if let Err(e) = set_enabled(display, false) {
            warn!("mac: the lid is closed but the built-in display is on, and could not be turned off: {e:#}");
            return;
        }
        info!("mac: turned the built-in display back off, the lid being closed");
        if let Some(mark) = mark {
            mark.write();
        }
        if held.replace(display).is_some() {
            return;
        }
    }
    while !to_enable(lid_closed()) {
        std::thread::sleep(LID_STEP);
        if HELD.lock().unwrap().is_none() {
            return;
        }
    }
    give_back(Ended::LidOpened, mark);
}

/// Why a hold on the built-in display ends.
#[derive(Clone, Copy)]
enum Ended {
    /// The lid opened: no later process has a hold to take up from.
    LidOpened,
    /// The gateway stops: the process that starts next takes the hold up.
    Stopped,
}

/// The hold ends: the display is given back, and the mark goes with it only
/// where the lid opened. A gateway that stops leaves it, which is all that tells
/// the next one there was a hold.
fn give_back(why: Ended, mark: Option<&Mark>) {
    release();
    if let (Ended::LidOpened, Some(mark)) = (why, mark) {
        mark.remove();
    }
}

/// Keep this gateway's mark in `dir`, its own folder, and take up the hold a
/// process of that folder left there, where there is one to take up
/// ([`to_resume`]). A mark with nothing to hold any more is one the lid has
/// answered since, and goes.
pub fn resume_in(dir: &Path) {
    let mark = MARK.get_or_init(|| Mark::in_dir(dir));
    let spawned = std::thread::Builder::new().name("mac-displays".into()).spawn(move || {
        match to_resume(mark.is_there(), lid_closed(), built_in()) {
            Some(display) => {
                info!("mac: the gateway before this one held the built-in display off; holding it again");
                hold(display, Some(mark));
            }
            None => mark.remove(),
        }
    });
    if let Err(e) = spawned {
        warn!("mac: could not take up the hold of the built-in display: {e}");
    }
}

/// Enable the built-in display again if the gateway turned it off.
pub fn release() {
    let mut held = HELD.lock().unwrap();
    let Some(display) = held.take() else {
        return;
    };
    match set_enabled(display, true) {
        Ok(()) => info!("mac: turned the built-in display back on"),
        Err(e) => warn!("mac: could not turn the built-in display back on: {e:#}"),
    }
}

/// Held for the life of a gateway: whichever way it stops, it gives back a
/// built-in display it turned off.
pub struct ReleaseOnExit;

impl Drop for ReleaseOnExit {
    fn drop(&mut self) {
        give_back(Ended::Stopped, MARK.get());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// With the lid closed, the built-in display a private session's end brought
    /// back on is turned off again, and turned on when the lid opens or can no
    /// longer be read. Anything else is left as it is.
    #[test]
    fn the_built_in_display_is_put_back_off_after_a_private_session() {
        assert_eq!(to_disable(Some(true), Some((1, true))), Some(1), "lid closed, built-in back on");
        assert_eq!(to_disable(Some(true), Some((1, false))), None, "already off");
        assert_eq!(to_disable(Some(false), Some((1, true))), None, "the lid is open: it belongs on");
        assert_eq!(to_disable(None, Some((1, true))), None, "the lid unknown");
        assert_eq!(to_disable(Some(true), None), None, "no built-in display");

        assert!(!to_enable(Some(true)), "held off while the lid stays closed");
        assert!(to_enable(Some(false)), "back on when the lid opens");
        assert!(to_enable(None), "and when the lid cannot be read");
    }

    /// A gateway that starts holds the built-in display off again only where the
    /// one before it left its mark, the lid is closed and the display is on.
    #[test]
    fn holding_is_resumed_only_with_the_mark() {
        assert_eq!(to_resume(true, Some(true), Some((1, true))), Some(1), "marked, lid closed, display on");
        assert_eq!(to_resume(false, Some(true), Some((1, true))), None, "no mark: it was never this gateway's");
        assert_eq!(to_resume(true, Some(false), Some((1, true))), None, "the lid is open");
        assert_eq!(to_resume(true, None, Some((1, true))), None, "the lid unknown");
        assert_eq!(to_resume(true, Some(true), Some((1, false))), None, "already off");
        assert_eq!(to_resume(true, Some(true), None), None, "no built-in display");
    }

    /// The mark is written with the hold, outlives the process that wrote it,
    /// which gives the display back as it ends, and goes when the lid opens.
    #[test]
    fn the_mark_is_written_kept_on_exit_and_removed_by_the_lid() {
        let dir = tempfile::tempdir().unwrap();
        let mark = Mark::in_dir(dir.path());
        assert!(!mark.is_there());
        mark.write();
        assert!(mark.is_there());
        assert!(Mark::in_dir(dir.path()).is_there(), "it is the folder's, for the next process to find");

        // What a stopping gateway does. Nothing is held in a test, so no display is
        // touched: what is under test is that the mark stays.
        give_back(Ended::Stopped, Some(&mark));
        assert!(mark.is_there(), "the process ending keeps the mark");

        give_back(Ended::LidOpened, Some(&mark));
        assert!(!mark.is_there(), "the lid opening takes it away");
        // And taking away what is not there is not an error.
        give_back(Ended::LidOpened, Some(&mark));
        give_back(Ended::LidOpened, None);
    }
}
