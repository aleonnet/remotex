//! remotex's agent: codes a Windows session's desktop as VP9 and writes it to the
//! `remotex.video` dynamic virtual channel of the RDP connection the session is attached
//! to, in the protocol `src/rdp_client/proto/video.rs` reads, for a gateway whose target
//! sets `agent_passthrough` to pass to the browser as it came.
//!
//! One binary, two roles:
//!
//! - `remotex-agent service` is the `RemotexAgent` Windows service, run as LocalSystem by
//!   the service control manager. It captures nothing: it starts `remotex-agent session`
//!   as the user of each session that is logged on and attached over RDP, stops it when
//!   the session is left, and starts it again if it exits ([`service`]).
//! - `remotex-agent session` runs in one session as its user: it captures the desktop,
//!   codes it to the plan the gateway states and sends it, with the pointer as its own
//!   shape ([`session`]).
//!
//! See docs/agent.md.

#[cfg(windows)]
mod capture;
#[cfg(windows)]
mod channel;
#[cfg(windows)]
mod log;
#[cfg(windows)]
mod pointer;
#[cfg(windows)]
mod probe;
#[cfg(windows)]
mod service;
#[cfg(windows)]
mod session;
#[cfg(windows)]
mod spawn;

#[cfg(windows)]
use clap::{Parser, Subcommand};

#[cfg(windows)]
#[derive(Parser)]
#[command(name = "remotex-agent", version, about = "Sends a Windows session's desktop to remotex as VP9, over the session's own RDP connection")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[cfg(windows)]
#[derive(Subcommand)]
enum Command {
    /// The RemotexAgent service, as the service control manager starts it.
    Service,
    /// Stream this session's desktop to the gateway it is attached to. The service
    /// starts one in each RDP session; run by hand, it takes the session it is in.
    Session {
        /// Paint a patch whose colour follows each frame's number, for
        /// tests/rdp_dvc_video_probe.rs to tell a fresh frame from a stale one.
        #[arg(long, hide = true)]
        patch: bool,
        /// Send one message of this many bytes ahead of the stream, for the same probe.
        #[arg(long, hide = true, value_name = "BYTES")]
        big: Option<usize>,
    },
}

#[cfg(windows)]
fn main() -> std::process::ExitCode {
    match Cli::parse().command {
        Command::Service => service::run(),
        Command::Session { patch, big } => session::run(probe::Switches { patch, big }),
    }
}

#[cfg(not(windows))]
fn main() -> std::process::ExitCode {
    eprintln!("remotex-agent runs in a Windows session, and this is not Windows");
    std::process::ExitCode::FAILURE
}
