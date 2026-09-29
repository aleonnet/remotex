//! A session's agent: the desktop of the session it runs in, coded to the gateway's plan
//! and sent on the channel.
//!
//! It codes nothing until the gateway's plan arrives, keeps one frame in flight and
//! sends the next on the echo of the one before, walks its quality by how long the
//! echoes take, and sends the pointer as its own shape, never in the picture. The next
//! frame is coded while the one before is in flight, timed to be done as its echo
//! comes ([`Stream::ahead_in`]), so a frame costs the longer of the coding and the
//! echo and not their sum. When it
//! cannot duplicate the desktop — the secure desktop of a UAC prompt or the lock screen
//! — it says so and tries again until it can, and starts over at a keyframe.
//!
//! It runs as display work, in DWM's priority class and never throttled as background
//! work ([`prioritize`]).
//!
//! A channel that cannot be opened is tried again, less often each time up to
//! [`OPEN_MOST`]: the session is between connections, or attached to a gateway whose
//! target does not take the stream, which refuses the channel by name. So is one that
//! closes or cannot be written, until the gateway has echoed a frame on it.

use std::process::ExitCode;
use std::sync::mpsc::{RecvTimeoutError, TryRecvError};
use std::time::{Duration, Instant};

use anyhow::{Context as _, Result, anyhow};
use desktop_vp9::Chroma;
use desktop_vp9::walk::{Pace, QualityWalk};
use remotex_video_channel::{GAP, Plan, Said, VERSION, frame_header};
use windows::Win32::System::Console::{FreeConsole, GetConsoleProcessList};
use windows::Win32::System::RemoteDesktop::ProcessIdToSessionId;
use windows::Win32::System::Threading::{
    GetCurrentProcess, HIGH_PRIORITY_CLASS, PROCESS_POWER_THROTTLING_CURRENT_VERSION, PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
    PROCESS_POWER_THROTTLING_STATE, ProcessPowerThrottling, SetPriorityClass, SetProcessInformation,
};
use windows::Win32::UI::HiDpi::{DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, SetProcessDpiAwarenessContext};

use crate::capture::{Capture, Grab};
use crate::channel::{Channel, Incoming};
use crate::log::{self, Log};
use crate::pointer::PointerState;
use crate::probe::{Patch, Switches};

/// The least gap between two frames on a link that is not slowed: 30 a second.
const INTERVAL: Duration = Duration::from_millis(33);
/// How long a desktop sent below the plan's quality stays quiet, with the gateway
/// holding the last frame, before it is sharpened there. wlshare's `SETTLE_IDLE`.
const SETTLE_IDLE: Duration = Duration::from_millis(500);
/// How long an echo may take before the frame is given up as lost. The gateway holds
/// one half a second at most.
const ECHO_LOST: Duration = Duration::from_secs(3);
/// How long the gateway is listened to at a time while there is nothing else to do.
const LISTEN: Duration = Duration::from_millis(20);
/// How long between two attempts to duplicate a desktop that is refused.
const RETRY: Duration = Duration::from_millis(250);
/// How long after a refused open the channel is tried again, at first...
const OPEN_FIRST: Duration = Duration::from_secs(1);
/// ...and at most, doubling in between.
const OPEN_MOST: Duration = Duration::from_secs(30);

pub fn run(switches: Switches) -> ExitCode {
    detach_console();
    let mut log = Log::open(&log::session_path("session.log"));
    let result = stream(&mut log, switches);
    if let Err(e) = &result {
        log.say(format!("fatal: {e:#}"));
    }
    log.say("exit");
    if result.is_ok() { ExitCode::SUCCESS } else { ExitCode::FAILURE }
}

/// A console of its own, which is what an agent started outside a terminal — by a
/// scheduled task, or a double click — is given, is a window on the very desktop it
/// captures: let it go. The service starts it with none.
fn detach_console() {
    let mut attached = [0u32; 2];
    if unsafe { GetConsoleProcessList(&mut attached) } == 1 {
        let _ = unsafe { FreeConsole() };
    }
}

/// The agent is the session's display, as DWM is, and takes the CPU it needs before the
/// applications it shows. At normal priority it has what they leave: a desktop playing a
/// video that a host with no GPU decodes and draws in software can take every core, and
/// Chrome runs its GPU process above normal. And a process with no window is what Windows
/// throttles as background work, onto efficiency cores where the CPU has them. So it runs
/// in DWM's class and opts out of the throttling. One frame in flight and one coded
/// behind it bound what it takes.
fn prioritize(log: &mut Log) {
    let throttling = PROCESS_POWER_THROTTLING_STATE {
        Version: PROCESS_POWER_THROTTLING_CURRENT_VERSION,
        ControlMask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
        StateMask: 0,
    };
    unsafe {
        if let Err(e) = SetPriorityClass(GetCurrentProcess(), HIGH_PRIORITY_CLASS) {
            log.say(format!("the priority class stays as it was: {e}"));
        }
        let set = SetProcessInformation(
            GetCurrentProcess(),
            ProcessPowerThrottling,
            (&raw const throttling).cast(),
            size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32,
        );
        if let Err(e) = set {
            log.say(format!("power throttling stays the system's to decide: {e}"));
        }
    }
}

