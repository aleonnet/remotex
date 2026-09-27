//! Owner-only access on Windows: what `0600` and `0700` are to the Unix control plane.
//!
//! Two things are private there, and both are made so by a DACL naming this user:
//! the named pipe a worker listens on, and the instance directories that hold the
//! targets' credentials. The DACL is *protected* — nothing inherited from above is
//! merged into it — because inheritance is how a directory made under `C:\` would
//! otherwise hand every local user read access to the passwords.
//!
//! The user is read from this process's token rather than named by a well-known SID.
//! `OWNER RIGHTS` would follow the object's owner, and an elevated administrator's
//! objects are owned by `BUILTIN\Administrators`, which is a group of people.

use std::ffi::c_void;
use std::io;
use std::os::windows::ffi::OsStrExt as _;
use std::path::Path;

use anyhow::Context as _;
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, LocalFree};
use windows_sys::Win32::Security::Authorization::{
    ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
    SE_FILE_OBJECT, SetNamedSecurityInfoW,
};
use windows_sys::Win32::Security::{
    ACL, DACL_SECURITY_INFORMATION, GetSecurityDescriptorDacl, GetTokenInformation,
    PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES, TOKEN_QUERY,
    TOKEN_USER, TokenUser,
};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

/// A security descriptor allocated by `ConvertStringSecurityDescriptorToSecurityDescriptorW`.
pub struct SecurityDescriptor(PSECURITY_DESCRIPTOR);

// The descriptor is written once, by the conversion, and only read after that — by
// every pipe instance a worker creates, from whichever task creates it.
unsafe impl Send for SecurityDescriptor {}
unsafe impl Sync for SecurityDescriptor {}

impl SecurityDescriptor {
    /// Full access for this user and nothing for anyone else: a worker's pipe.
    pub fn pipe() -> io::Result<Self> {
        Self::from_sddl(&format!("D:P(A;;GA;;;{})", current_user_sid()?))
    }

    /// The same for a directory and everything created in it, with `SYSTEM`
    /// beside the user as root is beside a `0700` directory's owner.
    fn directory() -> io::Result<Self> {
        Self::from_sddl(&format!("D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;{})", current_user_sid()?))
    }

    fn from_sddl(sddl: &str) -> io::Result<Self> {
        let wide = wide(sddl);
        let mut descriptor: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
        // SAFETY: `wide` is NUL-terminated and outlives the call; on success the
        // descriptor is a LocalAlloc'd block this value now owns.
        let converted = unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                wide.as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor,
                std::ptr::null_mut(),
            )
        };
        if converted == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(Self(descriptor))
    }

    /// `SECURITY_ATTRIBUTES` pointing at this descriptor, valid while it lives.
    pub fn attributes(&self) -> SECURITY_ATTRIBUTES {
        SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: self.0,
            bInheritHandle: 0,
        }
    }

    fn dacl(&self) -> io::Result<*mut ACL> {
        let (mut present, mut defaulted) = (0, 0);
        let mut dacl: *mut ACL = std::ptr::null_mut();
        // SAFETY: the descriptor is valid for as long as `self`, and the DACL
        // pointer it yields points into it.
        let ok = unsafe { GetSecurityDescriptorDacl(self.0, &mut present, &mut dacl, &mut defaulted) };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        if present == 0 || dacl.is_null() {
            return Err(io::Error::other("the owner-only descriptor has no DACL"));
        }
        Ok(dacl)
    }
}

impl Drop for SecurityDescriptor {
    fn drop(&mut self) {
        // SAFETY: allocated by the conversion with LocalAlloc, freed once.
        unsafe { LocalFree(self.0) };
    }
}

/// Replace `path`'s DACL with this user's and `SYSTEM`'s alone, inherited by
/// everything under it — the files already there included, which is how a config
/// written before the directory was made private becomes private too.
pub fn protect_directory(path: &Path) -> anyhow::Result<()> {
    let descriptor = SecurityDescriptor::directory()
        .context("cannot build an owner-only security descriptor")?;
    let dacl = descriptor
        .dacl()
        .context("cannot read the owner-only security descriptor")?;
    let name: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    // SAFETY: `name` is NUL-terminated, `dacl` points into `descriptor`, and both
    // outlive the call.
    let status = unsafe {
        SetNamedSecurityInfoW(
            name.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            dacl,
            std::ptr::null(),
        )
    };
    if status != 0 {
        return Err(io::Error::from_raw_os_error(status as i32))
            .with_context(|| format!("cannot make {} private", path.display()));
    }
    Ok(())
}

/// This process's user, as an SDDL SID string (`S-1-5-21-…`).
fn current_user_sid() -> io::Result<String> {
    let mut token: HANDLE = std::ptr::null_mut();
    // SAFETY: the pseudo-handle needs no closing; `token` is closed below.
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let sid = token_user_sid(token);
    // SAFETY: opened above and closed once.
    unsafe { CloseHandle(token) };
    sid
}

