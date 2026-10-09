//! Helpers shared by every protocol engine.
//!
//! Deliberately *not* a `trait Engine`: the engines have very little in common
//! beyond their `run(config, input_rx, frame_tx)` signature — which is the seam
//! (see [`crate::session`]). This module holds only the few things they genuinely
//! share.
//!
//! It also owns the socket policy, which is not just formatting: it is where a
//! remote host that has *gone away* is made noticeable. See [`tcp_connect`]'s
//! comments for what the kernel can and cannot tell us. Every engine's socket
//! comes from there, so a silent host is noticed on the same schedule whichever
//! protocol is carrying it, and the number [`keepalive_budget`] quotes to the user
//! cannot drift from any of them.

use std::future::Future;
use std::time::Duration;

use log::warn;
use tokio::net::TcpStream;

use crate::cause::{self, Cause};
use crate::encode::VideoSink;
use crate::protocol::ServerMsg;

/// Idle time before the kernel starts probing a silent peer.
const KEEPALIVE_IDLE: Duration = Duration::from_secs(10);
/// Gap between probes once they have started.
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(5);
/// Unanswered probes before the socket fails.
const KEEPALIVE_RETRIES: u32 = 3;

/// Linux only in effect, and the half that is easy to leave out.
///
/// Keepalive probes are sent on an *idle* connection: with unacknowledged data
/// outstanding, the retransmission timer owns the socket instead, and its budget
/// (`tcp_retries2`) runs to roughly fifteen minutes. That is exactly the state a
/// user puts the socket in by clicking at a desktop that has frozen — so
/// keepalive alone would cover the session nobody is touching and miss the one
/// somebody is. `TCP_USER_TIMEOUT` bounds any unacknowledged byte, and while it
/// is set it also bounds the keepalive failure, so one number covers both.
///
/// Set above [`keepalive_budget`] so the idle case is still reported as a
/// keepalive timeout. macOS has no equivalent option; a gateway running there
/// keeps the retransmission budget for a busy socket, which runs to about fifteen
/// minutes.
#[cfg(target_os = "linux")]
const WRITE_TIMEOUT: Duration = Duration::from_secs(30);

/// How long the TCP connect itself may take.
///
/// A host that is switched off swallows SYNs, and the kernel's own retry budget
/// runs to about two minutes with the client showing "Connecting…" for all of
/// it — no client has a timeout of its own. Generous enough to cross a slow VPN.
///
/// Public because the RDP engine's first-desktop deadline is this plus
/// [`HANDSHAKE_TIMEOUT`]: its client connects on a thread of its own, so the two
/// budgets are summed there rather than run one after the other here.
pub const TCP_CONNECT_TIMEOUT: Duration = Duration::from_secs(20);

/// How long a protocol handshake may take once the TCP connect has succeeded.
///
/// A host that accepts the connection and then says nothing is a hang no socket
/// timeout catches. Long enough for CredSSP or a DES challenge on a loaded server.
pub const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(30);

/// How long a silent host takes to be noticed: idle, then every probe.
///
/// Exposed so an error message quoting the number cannot drift from the
/// constants behind it.
pub fn keepalive_budget() -> Duration {
    KEEPALIVE_IDLE + KEEPALIVE_INTERVAL * KEEPALIVE_RETRIES
}

/// Connect to a remote, with the socket settings every engine wants.
///
/// `dest` arrives already formatted by [`host_port`] because each caller keeps it
/// for its own later error messages.
///
/// The keepalive is the point of this function. Without it a host that vanishes
/// without a FIN — powered off, or cut from the network — leaves the engine
/// blocked on a read forever, and the client holds a frozen desktop with nothing
/// to say. What it proves is narrow but real: that the peer's *kernel* is still
/// answering. For RDP and VNC that is the whole of it — a server process that
/// wedges behind a kernel which still answers reads as an idle desktop, and RFB
/// offers no probe to close that gap.
pub async fn tcp_connect(dest: &str) -> anyhow::Result<TcpStream> {
    connect(dest, false).await
}

