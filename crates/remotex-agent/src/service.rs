//! The `RemotexAgent` Windows service, run as LocalSystem. It captures nothing and holds
//! no channel: Desktop Duplication and the RDP connection's channels are a session's, and
//! the service runs in session 0. What it does is keep one session's agent running as
//! the user in each session that is logged on and attached over RDP.
//!
//! - A session attached over RDP gets a session's agent, started as its user
//!   ([`spawn::start`]), as soon as someone is logged on to it.
//! - A session left — disconnected, logged off — has its agent stopped at once: the
//!   connection it streamed on is gone, and the next one, a gateway's takeover included,
//!   gets an agent of its own.
//! - A session's agent that exits by itself is started again, after 5 seconds and
//!   twice as long after each exit that followed a short run, up to 5 minutes.
//!
//! Session changes arrive as the service control manager's notifications; the sessions
//! are also looked at every few seconds, which is what restarts an agent and what puts
//! right a notification missed.

use std::collections::HashMap;
use std::ffi::OsString;
use std::path::Path;
use std::process::ExitCode;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

use anyhow::{Context as _, Result};
use windows_service::service::{
    ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus, ServiceType, SessionChangeReason,
};
use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
use windows_service::{define_windows_service, service_dispatcher};

use crate::log::{self, Log};
use crate::spawn::{self, Worker};

/// The service's name, which the installer registers it under.
pub const NAME: &str = "RemotexAgent";

/// How often the sessions are looked at between notifications.
const TICK: Duration = Duration::from_secs(5);
/// How long after an exit a session's agent is started again, at first...
const RESTART_FIRST: Duration = Duration::from_secs(5);
/// ...and at most, doubling with each exit after a short run.
const RESTART_MOST: Duration = Duration::from_secs(300);
/// A run this long is not a crash loop: the next exit starts over at the first wait.
const STEADY: Duration = Duration::from_secs(60);

define_windows_service!(ffi_service_main, service_main);

pub fn run() -> ExitCode {
    match service_dispatcher::start(NAME, ffi_service_main) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!(
                "remotex-agent service is the {NAME} service's entry point, for the service control manager to start \
                 ({e}); install the agent's MSI to have it run, or run `remotex-agent session` in a session"
            );
            ExitCode::FAILURE
        }
    }
}

fn service_main(_arguments: Vec<OsString>) {
    let mut log = Log::open(&log::service_path("service.log"));
    if let Err(e) = serve(&mut log) {
        log.say(format!("fatal: {e:#}"));
    }
}

/// What the service control manager said.
enum Said {
    Stop,
    Session(u32, SessionChangeReason),
}

fn serve(log: &mut Log) -> Result<()> {
    let (tx, rx) = std::sync::mpsc::channel();
    let handler = move |control| match control {
        ServiceControl::Stop | ServiceControl::Shutdown => {
            let _ = tx.send(Said::Stop);
            ServiceControlHandlerResult::NoError
        }
        ServiceControl::SessionChange(change) => {
            let _ = tx.send(Said::Session(change.notification.session_id, change.reason));
            ServiceControlHandlerResult::NoError
        }
        ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
        _ => ServiceControlHandlerResult::NotImplemented,
    };
    let status = service_control_handler::register(NAME, handler).context("registering the service's control handler")?;
    let state = |current_state, controls_accepted| ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state,
        controls_accepted,
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: Duration::ZERO,
        process_id: None,
    };
    let accepted = ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN | ServiceControlAccept::SESSION_CHANGE;
    status.set_service_status(state(ServiceState::Running, accepted)).context("reporting the service running")?;
    log.say(format!("remotex-agent {} service start", env!("CARGO_PKG_VERSION")));
    let result = supervise(&rx, log);
    log.say("service stop");
    status.set_service_status(state(ServiceState::Stopped, ServiceControlAccept::empty())).context("reporting the service stopped")?;
    result
}

/// A session's agent, or the wait before the next one.
#[derive(Default)]
struct Slot {
    worker: Option<Worker>,
    /// Exits after a short run, one after another.
    failures: u32,
    /// When the next agent may be started, after an exit.
    not_before: Option<Instant>,
}