/// A frame the gateway has not echoed yet.
struct InFlight {
    seq: u32,
    sent: Instant,
    /// Whether its delivery is a verdict about the link: a delta frame at the walk's
    /// quality, not a keyframe and not a settle's frame.
    verdict: bool,
}

/// A frame coded behind the one in flight, which goes out on that one's echo. Its bytes
/// are the loop's.
struct Coded {
    seq: u32,
    keyframe: bool,
    /// Whether it is a settle's frame, at the plan's quality.
    settling: bool,
    /// The quality it was coded at.
    quality: u8,
    captured: Instant,
}

struct Stream {
    plan: Plan,
    walk: QualityWalk,
    in_flight: Option<InFlight>,
    coded: Option<Coded>,
    /// How long the last echo took to come, and the last frame to code.
    echo_took: Option<Duration>,
    coding_took: Option<Duration>,
    /// When the last frame that went out was captured, which the next is captured
    /// the walk's interval after.
    captured: Option<Instant>,
    /// The last frame went out below the plan's quality and the gateway has had it
    /// since then.
    coarse_since: Option<Instant>,
    keyframe_owed: bool,
    /// Whether the gateway has been told the desktop cannot be seen.
    gap_said: bool,
}

impl Stream {
    fn new(plan: Plan) -> Self {
        Self {
            plan,
            walk: QualityWalk::new(plan.quality, INTERVAL, plan.adaptive),
            in_flight: None,
            coded: None,
            echo_took: None,
            coding_took: None,
            captured: None,
            coarse_since: None,
            keyframe_owed: true,
            gap_said: false,
        }
    }

    /// How long until the frame behind the one in flight is to be coded, so that it is
    /// done as the echo comes: the echo is expected to take what the last one took, and
    /// the coding what the last frame's did. Coded on the echo, a frame costs the two
    /// together, which on a host that codes one in the interval's time is half the
    /// frames; coded any sooner than this, it would be older than it need be by the time
    /// a slow link takes it. `None` with no frame in flight, with one coded already, and
    /// before the first echo, which leaves the next frame to the echo.
    fn ahead_in(&self, now: Instant) -> Option<Duration> {
        let flight = self.in_flight.as_ref()?;
        if self.coded.is_some() {
            return None;
        }
        let start = flight.sent + self.echo_took?.saturating_sub(self.coding_took?);
        Some(start.saturating_duration_since(now))
    }
}

fn follow(moved: Option<Pace>, walk: &mut QualityWalk, capture: &mut Option<Capture>, log: &mut Log) {
    let (Some(pace), Some(capture)) = (moved, capture) else {
        return;
    };
    log.say(format!("quality {}, at most one frame per {:?}", pace.quality, pace.interval));
    if capture.encoder.set_quality(pace.quality).is_err() {
        walk.stays_at(capture.encoder.quality());
    }
}