fn token_user_sid(token: HANDLE) -> io::Result<String> {
    let mut length = 0u32;
    // SAFETY: a size query — no buffer, and the call fails with the length needed.
    unsafe { GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut length) };
    // `u64`s so the buffer is aligned for the `TOKEN_USER` read out of its head.
    let mut buffer = vec![0u64; (length as usize).div_ceil(8)];
    // SAFETY: the buffer holds `length` bytes.
    let ok = unsafe {
        GetTokenInformation(
            token,
            TokenUser,
            buffer.as_mut_ptr().cast::<c_void>(),
            length,
            &mut length,
        )
    };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: filled by the call above, aligned, and the SID it points to lives in
    // the same buffer.
    let user = unsafe { &*buffer.as_ptr().cast::<TOKEN_USER>() };
    let mut text = std::ptr::null_mut();
    // SAFETY: the SID is valid while `buffer` is; on success `text` is a
    // LocalAlloc'd NUL-terminated string, freed below.
    if unsafe { ConvertSidToStringSidW(user.User.Sid, &mut text) } == 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: NUL-terminated, as the conversion promises.
    let length = unsafe { (0..).take_while(|&i| *text.add(i) != 0).count() };
    // SAFETY: `length` UTF-16 units precede the NUL.
    let sid = String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(text, length) });
    // SAFETY: allocated by the conversion, freed once.
    unsafe { LocalFree(text.cast()) };
    Ok(sid)
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::Security::Authorization::{
        ConvertSecurityDescriptorToStringSecurityDescriptorW, GetNamedSecurityInfoW,
    };

    /// `sddl` as Windows itself spells it, well-known SIDs as their aliases (the
    /// built-in Administrator is `LA`, not its `S-1-5-21-…-500`).
    fn canonical(sddl: &str) -> String {
        sddl_of(SecurityDescriptor::from_sddl(sddl).unwrap().0)
    }

    /// The DACL's flags (`P` protected, `AI` auto-inherited) and its entries.
    fn split(sddl: &str) -> (String, String) {
        let body = sddl.strip_prefix("D:").unwrap_or_else(|| panic!("not a DACL: {sddl}"));
        let entries = body.find('(').unwrap_or(body.len());
        (body[..entries].to_owned(), body[entries..].to_owned())
    }

    /// The DACL on `path`, as SDDL.
    fn dacl_sddl(path: &Path) -> String {
        let name: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let mut descriptor: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
        // SAFETY: `name` is NUL-terminated; the descriptor is LocalAlloc'd and freed below.
        let status = unsafe {
            GetNamedSecurityInfoW(
                name.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut descriptor,
            )
        };
        assert_eq!(status, 0, "cannot read the DACL of {}", path.display());
        let sddl = sddl_of(descriptor);
        // SAFETY: allocated by the call above, freed once.
        unsafe { LocalFree(descriptor) };
        sddl
    }

    fn sddl_of(descriptor: PSECURITY_DESCRIPTOR) -> String {
        let mut text = std::ptr::null_mut();
        let mut length = 0u32;
        // SAFETY: the descriptor is valid for the call; `text` is LocalAlloc'd.
        let ok = unsafe {
            ConvertSecurityDescriptorToStringSecurityDescriptorW(
                descriptor,
                SDDL_REVISION_1,
                DACL_SECURITY_INFORMATION,
                &mut text,
                &mut length,
            )
        };
        assert_ne!(ok, 0, "{}", io::Error::last_os_error());
        // SAFETY: `length` counts the units written, NUL included.
        let sddl = String::from_utf16_lossy(unsafe {
            std::slice::from_raw_parts(text, length.saturating_sub(1) as usize)
        });
        // SAFETY: allocated by the conversion, freed once.
        unsafe { LocalFree(text.cast()) };
        sddl.trim_end_matches('\0').to_owned()
    }

    /// The directory ends up readable by this user and `SYSTEM` alone, with
    /// nothing inherited from above — and a file written into it afterwards, as a
    /// config is, carries the same two entries and nothing else.
    #[test]
    fn a_protected_directory_admits_this_user_and_system_only() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("instances");
        std::fs::create_dir(&dir).unwrap();
        protect_directory(&dir).unwrap();

        let user = current_user_sid().unwrap();
        assert!(user.starts_with("S-1-"), "{user}");
        let (flags, entries) = split(&dacl_sddl(&dir));
        assert!(flags.contains('P'), "nothing is inherited from above: {flags}");
        let (_, expected) = split(&canonical(&format!("D:(A;OICI;FA;;;SY)(A;OICI;FA;;;{user})")));
        assert_eq!(entries, expected);

        let config = dir.join("remotex.toml");
        std::fs::write(&config, "").unwrap();
        let (_, entries) = split(&dacl_sddl(&config));
        let (_, expected) = split(&canonical(&format!("D:(A;ID;FA;;;SY)(A;ID;FA;;;{user})")));
        assert_eq!(entries, expected, "the config inherits the two entries and nothing else");
    }
}
