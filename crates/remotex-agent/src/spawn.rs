//! What the service does to sessions: find the ones attached over RDP, start a session's
//! agent in one as its user, and stop it again.

use std::os::windows::ffi::OsStrExt as _;
use std::path::Path;
use std::time::Instant;

use anyhow::{Context as _, Result};
use windows::Win32::Foundation::{CloseHandle, ERROR_NO_TOKEN, HANDLE, WAIT_OBJECT_0};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Environment::{CreateEnvironmentBlock, DestroyEnvironmentBlock};
use windows::Win32::System::RemoteDesktop::{
    ProcessIdToSessionId, WTS_CURRENT_SERVER_HANDLE, WTS_SESSION_INFOW, WTSActive, WTSClientProtocolType,
    WTSEnumerateSessionsW, WTSFreeMemory, WTSQuerySessionInformationW, WTSQueryUserToken,
};
use windows::Win32::System::Threading::{
    CREATE_NO_WINDOW, CREATE_UNICODE_ENVIRONMENT, CreateProcessAsUserW, GetExitCodeProcess, OpenProcess, PROCESS_INFORMATION,
    PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE, QueryFullProcessImageNameW, STARTUPINFOW,
    TerminateProcess, WaitForSingleObject,
};
use windows::core::{PCWSTR, PWSTR};

/// `WTSClientProtocolType`'s answer for a session attached over RDP; the console's is 0.
const RDP: u16 = 2;

/// The sessions a user is logged on to and attached to over RDP: the ones whose
/// connection a session's agent can open its channel on.
pub fn remote_sessions() -> Result<Vec<u32>> {
    let mut sessions = Vec::new();
    unsafe {
        let mut info: *mut WTS_SESSION_INFOW = std::ptr::null_mut();
        let mut count = 0u32;
        WTSEnumerateSessionsW(Some(WTS_CURRENT_SERVER_HANDLE), 0, 1, &mut info, &mut count).context("WTSEnumerateSessionsW")?;
        for session in std::slice::from_raw_parts(info, count as usize) {
            if session.State == WTSActive && protocol(session.SessionId) == Some(RDP) {
                sessions.push(session.SessionId);
            }
        }
        WTSFreeMemory(info.cast());
    }
    Ok(sessions)
}

fn protocol(session: u32) -> Option<u16> {
    unsafe {
        let mut buffer = PWSTR::null();
        let mut len = 0u32;
        WTSQuerySessionInformationW(Some(WTS_CURRENT_SERVER_HANDLE), session, WTSClientProtocolType, &mut buffer, &mut len).ok()?;
        let protocol = (len as usize >= size_of::<u16>()).then(|| *(buffer.0 as *const u16));
        WTSFreeMemory(buffer.0.cast());
        protocol
    }
}

/// A session's agent, as the service started it.
pub struct Worker {
    process: HANDLE,
    pub pid: u32,
    pub started: Instant,
}

// SAFETY: a process handle is a number the kernel resolves.
unsafe impl Send for Worker {}

impl Worker {
    /// Its exit code, once it has exited.
    pub fn exited(&self) -> Option<u32> {
        unsafe {
            if WaitForSingleObject(self.process, 0) != WAIT_OBJECT_0 {
                return None;
            }
            let mut code = 0u32;
            let _ = GetExitCodeProcess(self.process, &mut code);
            Some(code)
        }
    }

    /// End it, and wait a moment for it to be gone. It holds nothing that ending it
    /// leaves broken: the channel closes with the process, and the gateway's pipeline
    /// carries the desktop.
    pub fn stop(self) {
        unsafe {
            let _ = TerminateProcess(self.process, 1);
            let _ = WaitForSingleObject(self.process, 2000);
        }
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.process);
        }
    }
}

/// Start `exe session` in a session as the user logged on to it, on that user's own
/// desktop and environment, with no console window. `None` when nobody is logged on to
/// the session yet — the logon screen of a connection still being made — which the
/// logon that follows puts right.
pub fn start(session: u32, exe: &Path) -> Result<Option<Worker>> {
    unsafe {
        let mut token = HANDLE::default();
        if let Err(e) = WTSQueryUserToken(session, &mut token) {
            if e.code() == ERROR_NO_TOKEN.to_hresult() {
                return Ok(None);
            }
            return Err(e).context("WTSQueryUserToken");
        }
        let started = spawn_as(token, exe);
        let _ = CloseHandle(token);
        started.map(Some)
    }
}

unsafe fn spawn_as(token: HANDLE, exe: &Path) -> Result<Worker> {
    unsafe {
        let mut environment = std::ptr::null_mut();
        CreateEnvironmentBlock(&mut environment, Some(token), false).context("CreateEnvironmentBlock")?;
        let wide = |text: &std::ffi::OsStr| text.encode_wide().chain([0]).collect::<Vec<u16>>();
        let application = wide(exe.as_os_str());
        let mut line = wide(&{
            let mut line = std::ffi::OsString::from("\"");
            line.push(exe.as_os_str());
            line.push("\" session");
            line
        });
        let mut desktop = wide("winsta0\\default".as_ref());
        let startup = STARTUPINFOW {
            cb: size_of::<STARTUPINFOW>() as u32,
            lpDesktop: PWSTR(desktop.as_mut_ptr()),
            ..Default::default()
        };
        let mut process = PROCESS_INFORMATION::default();
        let created = CreateProcessAsUserW(
            Some(token),
            PCWSTR(application.as_ptr()),
            Some(PWSTR(line.as_mut_ptr())),
            None,
            None,
            false,
            CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW,
            Some(environment),
            PCWSTR::null(),
            &startup,
            &mut process,
        );
        let _ = DestroyEnvironmentBlock(environment);
        created.context("CreateProcessAsUserW")?;
        let _ = CloseHandle(process.hThread);
        Ok(Worker { process: process.hProcess, pid: process.dwProcessId, started: Instant::now() })
    }
}

/// End every other process of this executable in a user's session: a session's agent
/// left by a service that did not stop cleanly, or one started by hand from the same
/// file, either of which would hold the channel a session's agent is about to open.
/// A process is this executable by its full path, not its name, which any program may
/// have. Returns how many.
pub fn stop_strays(exe: &Path) -> Result<usize> {
    let name: Vec<u16> = exe.file_name().context("the executable has no file name")?.encode_wide().collect();
    let path = exe.as_os_str().to_string_lossy().to_lowercase();
    let own = std::process::id();
    let mut stopped = 0;
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).context("CreateToolhelp32Snapshot")?;
        let mut entry = PROCESSENTRY32W { dwSize: size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut more = Process32FirstW(snapshot, &mut entry).is_ok();
        while more {
            let end = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
            let same = String::from_utf16_lossy(&entry.szExeFile[..end]).eq_ignore_ascii_case(&String::from_utf16_lossy(&name));
            let mut session = 0u32;
            let in_user_session = ProcessIdToSessionId(entry.th32ProcessID, &mut session).is_ok() && session != 0;
            if same && entry.th32ProcessID != own && in_user_session
                && let Ok(process) = OpenProcess(PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION, false, entry.th32ProcessID)
            {
                let mut image = [0u16; 1024];
                let mut len = image.len() as u32;
                let ours = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(image.as_mut_ptr()), &mut len).is_ok()
                    && String::from_utf16_lossy(&image[..len as usize]).to_lowercase() == path;
                if ours && TerminateProcess(process, 1).is_ok() {
                    stopped += 1;
                }
                let _ = CloseHandle(process);
            }
            more = Process32NextW(snapshot, &mut entry).is_ok();
        }
        let _ = CloseHandle(snapshot);
    }
    Ok(stopped)
}