fn supervise(rx: &Receiver<Said>, log: &mut Log) -> Result<()> {
    let exe = std::env::current_exe().context("the service's own executable")?;
    match spawn::stop_strays(&exe) {
        Ok(0) => {}
        Ok(stopped) => log.say(format!("stopped {stopped} session agents nobody was keeping")),
        Err(e) => log.say(format!("could not look for session agents nobody was keeping: {e:#}")),
    }
    let mut slots: HashMap<u32, Slot> = HashMap::new();
    let mut last_error = String::new();
    loop {
        if let Err(e) = reconcile(&mut slots, &exe, log) {
            let text = format!("{e:#}");
            if text != last_error {
                log.say(format!("sessions not looked at: {text}"));
                last_error = text;
            }
        } else {
            last_error.clear();
        }
        match rx.recv_timeout(TICK) {
            Ok(Said::Stop) | Err(RecvTimeoutError::Disconnected) => break,
            Ok(Said::Session(session, reason)) => {
                log.say(format!("session {session}: {reason:?}"));
                let left = matches!(
                    reason,
                    SessionChangeReason::RemoteDisconnect | SessionChangeReason::ConsoleDisconnect | SessionChangeReason::SessionLogoff
                );
                if left && let Some(worker) = slots.remove(&session).and_then(|slot| slot.worker) {
                    log.say(format!("session {session}: stopping its agent, process {}", worker.pid));
                    worker.stop();
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
        }
    }
    for (session, slot) in slots.drain() {
        if let Some(worker) = slot.worker {
            log.say(format!("session {session}: stopping its agent, process {}", worker.pid));
            worker.stop();
        }
    }
    Ok(())
}

/// Every session attached over RDP with an agent running or on its way, and no agent
/// anywhere else.
fn reconcile(slots: &mut HashMap<u32, Slot>, exe: &Path, log: &mut Log) -> Result<()> {
    let sessions = spawn::remote_sessions()?;
    slots.retain(|session, slot| {
        let keep = sessions.contains(session);
        if !keep && let Some(worker) = slot.worker.take() {
            log.say(format!("session {session}: no longer attached over RDP, stopping its agent, process {}", worker.pid));
            worker.stop();
        }
        keep
    });
    let now = Instant::now();
    for &session in &sessions {
        let slot = slots.entry(session).or_default();
        if let Some(code) = slot.worker.as_ref().and_then(Worker::exited) {
            let worker = slot.worker.take().expect("an exit of a worker");
            let ran = now.saturating_duration_since(worker.started);
            slot.failures = if ran >= STEADY { 1 } else { slot.failures + 1 };
            let wait = backoff(slot.failures);
            log.say(format!(
                "session {session}: its agent, process {}, exited {code:#x} after {}s; the next in {}s",
                worker.pid,
                ran.as_secs(),
                wait.as_secs()
            ));
            slot.not_before = Some(now + wait);
        }
        if slot.worker.is_some() || slot.not_before.is_some_and(|at| now < at) {
            continue;
        }
        match spawn::start(session, exe) {
            Ok(Some(worker)) => {
                log.say(format!("session {session}: started its agent, process {}", worker.pid));
                slot.worker = Some(worker);
            }
            Ok(None) => {}
            Err(e) => {
                log.say(format!("session {session}: its agent did not start: {e:#}"));
                slot.failures += 1;
                slot.not_before = Some(now + backoff(slot.failures));
            }
        }
    }
    Ok(())
}

/// The wait before the next agent after this many failures in a row.
fn backoff(failures: u32) -> Duration {
    RESTART_FIRST.saturating_mul(1 << failures.saturating_sub(1).min(6)).min(RESTART_MOST)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_crash_loop_backs_off_to_five_minutes() {
        let waits: Vec<u64> = (1..=8).map(|failures| backoff(failures).as_secs()).collect();
        assert_eq!(waits, [5, 10, 20, 40, 80, 160, 300, 300]);
    }
}