fn stream(log: &mut Log, switches: Switches) -> Result<()> {
    let mut session = 0u32;
    unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        let _ = ProcessIdToSessionId(std::process::id(), &mut session);
    }
    log.say(format!("remotex-agent {} in session {session}", env!("CARGO_PKG_VERSION")));
    prioritize(log);
    let patch = if switches.patch { Some(Patch::new()?) } else { None };
    let mut big = switches.big;
    let mut channel: Option<Channel> = None;
    let mut stream: Option<Stream> = None;
    let mut capture: Option<Capture> = None;
    let mut pointer = PointerState::default();
    let mut seq = 0u32;
    let mut open_wait = OPEN_FIRST;
    // The last line said about the channel not opening or closing, and whether the
    // last closing repeated it, which makes the opening before the next one no news.
    let mut last_open_error = String::new();
    let mut open_repeats = false;
    let mut last_capture_error = String::new();
    let mut out = Vec::new();

    'open: loop {
        if let Some(patch) = &patch {
            patch.pump();
        }

        let Some(open) = channel.as_ref() else {
            match Channel::open() {
                Ok(opened) => {
                    if !open_repeats {
                        log.say("channel open");
                    }
                    channel = Some(opened);
                    stream = None;
                }
                Err(e) => {
                    let text = format!("channel not open: {e:#}");
                    if text != last_open_error {
                        log.say(&text);
                        last_open_error = text;
                        open_repeats = false;
                    }
                    std::thread::sleep(open_wait);
                    open_wait = (open_wait * 2).min(OPEN_MOST);
                }
            }
            continue;
        };

        // One turn on the open channel, which ends in why the channel was lost when it
        // was: the gateway closed it, or it could not be written.
        let lost: Option<anyhow::Error> = 'turn: {
            // What the gateway said, waiting for it while there is nothing else to do:
            // no plan yet, or a frame in flight and the one behind it coded or not due.
            let listen = match &stream {
                None => Some(LISTEN),
                Some(stream) if stream.in_flight.is_none() => None,
                Some(stream) => match stream.ahead_in(Instant::now()) {
                    None => Some(LISTEN),
                    Some(Duration::ZERO) => None,
                    Some(ahead) => Some(ahead.min(LISTEN)),
                },
            };
            let mut said = match listen.map(|listen| open.incoming.recv_timeout(listen)) {
                Some(Ok(said)) => Some(said),
                Some(Err(RecvTimeoutError::Disconnected)) => Some(Incoming::Closed(anyhow!("the reader stopped"))),
                Some(Err(RecvTimeoutError::Timeout)) | None => None,
            };
            loop {
                let next = match said.take() {
                    Some(said) => said,
                    None => match open.incoming.try_recv() {
                        Ok(said) => said,
                        Err(TryRecvError::Empty) => break,
                        Err(TryRecvError::Disconnected) => Incoming::Closed(anyhow!("the reader stopped")),
                    },
                };
                match next {
                    Incoming::Said(Said::Plan(plan), _) => {
                        log.say(format!("the plan: {} at quality {}, {}", plan.chroma.name(), plan.quality, if plan.adaptive { "walked" } else { "held" }));
                        stream = Some(Stream::new(plan));
                        // The encoder is the plan's.
                        capture = None;
                        pointer.dirty = true;
                    }
                    Incoming::Said(Said::Foreign(version), _) => {
                        break 'turn Some(anyhow!("the gateway speaks version {version}, this agent {VERSION}"));
                    }
                    Incoming::Said(Said::Echo(echoed), arrived) => {
                        if let Some(stream) = stream.as_mut()
                            && let Some(flight) = stream.in_flight.take_if(|flight| flight.seq == echoed)
                        {
                            // The stream has started: a closing from here on is news, and
                            // the channel is tried again at once.
                            open_wait = OPEN_FIRST;
                            last_open_error.clear();
                            open_repeats = false;
                            // Timed to when it was read, which a frame being coded
                            // behind it may have kept this loop from.
                            let took = arrived.saturating_duration_since(flight.sent);
                            stream.echo_took = Some(took);
                            let moved = stream.walk.fenced(took, flight.verdict, Instant::now());
                            follow(moved, &mut stream.walk, &mut capture, log);
                            if stream.coarse_since.is_some() {
                                stream.coarse_since = Some(arrived);
                            }
                        }
                    }
                    Incoming::Said(Said::Keyframe, _) => {
                        if let Some(stream) = stream.as_mut() {
                            stream.keyframe_owed = true;
                        }
                    }
                    Incoming::Closed(why) => break 'turn Some(why.context("the channel closed")),
                }
            }
            let Some(stream) = stream.as_mut() else {
                continue 'open;
            };
            if let Some(flight) = stream.in_flight.take_if(|flight| flight.sent.elapsed() >= ECHO_LOST) {
                log.say(format!("frame {} was never echoed", flight.seq));
            }

            let write = |message: &[u8]| open.send(message).context("writing to the channel");

            // The coded frame goes out once none is in flight: at once when it was coded
            // on the echo, and on the echo when it was coded behind the frame before.
            if stream.in_flight.is_none()
                && let Some(coded) = stream.coded.take()
            {
                let sent = Instant::now();
                let blocked = match write(&out) {
                    Ok(blocked) => blocked,
                    Err(e) => break 'turn Some(e),
                };
                if coded.keyframe {
                    stream.keyframe_owed = false;
                    stream.walk.keyframe(sent);
                }
                let verdict = !coded.keyframe && !coded.settling;
                if verdict {
                    let moved = stream.walk.written(blocked, true, Instant::now());
                    follow(moved, &mut stream.walk, &mut capture, log);
                }
                stream.coarse_since = stream.walk.coarse(coded.quality).then_some(sent);
                stream.captured = Some(coded.captured);
                stream.in_flight = Some(InFlight { seq: coded.seq, sent, verdict });
                continue 'open;
            }
            // Behind a frame in flight the next is coded when it is due, and no other.
            if stream.in_flight.is_some() && stream.ahead_in(Instant::now()) != Some(Duration::ZERO) {
                continue 'open;
            }
            // No more often than the interval, which a link slowed past the floor has
            // had doubled.
            if let Some(due) = stream.captured.map(|captured| captured + stream.walk.interval())
                && let Some(wait) = due.checked_duration_since(Instant::now())
            {
                std::thread::sleep(wait.min(Duration::from_millis(20)));
                continue 'open;
            }

            if let Some(bytes) = big.take() {
                // A keyframe's opening byte and nothing a decoder would take: the
                // channel's business is the bytes.
                let size = capture.as_ref().map_or((1280, 800), |capture| capture.size);
                frame_header(&mut out, seq, size);
                let profile = if stream.plan.chroma == Chroma::Full { 0xA0 } else { 0x80 };
                out.extend((0..bytes).map(|i| if i == 0 { profile } else { (i % 251) as u8 }));
                log.say(format!("one message of {} bytes", out.len()));
                if let Err(e) = write(&out) {
                    break 'turn Some(e);
                }
                stream.in_flight = Some(InFlight { seq, sent: Instant::now(), verdict: false });
                stream.keyframe_owed = true;
                seq = seq.wrapping_add(1);
                continue 'open;
            }

            if capture.is_none() {
                match Capture::new(stream.plan, stream.walk.quality(), log) {
                    Ok(made) => {
                        capture = Some(made);
                        stream.keyframe_owed = true;
                        stream.gap_said = false;
                        pointer.dirty = true;
                        last_capture_error.clear();
                    }
                    Err(e) => {
                        let text = format!("{e:#}");
                        if text != last_capture_error {
                            log.say(format!("the desktop cannot be duplicated: {text}"));
                            last_capture_error = text;
                        }
                        if !stream.gap_said {
                            stream.gap_said = true;
                            if let Err(e) = write(&[GAP]) {
                                break 'turn Some(e);
                            }
                        }
                        std::thread::sleep(RETRY);
                        continue 'open;
                    }
                }
            }
            let taking = capture.as_mut().expect("made above");

            if let Some(patch) = &patch {
                patch.paint(seq);
            }
            let capturing = Instant::now();
            let changed = match taking.grab(&mut pointer) {
                Ok(Grab::Picture) => true,
                Ok(Grab::Still) => false,
                Ok(Grab::Lost(e)) => {
                    log.say(format!("duplication lost ({e}); duplicating again"));
                    capture = None;
                    continue 'open;
                }
                Err(e) => {
                    log.say(format!("capture failed ({e:#}); duplicating again"));
                    capture = None;
                    continue 'open;
                }
            };
            if let Some(message) = pointer.message()
                && let Err(e) = write(&message)
            {
                break 'turn Some(e);
            }
            // A duplication new enough to have grabbed nothing holds a blank picture,
            // which is no keyframe of the desktop: the keyframe waits for the first grab.
            if !taking.filled {
                continue 'open;
            }

            // A desktop that went quiet below the plan's quality is sharpened there once,
            // with the unchanged picture as one more frame.
            let now = Instant::now();
            let settling = !changed && !stream.keyframe_owed && stream.coarse_since.is_some_and(|since| now >= since + SETTLE_IDLE);
            if !changed && !stream.keyframe_owed && !settling {
                continue 'open;
            }
            if settling {
                stream.walk.settle(now);
                let _ = taking.encoder.set_quality(stream.plan.quality);
            }
            frame_header(&mut out, seq, taking.size);
            let quality = taking.encoder.quality();
            let encoded = taking.encoder.encode(&taking.picture, stream.keyframe_owed, &mut out);
            if settling {
                let _ = taking.encoder.set_quality(stream.walk.quality());
            }
            let Some(keyframe) = encoded.context("encoding a frame")? else {
                continue 'open;
            };
            stream.coding_took = Some(now.elapsed());
            stream.coded = Some(Coded { seq, keyframe, settling, quality, captured: capturing });
            seq = seq.wrapping_add(1);
            None
        };

        // Lost, it is opened again after the wait, and everything made for it goes.
        if let Some(why) = lost {
            let text = format!("channel lost: {why:#}");
            open_repeats = text == last_open_error;
            if !open_repeats {
                log.say(&text);
                last_open_error = text;
            }
            channel = None;
            stream = None;
            capture = None;
            std::thread::sleep(open_wait);
            open_wait = (open_wait * 2).min(OPEN_MOST);
        }
    }
}