/// [`tcp_connect`], and with `apart` for a remote that answers over UDP between the
/// connection's two addresses, on one port number at both ends: a Mac's media
/// stream.
///
/// A gateway on the Mac it reaches would otherwise sit at the Mac's own address,
/// and there the two ends ask for one and the same UDP association. The kernel
/// gives it to whichever connects first and delivers everything to that one,
/// its own packets included (measured, macOS 27): the gateway receives the
/// stream, and its keyframe requests and reports come back to itself and never
/// reach the Mac. So a destination on this host is dialled from another of its
/// addresses ([`source_apart`]), and the two ends differ.
async fn connect(dest: &str, apart: bool) -> anyhow::Result<TcpStream> {
    let dial = async {
        if !apart {
            return TcpStream::connect(dest).await;
        }
        let resolved = tokio::net::lookup_host(dest).await?.collect();
        let mut last = None;
        for (from, to) in dial_order(resolved, source_apart) {
            match connect_from(from, to).await {
                Ok(stream) => return Ok(stream),
                Err(e) => last = Some(e),
            }
        }
        Err(last.unwrap_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "could not resolve to any address")
        }))
    };
    let stream = tokio::time::timeout(TCP_CONNECT_TIMEOUT, dial)
        .await
        .map_err(|_| {
            let seconds = TCP_CONNECT_TIMEOUT.as_secs();
            Cause::new("AL-7004")
                .with("host", dest)
                .with("seconds", seconds)
                .of(anyhow::anyhow!("TCP connect to {dest}: no answer after {seconds}s"))
        })?
        .map_err(|e| {
            // The refusal a missing Local Network permission produces is its own
            // cause, so the page can say what to check in the person's language.
            let hint = local_network_hint(&e);
            let code = if hint.is_empty() { "AL-7001" } else { "AL-7003" };
            Cause::new(code).with("host", dest).of(anyhow::anyhow!("TCP connect to {dest}: {e}{hint}"))
        })?;
    // Input events are tiny and latency-critical; never coalesce them.
    stream.set_nodelay(true).ok();
    if let Err(e) = arm_liveness_probes(&stream) {
        // Not a reason to refuse a session that otherwise works, but said out
        // loud rather than swallowed: this is a guarantee we no longer have.
        warn!("engine: could not arm TCP keepalive for {dest}: {e}");
    }
    Ok(stream)
}

/// The addresses a name resolved to, each with the address it is dialled from
/// (`source`), in the order they are tried: those whose two ends can be set apart
/// first, in the resolver's order, then the rest. `localhost` resolves to `::1`
/// ahead of `127.0.0.1`, and a host with no IPv6 route can set only the second
/// apart.
fn dial_order(
    resolved: Vec<std::net::SocketAddr>,
    source: impl Fn(std::net::IpAddr) -> Option<std::net::IpAddr>,
) -> Vec<(Option<std::net::IpAddr>, std::net::SocketAddr)> {
    let mut order: Vec<_> = resolved.into_iter().map(|to| (source(to.ip()), to)).collect();
    // Stable: the resolver's order holds within each half.
    order.sort_by_key(|(from, _)| from.is_none());
    order
}

/// How long a connection from a chosen source may go unanswered before it is made
/// as any other. Only a destination on this host is dialled that way, which
/// crosses no network and answers at once or not at all: a packet filter that
/// drops what comes to the loopback from another address leaves it unanswered,
/// and must not use up [`TCP_CONNECT_TIMEOUT`] before the connection that works
/// is tried.
const APART_TIMEOUT: Duration = Duration::from_secs(2);

/// `attempt`, failed as timed out where it has not answered in `wait`.
async fn answered_within<T>(
    wait: Duration,
    attempt: impl Future<Output = std::io::Result<T>>,
) -> std::io::Result<T> {
    tokio::time::timeout(wait, attempt)
        .await
        .unwrap_or_else(|_| Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "no answer")))
}

/// Connect to `to`, from `from` where one is named. A connection that cannot be
/// made from there is made as any other: choosing the source must never cost a
/// session the kernel's own choice would have had, where a packet filter passes
/// the loopback only from itself, by refusing or by dropping
/// ([`APART_TIMEOUT`]), or where the address was not this host's after all
/// ([`source_apart`]).
async fn connect_from(from: Option<std::net::IpAddr>, to: std::net::SocketAddr) -> std::io::Result<TcpStream> {
    let Some(from) = from else {
        return TcpStream::connect(to).await;
    };
    let bound = async {
        let socket = if to.is_ipv4() { tokio::net::TcpSocket::new_v4()? } else { tokio::net::TcpSocket::new_v6()? };
        socket.bind(std::net::SocketAddr::new(from, 0))?;
        socket.connect(to).await
    };
    match answered_within(APART_TIMEOUT, bound).await {
        Ok(stream) => Ok(stream),
        Err(e) => {
            warn!("engine: could not reach {to} from {from} ({e}); connecting as any other target");
            TcpStream::connect(to).await
        }
    }
}

/// Whether `dest`, a `host:port` as [`host_port`] formats it, names this host:
/// any address it resolves to is a loopback, the unspecified address, or one a
/// socket binds. Resolved on the calling thread.
#[cfg(target_os = "macos")]
pub fn is_this_host(dest: &str) -> bool {
    use std::net::ToSocketAddrs as _;
    dest.to_socket_addrs().is_ok_and(|mut addrs| {
        addrs.any(|addr| {
            let ip = addr.ip();
            ip.is_loopback() || ip.is_unspecified() || std::net::UdpSocket::bind((ip, 0)).is_ok()
        })
    })
}

/// What this computer calls itself, as its owner named it: a Mac's Computer Name,
/// from Sharing in its settings. Asked of the system once. `None` where the
/// system does not say, and on a system this build does not ask.
#[cfg(target_os = "macos")]
pub fn computer_name() -> Option<&'static str> {
    static NAME: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    NAME.get_or_init(|| {
        let said = std::process::Command::new("/usr/sbin/scutil").args(["--get", "ComputerName"]).output().ok()?;
        let name = String::from_utf8(said.stdout).ok()?.trim().to_owned();
        (said.status.success() && !name.is_empty()).then_some(name)
    })
    .as_deref()
}

