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
//! needed, so a macOS without it costs a warning and nothing else. A display
//! disabled this way stays disabled only while the process that disabled it holds
//! its connection to `WindowServer`, which is why the gateway enables it before it
//! exits; a gateway killed outright cannot, and leaves the display to the lid.

use std::ffi::{c_char, c_void};
use std::sync::Mutex;
use std::time::Duration;

use log::{debug, info, warn};

type CGDirectDisplayID = u32;
type CGDisplayConfigRef = *mut c_void;
type CGError = i32;

/// `kCGConfigureForSession`: the change lasts for the login session, never
/// written to the display preferences.
const CONFIGURE_FOR_SESSION: u32 = 1;

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

/// Enable or disable `display` for this login session.
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
        let err = CGCompleteDisplayConfiguration(config, CONFIGURE_FOR_SESSION);
        anyhow::ensure!(err == 0, "could not complete the display configuration (CGError {err})");
    }
    Ok(())
}

/// After a session that put this Mac on a virtual display ends: wait for the Mac to
/// bring its physical displays back, and with the lid closed disable the built-in
/// one it brought back, then enable it when the lid opens. On a thread of its own,
/// since the session's runtime goes away with the session.
pub fn after_private_session() {
    let spawned = std::thread::Builder::new().name("mac-displays".into()).spawn(|| {
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
        if let Err(e) = set_enabled(display, false) {
            warn!("mac: the lid is closed but the built-in display came back on, and could not be turned off: {e:#}");
            return;
        }
        info!("mac: turned the built-in display back off, the lid being closed");
        *HELD.lock().unwrap() = Some(display);
        while !to_enable(lid_closed()) {
            std::thread::sleep(LID_STEP);
            if HELD.lock().unwrap().is_none() {
                return;
            }
        }
        release();
    });
    if let Err(e) = spawned {
        warn!("mac: could not watch the displays after the session: {e}");
    }
}

/// Enable the built-in display again if the gateway turned it off: when the lid
/// opens, and when the gateway stops.
pub fn release() {
    let Some(display) = HELD.lock().unwrap().take() else {
        return;
    };
    match set_enabled(display, true) {
        Ok(()) => info!("mac: turned the built-in display back on"),
        Err(e) => warn!("mac: could not turn the built-in display back on: {e:#}"),
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
}