/// The name of this computer where the target at `host` and `port` is this very
/// computer, and `None` for a target anywhere else: what the list calls such a
/// target, and a session on it, instead of the name its config entry was given.
///
/// Whether an address is this host's is asked once for each destination and
/// remembered, because the answer resolves a name on the calling thread: the list
/// asks from a thread that may block, and a session asks for a destination the list
/// has already asked about.
#[cfg(target_os = "macos")]
pub fn this_computer(host: &str, port: u16) -> Option<String> {
    use std::collections::HashMap;
    use std::sync::Mutex;
    static HERE: Mutex<Option<HashMap<String, bool>>> = Mutex::new(None);
    let dest = host_port(host, port);
    let known = HERE.lock().unwrap().as_ref().and_then(|known| known.get(&dest).copied());
    let here = known.unwrap_or_else(|| {
        let here = is_this_host(&dest);
        HERE.lock().unwrap().get_or_insert_with(HashMap::new).insert(dest, here);
        here
    });
    if here { computer_name().map(str::to_owned) } else { None }
}

/// No target is told to be this computer on a system where that is not asked.
#[cfg(not(target_os = "macos"))]
pub fn this_computer(_host: &str, _port: u16) -> Option<String> {
    None
}

/// The port a Mac shares its screen on.
const SCREEN_SHARING_PORT: u16 = 5900;

/// The name of this computer where `target` is this computer's own Screen
/// Sharing: a Mac target, at the port a Mac shares its screen on, at one of this
/// host's addresses. Nothing else at one of this host's addresses is taken for
/// this computer: another port of it, or another kind of server there, is as
/// likely a forwarded port, which leads to another computer.
pub fn own_computer(target: &crate::config::TargetConfig) -> Option<String> {
    use crate::config::Subtype;
    let mac = matches!(
        target.subtype,
        Some(Subtype::Ard | Subtype::ArdHighPerformance | Subtype::ArdMirror)
    );
    if mac && target.port == SCREEN_SHARING_PORT {
        this_computer(&target.host, target.port)
    } else {
        None
    }
}

/// The address a connection to `to` leaves from so that its two ends differ, where
/// `to` is this host's own: the loopback is reached from the address this host
/// routes the network from, and any other address of this host from the loopback.
/// The unspecified address is the loopback's: a connection to it lands on this
/// host. `None` for another host's address, which the kernel's own choice already
/// differs from, and for a loopback on a host with no other address.
///
/// "This host's" is "an address a socket binds", which a Linux host with
/// `ip_nonlocal_bind` answers yes to for any address: [`connect_from`] falls back
/// to the kernel's choice when the source it was given does not connect.
fn source_apart(to: std::net::IpAddr) -> Option<std::net::IpAddr> {
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, UdpSocket};
    if to.is_loopback() || to.is_unspecified() {
        // A UDP socket's connect sends nothing: it asks the kernel which address
        // routes to an address outside this host. The documentation prefixes
        // (RFC 5737, RFC 3849) are no host's own.
        let (any, outside): (IpAddr, IpAddr) = match to {
            IpAddr::V4(_) => (Ipv4Addr::UNSPECIFIED.into(), Ipv4Addr::new(192, 0, 2, 1).into()),
            IpAddr::V6(_) => (Ipv6Addr::UNSPECIFIED.into(), Ipv6Addr::new(0x2001, 0xdb8, 0, 0, 0, 0, 0, 1).into()),
        };
        let probe = UdpSocket::bind((any, 0)).ok()?;
        probe.connect((outside, 9)).ok()?;
        let routed = probe.local_addr().ok()?.ip();
        return (!routed.is_loopback() && !routed.is_unspecified()).then_some(routed);
    }
    // Only an address of this host can be bound.
    UdpSocket::bind((to, 0)).ok()?;
    Some(match to {
        IpAddr::V4(_) => Ipv4Addr::LOCALHOST.into(),
        IpAddr::V6(_) => Ipv6Addr::LOCALHOST.into(),
    })
}

/// The cause a connection that failed is told by: its own, or, where a read or a
/// write failed with nobody saying why, the encrypted transport's for a record that
/// failed its check and the network's for any other, or the place's.
fn connect_cause(e: &anyhow::Error) -> Cause {
    let general = match cause::io_kind(e) {
        Some(std::io::ErrorKind::InvalidData) => "AL-7028",
        Some(_) => "AL-7027",
        None => "AL-7000",
    };
    cause::or_general(e, general)
}

/// Connect to a remote and run its handshake, reporting any failure to the client.
///
/// The two engines that need this had the same fifteen lines each: bound the
/// handshake, warn, send the `ServerMsg::Error` the picker will show, and give up.
/// `None` means the caller has nothing left to do — it has already been reported.
///
/// The budgets are sequential on purpose, and this is the reason the helper takes
/// a closure rather than a future: the TCP connect has its own deadline inside
/// [`tcp_connect`], and wrapping both in one timeout meant a slow connect ate the
/// handshake's time and was then reported as a handshake that took the full
/// budget. Now a host that is slow to answer is a connect failure, and only what
/// happens after the socket is up is measured against `budget`.
///
/// `protocol` is the log-line prefix (`"rdp"`); the client-facing message
/// uppercases it, which is the form both engines already used.
/// `apart` is for a Mac's media stream: see [`connect`].
pub async fn connect_and_handshake<T, F, Fut>(
    protocol: &str,
    dest: &str,
    apart: bool,
    budget: Duration,
    sink: &VideoSink,
    handshake: F,
) -> Option<T>
where
    F: FnOnce(TcpStream) -> Fut,
    Fut: Future<Output = anyhow::Result<T>>,
{
    let report = async |message: String, cause: Option<Cause>| {
        let _ = sink.msg(ServerMsg::Error { message, cause }).await;
    };
    let failed = |e: &anyhow::Error| {
        (format!("{} connect failed: {e}", protocol.to_uppercase()), Some(connect_cause(e)))
    };
    let stream = match connect(dest, apart).await {
        Ok(stream) => stream,
        Err(e) => {
            warn!("{protocol}: connect failed: {e:#}");
            let (message, cause) = failed(&e);
            report(message, cause).await;
            return None;
        }
    };
    match tokio::time::timeout(budget, handshake(stream)).await {
        Ok(Ok(value)) => Some(value),
        Ok(Err(e)) => {
            warn!("{protocol}: connect failed: {e:#}");
            let (message, cause) = failed(&e);
            report(message, cause).await;
            None
        }
        Err(_) => {
            warn!("{protocol}: handshake with {dest} timed out");
            report(
                format!(
                    "{} connect failed: {dest} did not finish the handshake within {}s",
                    protocol.to_uppercase(),
                    budget.as_secs()
                ),
                Some(Cause::new("AL-7002").with("host", dest).with("seconds", budget.as_secs())),
            )
            .await;
            None
        }
    }
}

/// What to add to a connect error that a permission could be behind.
///
/// macOS 15 and later refuse an app's connections to anything off this machine
/// until local network access is allowed, and the refusal is `EHOSTUNREACH` —
/// exactly what an address with no route gives. Nothing on this side can tell the
/// two apart, and there is no API that would: TN3179 says so, and it is still
/// saying so.
///
/// So this does not decide; it *mentions*. The error keeps naming what happened
/// and gains one clause naming the cause a user can act on, leaving the address as
/// the other. That is worth the sentence because the permission is invisible from
/// here: a fresh install refuses every target on this Mac, identically, with a
/// message that would otherwise send the reader to check a network that is fine.
///
/// Empty everywhere else, where an unreachable address is simply unreachable.
#[cfg(target_os = "macos")]
const LOCAL_NETWORK_HINT: &str = ". If this is the app's own gateway, check that alumia is \
     allowed under System Settings > Privacy & Security > Local Network — until it is, every \
     connection off this Mac fails exactly like this";

/// See the macOS half. No other platform gates a connection on a user decision.
#[cfg(not(target_os = "macos"))]
const LOCAL_NETWORK_HINT: &str = "";

fn local_network_hint(e: &std::io::Error) -> &'static str {
    use std::io::ErrorKind;
    if matches!(
        e.kind(),
        ErrorKind::HostUnreachable | ErrorKind::NetworkUnreachable | ErrorKind::NetworkDown
    ) {
        LOCAL_NETWORK_HINT
    } else {
        ""
    }
}

/// Ask the kernel to notice a peer that has stopped answering.
fn arm_liveness_probes(stream: &TcpStream) -> std::io::Result<()> {
    let socket = socket2::SockRef::from(stream);
    // No `cfg` around these three: socket2 supports all of them on both targets
    // this gateway ships for (`with_time` is `TCP_KEEPALIVE` on macOS and
    // `TCP_KEEPIDLE` elsewhere). Whole seconds, because some platforms truncate.
    socket.set_tcp_keepalive(
        &socket2::TcpKeepalive::new()
            .with_time(KEEPALIVE_IDLE)
            .with_interval(KEEPALIVE_INTERVAL)
            .with_retries(KEEPALIVE_RETRIES),
    )?;
    #[cfg(target_os = "linux")]
    socket.set_tcp_user_timeout(Some(WRITE_TIMEOUT))?;
    Ok(())
}

/// Format a `host:port` destination for `TcpStream::connect`, bracketing bare
/// IPv6 literals (e.g. `fdb8::20` -> `[fdb8::20]:3389`).
pub fn host_port(host: &str, port: u16) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

/// Clamp a browser pointer coordinate into the protocol's `u16` range.
///
/// [`crate::protocol::ClientMsg::MouseMove`] carries `i32` because that is what
/// the DOM produces, and a drag off the canvas edge legitimately reports
/// negative or oversized values. Clamping — rather than dropping the event —
/// keeps a drag that leaves the canvas pinned to the edge instead of freezing.
pub fn clamp_u16(v: i32) -> u16 {
    v.clamp(0, i32::from(u16::MAX)) as u16
}

/// One display of a remote's arrangement, in the space its pointer positions are
/// addressed in: where it starts, and its size.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DisplayRect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

/// `point`, made on display `from` of `displays` and already offset into their
/// arrangement, held on a display: as it is where it lies on one, and otherwise
/// at the nearest point of the nearest, `from` where two are as near.
///
/// The union of displays of different sizes is not its bounding rectangle, so a
/// position held only inside that rectangle can lie on no display: below the
/// shorter of two side by side, or beside the narrower of two stacked. The page
/// lets a held drag's positions through past any edge while another display is
/// shown beside it (`frontend/src/remotePoint.ts`), so which of them are on a
/// display is decided here.
pub fn hold_on_display(point: (i32, i32), displays: &[DisplayRect], from: usize) -> (i32, i32) {
    let held = |display: &DisplayRect| {
        let last = |start: i32, length: i32| start.saturating_add(length.max(1) - 1);
        (
            point.0.clamp(display.x, last(display.x, display.w)),
            point.1.clamp(display.y, last(display.y, display.h)),
        )
    };
    let away = |at: (i32, i32)| {
        let (dx, dy) = (i64::from(at.0) - i64::from(point.0), i64::from(at.1) - i64::from(point.1));
        dx * dx + dy * dy
    };
    displays
        .iter()
        .enumerate()
        .map(|(index, display)| (held(display), index != from))
        .min_by_key(|&(at, other)| (away(at), other))
        .map_or(point, |(at, _)| at)
}

#[cfg(test)]
mod tests {
    use tokio::sync::mpsc;

    use super::*;

    /// A connection that drops while it is being opened, on a read or a write
    /// nobody gave a cause, is told as the network's; a cause of its own is kept,
    /// and what is nobody's read is the place's.
    #[test]
    fn a_connection_that_drops_while_opening_is_told_as_the_networks() {
        let dropped = anyhow::Error::new(std::io::Error::new(std::io::ErrorKind::ConnectionReset, "reset by peer"));
        assert_eq!(connect_cause(&dropped.context("reading the server's greeting")).code, "AL-7027");
        let forged = anyhow::Error::new(std::io::Error::new(std::io::ErrorKind::InvalidData, "a frame failed its tag"));
        assert_eq!(connect_cause(&forged.context("reading the security result")).code, "AL-7028");
        assert_eq!(connect_cause(&anyhow::anyhow!("not an RFB server")).code, "AL-7000");
        let refused = Cause::new("AL-7012").of(anyhow::anyhow!("VNC authentication failed"));
        assert_eq!(connect_cause(&refused).code, "AL-7012");
    }

    /// A position past the edge between two displays lands on the other, and one
    /// that would lie on neither is held on the nearest.
    #[test]
    fn a_position_is_held_on_a_display_and_not_only_inside_their_bounding_rectangle() {
        let beside = [DisplayRect { x: 0, y: 0, w: 1600, h: 900 }, DisplayRect { x: 1600, y: 0, w: 1024, h: 1200 }];
        assert_eq!(hold_on_display((800, 450), &beside, 0), (800, 450));
        assert_eq!(hold_on_display((1700, 1100), &beside, 0), (1700, 1100), "onto the second");
        // Below the first, which is shorter than the second: on neither.
        assert_eq!(hold_on_display((800, 1100), &beside, 0), (800, 899));
        assert_eq!(hold_on_display((1500, 1100), &beside, 1), (1600, 1100), "nearer the second");
        // Past the arrangement's own edge, at it.
        assert_eq!(hold_on_display((9000, -5), &beside, 0), (2623, 0));
        assert_eq!(hold_on_display((-5, -5), &beside, 1), (0, 0));
        // Stacked, the second narrower: beside it is on neither.
        let stacked = [DisplayRect { x: 0, y: 700, w: 1600, h: 900 }, DisplayRect { x: 0, y: 0, w: 1024, h: 700 }];
        assert_eq!(hold_on_display((1300, 650), &stacked, 0), (1300, 700));
        assert_eq!(hold_on_display((1300, 300), &stacked, 1), (1023, 300));
        // As near to both: the one it was made on.
        let equal = [DisplayRect { x: 0, y: 0, w: 100, h: 100 }, DisplayRect { x: 201, y: 0, w: 100, h: 100 }];
        assert_eq!(hold_on_display((150, 50), &equal, 0), (99, 50));
        assert_eq!(hold_on_display((150, 50), &equal, 1), (201, 50));
        assert_eq!(hold_on_display((7, 7), &[], 0), (7, 7));
    }

    /// A sink and the channel behind it. `VideoSink` forwards through a task of its
    /// own, so a test reads the channel only after [`VideoSink::flush`].
    fn sink() -> (VideoSink, mpsc::Receiver<ServerMsg>) {
        let (frame_tx, frame_rx) = mpsc::channel(4);
        let plan = crate::config::RenderPlan {
            quality: 60,
            adaptive: false,
            chroma: crate::config::Chroma::Subsampled,
            apple_media: false,
            rdp_graphics: false,
            rdp_h264: false,
        };
        let feedback = std::sync::Arc::new(crate::feedback::LinkFeedback::new());
        (VideoSink::new("test", frame_tx, plan, feedback, crate::encode::Oversize::Refuse), frame_rx)
    }

    // The detection itself is not testable here, and the reason is the same one
    // that bounds what this feature can promise: any peer you can reach has a
    // kernel that answers keepalive probes, which is precisely the case these
    // options do *not* cover. What is testable — and what silently regresses if
    // the `all` feature or the call order changes — is that they reached the
    // socket at all.
    #[tokio::test]
    async fn tcp_connect_arms_the_liveness_probes_it_promises() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let dest = listener.local_addr().unwrap().to_string();
        let accept = tokio::spawn(async move { listener.accept().await.unwrap() });

        let stream = tcp_connect(&dest).await.unwrap();
        let socket = socket2::SockRef::from(&stream);
        assert!(socket.keepalive().unwrap(), "SO_KEEPALIVE is off");
        // socket2 sets these through `SIO_KEEPALIVE_VALS` on Windows, which has no getter;
        // the retries one reads back everywhere.
        #[cfg(not(windows))]
        assert_eq!(socket.tcp_keepalive_time().unwrap(), KEEPALIVE_IDLE);
        #[cfg(not(windows))]
        assert_eq!(socket.tcp_keepalive_interval().unwrap(), KEEPALIVE_INTERVAL);
        assert_eq!(socket.tcp_keepalive_retries().unwrap(), KEEPALIVE_RETRIES);
        #[cfg(target_os = "linux")]
        assert_eq!(socket.tcp_user_timeout().unwrap(), Some(WRITE_TIMEOUT));
        assert!(stream.nodelay().unwrap(), "input events must not coalesce");

        let _ = accept.await.unwrap();
    }

    /// A Mac's media stream runs between the two addresses of the TCP connection,
    /// on one port number at both ends, so a gateway on the Mac it reaches must not
    /// sit at the Mac's own address: a connection to this host leaves from another
    /// of its addresses, in both directions.
    #[tokio::test]
    async fn a_connection_to_this_host_leaves_from_another_of_its_addresses() {
        let loopback = std::net::IpAddr::from(std::net::Ipv4Addr::LOCALHOST);
        // Asked of the kernel here too, so that a host with a network cannot pass
        // by finding none.
        let probe = std::net::UdpSocket::bind("0.0.0.0:0").unwrap();
        let routed = probe.connect("192.0.2.1:9").ok().map(|()| probe.local_addr().unwrap().ip());
        let Some(routed) = routed.filter(|ip| !ip.is_loopback() && !ip.is_unspecified()) else {
            eprintln!("skipped: this host has no address but its loopback");
            return;
        };
        assert_eq!(source_apart(loopback), Some(routed), "the loopback is reached from the network's address");
        assert_eq!(source_apart(routed), Some(loopback), "its own address is reached from the loopback");

        for (to, from) in [(loopback, routed), (routed, loopback)] {
            let listener = tokio::net::TcpListener::bind("0.0.0.0:0").await.unwrap();
            let dest = std::net::SocketAddr::new(to, listener.local_addr().unwrap().port()).to_string();
            let accept = tokio::spawn(async move { listener.accept().await.unwrap() });
            let stream = connect(&dest, true).await.unwrap();
            let (_held, peer) = accept.await.unwrap();
            assert_eq!(peer.ip(), from, "what the remote at {to} sees connecting");
            assert_eq!(stream.peer_addr().unwrap().ip(), to);
            assert_ne!(stream.local_addr().unwrap().ip(), to, "the two ends are apart");
            assert!(stream.nodelay().unwrap(), "the same socket settings as any connection");
        }
    }

    /// An address whose ends can be set apart is tried ahead of one whose ends
    /// cannot, whatever order the resolver gave them in, and a source that does
    /// not connect costs nothing: the connection is made as any other.
    #[tokio::test]
    async fn an_address_that_can_be_set_apart_is_tried_first_and_a_bad_source_falls_back() {
        let source: std::net::IpAddr = "192.0.2.7".parse().unwrap();
        let (v6, v4): (std::net::SocketAddr, std::net::SocketAddr) =
            ("[::1]:5900".parse().unwrap(), "127.0.0.1:5900".parse().unwrap());
        // `localhost` on a host with no IPv6 route: `::1` first, and only the
        // IPv4 loopback with another address to leave from.
        let only_v4 = |to: std::net::IpAddr| to.is_ipv4().then_some(source);
        assert_eq!(dial_order(vec![v6, v4], only_v4), [(Some(source), v4), (None, v6)]);
        // With nothing to choose between, the resolver's order holds.
        assert_eq!(dial_order(vec![v6, v4], |_| None), [(None, v6), (None, v4)]);
        assert_eq!(dial_order(vec![v6, v4], |_| Some(source)), [(Some(source), v6), (Some(source), v4)]);

        // TEST-NET-1 is no address of this host: the bound connect fails, and the
        // plain one is made.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let to = listener.local_addr().unwrap();
        let accept = tokio::spawn(async move { listener.accept().await.unwrap() });
        let stream = connect_from(Some(source), to).await.unwrap();
        let (_held, peer) = accept.await.unwrap();
        assert!(peer.ip().is_loopback(), "connected as any other target: {peer}");
        assert_eq!(stream.peer_addr().unwrap(), to);

        // And an attempt that is never answered, a dropped SYN, fails as one that
        // was refused does, well inside the whole connect's budget.
        let unanswered = answered_within(Duration::from_millis(20), std::future::pending::<std::io::Result<()>>());
        assert_eq!(unanswered.await.unwrap_err().kind(), std::io::ErrorKind::TimedOut);
        assert!(APART_TIMEOUT < TCP_CONNECT_TIMEOUT / 2, "the plain connect keeps most of the budget");
    }

    /// A target on this computer is called by the computer's own name, and a
    /// target anywhere else by none.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_target_on_this_computer_is_called_by_the_computers_name() {
        let name = computer_name().expect("a Mac has a Computer Name");
        assert!(!name.is_empty() && !name.contains('\n'), "{name:?}");
        assert_eq!(this_computer("127.0.0.1", 5900).as_deref(), Some(name));
        assert_eq!(this_computer("localhost", 5901).as_deref(), Some(name));
        assert_eq!(this_computer("192.0.2.1", 5900), None, "TEST-NET-1 is no host's own address");
        // Asked again, the answer is the remembered one.
        assert_eq!(this_computer("127.0.0.1", 5900).as_deref(), Some(name));
    }

    /// A destination is this host when it resolves to an address this host holds.
    #[cfg(target_os = "macos")]
    #[test]
    fn this_host_is_told_from_another() {
        assert!(is_this_host("127.0.0.1:5900"));
        assert!(is_this_host("localhost:5900"));
        assert!(!is_this_host("192.0.2.1:5900"), "TEST-NET-1 is no host's own address");
        // The host's own network address, asked of the kernel apart from the code
        // under test: the case a target addressed by it decides.
        let probe = std::net::UdpSocket::bind("0.0.0.0:0").unwrap();
        let routed = probe.connect("192.0.2.1:9").ok().map(|()| probe.local_addr().unwrap().ip());
        match routed.filter(|ip| !ip.is_loopback() && !ip.is_unspecified()) {
            Some(own) => assert!(is_this_host(&host_port(&own.to_string(), 5900)), "{own} is this host's"),
            None => eprintln!("not checked: this host has no address but its loopback"),
        }
    }

    /// Only a destination on this host is reached from a chosen address: another
    /// host is dialled as the kernel routes it, and so is every connection that
    /// did not ask to be apart.
    #[tokio::test]
    async fn a_connection_to_another_host_is_left_alone() {
        // TEST-NET-1 (RFC 5737): no host's own address.
        assert_eq!(source_apart("192.0.2.1".parse().unwrap()), None);

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let dest = listener.local_addr().unwrap().to_string();
        let accept = tokio::spawn(async move { listener.accept().await.unwrap() });
        let _stream = tcp_connect(&dest).await.unwrap();
        let (_held, peer) = accept.await.unwrap();
        assert!(peer.ip().is_loopback(), "a plain connection to the loopback leaves from it");
    }

    /// A listener that accepts one connection and holds it, so a handshake can be
    /// exercised without a real server behind it.
    ///
    /// The returned handle owns the accepted socket and parks: dropping the socket
    /// would race the handshake with an EOF. Abort the handle to release both.
    async fn accepting_listener() -> (String, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let dest = listener.local_addr().unwrap().to_string();
        let accept = tokio::spawn(async move {
            let _stream = listener.accept().await.unwrap();
            std::future::pending::<()>().await;
        });
        (dest, accept)
    }

    #[tokio::test]
    async fn a_completed_handshake_passes_its_value_through() {
        let (dest, accept) = accepting_listener().await;
        let (sink, mut frame_rx) = sink();

        let value = connect_and_handshake("test", &dest, false, HANDSHAKE_TIMEOUT, &sink, |_stream| {
            std::future::ready(Ok(7u8))
        })
        .await;

        assert_eq!(value, Some(7));
        sink.flush().await;
        assert!(frame_rx.try_recv().is_err(), "nothing to report");
        accept.abort();
    }

    // The bug this helper's shape exists for: with one timeout around both
    // phases, a slow connect ate the handshake's budget and was then reported as
    // a handshake that had run for the whole of it.
    #[tokio::test]
    async fn a_stalled_handshake_is_reported_against_its_own_budget() {
        let (dest, accept) = accepting_listener().await;
        let (sink, mut frame_rx) = sink();

        let value: Option<()> = connect_and_handshake(
            "test",
            &dest,
            false,
            Duration::from_millis(50),
            &sink,
            |_stream| std::future::pending(),
        )
        .await;

        assert!(value.is_none());
        sink.flush().await;
        let ServerMsg::Error { message, cause } = frame_rx.try_recv().unwrap() else {
            panic!("expected an error for the picker");
        };
        assert!(message.contains("did not finish the handshake"), "{message}");
        // Uppercased for the client, as both engines already spelled it.
        assert!(message.starts_with("TEST connect failed:"), "{message}");
        // And the cause the page says in the person's language, with who and how long.
        assert_eq!(cause, Some(Cause::new("AL-7002").with("host", &dest).with("seconds", 0)));
        accept.abort();
    }

    #[tokio::test]
    async fn a_connect_that_never_lands_is_not_reported_as_a_handshake_failure() {
        // A port that was just released, so the connect is refused rather than
        // being left to the connect timeout.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let dest = listener.local_addr().unwrap().to_string();
        drop(listener);
        let (sink, mut frame_rx) = sink();

        let value: Option<()> = connect_and_handshake(
            "test",
            &dest,
            false,
            HANDSHAKE_TIMEOUT,
            &sink,
            |_stream| std::future::ready(Ok(())),
        )
        .await;

        assert!(value.is_none());
        sink.flush().await;
        let ServerMsg::Error { message, cause } = frame_rx.try_recv().unwrap() else {
            panic!("expected an error for the picker");
        };
        assert!(message.contains("TCP connect to"), "{message}");
        assert!(
            !message.contains("handshake"),
            "a connect failure must not read as a handshake one: {message}"
        );
        // A refused connect is the remote not reachable, named, and never the
        // handshake's cause.
        assert_eq!(cause, Some(Cause::new("AL-7001").with("host", &dest)));
    }

    /// The hint is mentioned, never concluded — so it must appear for the refusal
    /// the permission produces and for nothing else, or it becomes noise on every
    /// unrelated failure.
    #[test]
    fn only_an_unreachable_network_earns_the_permission_hint() {
        use std::io::ErrorKind;
        for quiet in [ErrorKind::ConnectionRefused, ErrorKind::TimedOut, ErrorKind::ConnectionReset]
        {
            assert!(
                local_network_hint(&std::io::Error::from(quiet)).is_empty(),
                "{quiet:?} is a decided answer and needs no advice"
            );
        }
        // The three the gate can produce — and only where the gate exists.
        for kind in
            [ErrorKind::HostUnreachable, ErrorKind::NetworkUnreachable, ErrorKind::NetworkDown]
        {
            let hint = local_network_hint(&std::io::Error::from(kind));
            assert_eq!(
                !hint.is_empty(),
                cfg!(target_os = "macos"),
                "{kind:?} gave {hint:?}"
            );
            if !hint.is_empty() {
                assert!(hint.contains("Local Network"), "{hint}");
            }
        }
    }

    /// A refused port is the common failure, and the one an unasked-for sentence
    /// about permissions would be wrong about.
    #[tokio::test]
    async fn a_refused_connection_is_reported_without_the_hint() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let dest = listener.local_addr().unwrap().to_string();
        drop(listener);

        let Err(failed) = tcp_connect(&dest).await else {
            panic!("a port with nothing behind it connected");
        };

        let message = format!("{failed:#}");
        assert!(message.contains("TCP connect to"), "{message}");
        assert!(!message.contains("Local Network"), "{message}");
    }

    #[test]
    fn the_keepalive_budget_is_the_sum_of_its_parts() {
        // The number an error message quotes to the user.
        assert_eq!(keepalive_budget(), Duration::from_secs(25));
        // A silent host must be reported well inside the browser's reattach
        // grace, or the session layer would expire the engine first and the user
        // would never see the reason.
        assert!(keepalive_budget() < crate::session::REATTACH_GRACE_PERIOD);
    }

    #[test]
    fn host_port_brackets_bare_ipv6_literals_only() {
        assert_eq!(host_port("10.0.0.2", 3389), "10.0.0.2:3389");
        assert_eq!(host_port("mac.local", 52381), "mac.local:52381");
        assert_eq!(host_port("fdb8::20", 5900), "[fdb8::20]:5900");
        assert_eq!(
            host_port("fdb8:d92a:f690:3d7f:97a4:120a:2:20", 3389),
            "[fdb8:d92a:f690:3d7f:97a4:120a:2:20]:3389"
        );
        // An address the user already bracketed is left alone.
        assert_eq!(host_port("[fdb8::20]", 5900), "[fdb8::20]:5900");
    }

    #[test]
    fn clamp_u16_pins_out_of_range_coordinates_to_the_edge() {
        assert_eq!(clamp_u16(0), 0);
        assert_eq!(clamp_u16(1279), 1279);
        assert_eq!(clamp_u16(-1), 0);
        assert_eq!(clamp_u16(i32::MIN), 0);
        assert_eq!(clamp_u16(65535), u16::MAX);
        assert_eq!(clamp_u16(70000), u16::MAX);
        assert_eq!(clamp_u16(i32::MAX), u16::MAX);
    }
}
