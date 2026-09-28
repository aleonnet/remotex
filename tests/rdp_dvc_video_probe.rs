//! POC: an in-session Windows agent's VP9 over a dynamic virtual channel of the RDP
//! connection, and whether the host's own graphics can be turned off beside it so the
//! host does not encode the desktop twice.
//!
//! The agent (`tests/dvc-video-poc/agent`) runs in the RDP session, opens
//! `remotex.video` with `WTSVirtualChannelOpenEx`, captures the desktop with DXGI
//! Desktop Duplication (GDI when duplication is refused), codes it with desktop-vp9
//! and writes it to the channel. It also paints a patch whose colour changes every
//! tick, and each message says which colour was painted, so this end decodes the
//! frame and checks the patch: a frame counts as *fresh* only if it shows the colour
//! painted just before it was captured.
//!
//! What it found, and what a product would take, is
//! [A Windows host's video over its own RDP connection](../docs/rdp-in-session-video.md):
//! Suppress Output switches the session's display off and capture with it
//! ([`dvc_video_survives_suppress_output`]); withholding the graphics pipeline's frame
//! acknowledgements stalls the host's graphics while capture, input and sound go on
//! ([`dvc_video_with_frame_acks_withheld`]), and the host stops encoding them
//! ([`host_cpu_acked_against_withheld`]).
//!
//! How to run each test, and the CPU sampling beside it, is in that document's
//! [Running it](../docs/rdp-in-session-video.md#running-it).

mod common;

use std::process::Command;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use remotex::rdp_client::proto::rdpsnd;
use remotex::rdp_client::{AudioSink, Connect, Event, Session};
use tokio::sync::mpsc;

const TARGET_ENV: &str = "REMOTEX_UAT_TARGET";
const OPENING: (u32, u32) = (1280, 800);
const RESIZED: (u32, u32) = (1600, 900);

const PALETTE: [(u8, u8, u8); 8] = [
    (255, 0, 0),
    (0, 255, 0),
    (0, 0, 255),
    (255, 255, 0),
    (0, 255, 255),
    (255, 0, 255),
    (255, 255, 255),
    (0, 0, 0),
];

fn nearest(r: u8, g: u8, b: u8) -> usize {
    let d = |p: &(u8, u8, u8)| {
        (i32::from(p.0) - i32::from(r)).abs() + (i32::from(p.1) - i32::from(g)).abs() + (i32::from(p.2) - i32::from(b)).abs()
    };
    (0..PALETTE.len()).min_by_key(|&i| d(&PALETTE[i])).unwrap()
}

/// Where a run's products go.
const OUT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tmp/dvc-video-poc");

fn script(name: &str) {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/dvc-video-poc/");
    let status = Command::new("pwsh").arg("-NoProfile").arg("-File").arg(format!("{path}{name}")).status().expect("pwsh");
    println!("{name}: {status}");
}

struct Message {
    painted: u32,
    capture: u8,
    flags: u8,
    width: u16,
    height: u16,
    patch: (u32, u32),
    timeouts: u32,
    frame: Vec<u8>,
}

fn parse(bytes: &[u8]) -> Option<Message> {
    if bytes.len() < 32 || &bytes[..4] != b"RXV1" {
        return None;
    }
    let u32_at = |i: usize| u32::from_le_bytes(bytes[i..i + 4].try_into().unwrap());
    let u16_at = |i: usize| u16::from_le_bytes(bytes[i..i + 2].try_into().unwrap());
    Some(Message {
        painted: u32_at(8),
        capture: bytes[12],
        flags: bytes[13],
        width: u16_at(16),
        height: u16_at(18),
        patch: (u32_at(20), u32_at(24)),
        timeouts: u32_at(28),
        frame: bytes[32..].to_vec(),
    })
}

/// The host's sound, counted: buffers and bytes since the session began.
#[derive(Default)]
struct Ear {
    buffers: AtomicU64,
    bytes: AtomicU64,
}

struct Listen(Arc<Ear>);

impl AudioSink for Listen {
    fn negotiated(&self, format: rdpsnd::Format) {
        println!("sound negotiated: {format:?}");
    }
    fn wave(&self, samples: Vec<u8>) {
        self.0.buffers.fetch_add(1, Ordering::Relaxed);
        self.0.bytes.fetch_add(samples.len() as u64, Ordering::Relaxed);
    }
    fn closed(&self) {
        println!("sound closed");
    }
}

#[derive(Default)]
struct Phase {
    sound_buffers: u64,
    sound_bytes: u64,
    /// Decoded frames whose picture outside the agent's own patch differs from the
    /// frame before: the desktop's animation, carried by the agent.
    changed: u32,
    messages: u32,
    captured: u32,
    agent_fresh: u32,
    getpixel_fresh: u32,
    dwmflush_failed: u32,
    not_default_desktop: u32,
    dxgi_timeouts: u32,
    decoded: u32,
    client_fresh: u32,
    bytes: usize,
    egfx_frames: u32,
    paints: u32,
    sizes: Vec<(u16, u16)>,
    resizes: Vec<(u32, u32)>,
}

impl Phase {
    fn print(&self, name: &str, seconds: u64) {
        println!(
            "PHASE {name:<24} {seconds:>2}s | msgs {:>4} captured {:>4} agent-fresh {:>4} getpixel-fresh {:>4} dwmflush-fail {:>4} not-default-desktop {:>4} dxgi-timeouts {:>4} | decoded {:>4} client-fresh {:>4} {:>6} KiB | host egfx frames {:>4} paints {:>5} | sizes {:?} resizes {:?} | changed {:>4} sound {:>4} buffers {:>5} KiB",
            self.messages,
            self.captured,
            self.agent_fresh,
            self.getpixel_fresh,
            self.dwmflush_failed,
            self.not_default_desktop,
            self.dxgi_timeouts,
            self.decoded,
            self.client_fresh,
            self.bytes / 1024,
            self.egfx_frames,
            self.paints,
            self.sizes,
            self.resizes,
            self.changed,
            self.sound_buffers,
            self.sound_bytes / 1024
        );
    }
}

struct Receiver {
    /// The last decoded frame's size, beside its pixels in `bgrx`.
    decoded_size: (u32, u32),
    ear: Arc<Ear>,
    last_hash: u64,
    events: mpsc::Receiver<Event>,
    video: mpsc::UnboundedReceiver<Vec<u8>>,
    partial: Vec<u8>,
    decoder: Option<desktop_vp9::Decoder>,
    bgrx: Vec<u8>,
}

impl Receiver {
    /// Take events and video until `until`, into `phase`. `stop_on_video` returns as soon
    /// as one decodable frame has arrived.
    async fn run(&mut self, phase: &mut Phase, until: Instant, stop_on_video: bool) -> bool {
        loop {
            let deadline = tokio::time::sleep_until(until.into());
            tokio::select! {
                _ = deadline => return false,
                event = self.events.recv() => match event {
                    Some(Event::Frame) => phase.egfx_frames += 1,
                    Some(Event::Paint(_)) => phase.paints += 1,
                    Some(Event::Resize { width, height }) => phase.resizes.push((width, height)),
                    Some(Event::Ended(result)) => {
                        println!("session ended: {result:?}");
                        return false;
                    }
                    Some(_) => {}
                    None => return false,
                },
                piece = self.video.recv() => {
                    let Some(piece) = piece else { return false };
                    let Some((&flags, body)) = piece.split_first() else { continue };
                    if flags & 1 != 0 {
                        self.partial.clear();
                    }
                    self.partial.extend_from_slice(body);
                    if flags & 2 == 0 {
                        continue;
                    }
                    let whole = std::mem::take(&mut self.partial);
                    phase.bytes += whole.len();
                    let Some(message) = parse(&whole) else {
                        println!("unparseable message of {} bytes", whole.len());
                        continue;
                    };
                    if self.take(phase, message) && stop_on_video {
                        return true;
                    }
                }
            }
        }
    }

    /// Count one message; true if it carried a frame that decoded.
    fn take(&mut self, phase: &mut Phase, m: Message) -> bool {
        phase.messages += 1;
        phase.dxgi_timeouts += m.timeouts;
        if m.flags & 4 != 0 {
            phase.getpixel_fresh += 1;
        }
        if m.flags & 8 != 0 {
            phase.dwmflush_failed += 1;
        }
        if m.flags & 16 != 0 {
            phase.not_default_desktop += 1;
        }
        if m.capture == 0 || m.frame.is_empty() {
            return false;
        }
        phase.captured += 1;
        if m.flags & 2 != 0 {
            phase.agent_fresh += 1;
        }
        if !phase.sizes.contains(&(m.width, m.height)) {
            phase.sizes.push((m.width, m.height));
        }
        let keyframe = m.flags & 1 != 0;
        if keyframe {
            self.decoder = Some(desktop_vp9::Decoder::new(2).expect("decoder"));
        }
        let Some(decoder) = self.decoder.as_mut() else { return false };
        let decoded = match decoder.decode(&m.frame) {
            Ok(decoded) => decoded,
            Err(e) => {
                println!("decode failed: {e}");
                self.decoder = None;
                return false;
            }
        };
        let (w, h) = decoded.size();
        self.bgrx.resize(w as usize * h as usize * 4, 0);
        decoded.write_bgrx(&mut self.bgrx, w as usize * 4).expect("bgrx");
        self.decoded_size = (w, h);
        phase.decoded += 1;
        // Every fourth pixel of every fourth row, leaving out the agent's patch window.
        let mut hash = 0xcbf2_9ce4_8422_2325_u64;
        for y in (0..h as usize).step_by(4) {
            for x in (0..w as usize).step_by(4) {
                if x < 300 && y < 300 {
                    continue;
                }
                let i = (y * w as usize + x) * 4;
                for &byte in &self.bgrx[i..i + 3] {
                    hash = (hash ^ u64::from(byte >> 3)).wrapping_mul(0x100_0000_01b3);
                }
            }
        }
        if hash != self.last_hash {
            phase.changed += 1;
            self.last_hash = hash;
        }
        let (x, y) = (m.patch.0 as usize, m.patch.1 as usize);
        if x < w as usize && y < h as usize {
            let i = (y * w as usize + x) * 4;
            let (b, g, r) = (self.bgrx[i], self.bgrx[i + 1], self.bgrx[i + 2]);
            if nearest(r, g, b) == m.painted as usize % PALETTE.len() {
                phase.client_fresh += 1;
            }
        }
        true
    }
}

/// The host's own picture, as PNG under [`OUT`].
fn dump(session: &Session, name: &str) {
    std::fs::create_dir_all(OUT).expect("creating the output directory");
    let path = format!("{OUT}/{name}.png");
    let bytes = session.framebuffer().with(|frame| {
        let mut rgba = frame.pixels.clone();
        for px in rgba.as_chunks_mut::<4>().0 {
            px[3] = 0xFF;
        }
        let mut out = Vec::new();
        let mut encoder = png::Encoder::new(&mut out, frame.width, frame.height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().expect("png header");
        writer.write_image_data(&rgba).expect("png data");
        writer.finish().expect("png finish");
        out
    });
    std::fs::write(&path, bytes).expect("writing the framebuffer dump");
    println!("  host framebuffer written to {path}");
}

/// The agent's last decoded frame, as PNG under [`OUT`].
fn save_agent_frame(rx: &Receiver, name: &str) {
    let (w, h) = rx.decoded_size;
    let mut rgba = rx.bgrx.clone();
    for px in rgba.as_chunks_mut::<4>().0 {
        px.swap(0, 2);
        px[3] = 0xFF;
    }
    let mut out = Vec::new();
    let mut encoder = png::Encoder::new(&mut out, w, h);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().expect("png header");
    writer.write_image_data(&rgba).expect("png data");
    writer.finish().expect("png finish");
    std::fs::create_dir_all(OUT).expect("creating the output directory");
    let path = format!("{OUT}/{name}.png");
    std::fs::write(&path, out).expect("writing the agent frame");
    println!("  agent frame written to {path}");
}

/// Press and release a key, with the pause a person leaves.
async fn tap(session: &Session, scancode: u8, extended: bool) {
    session.input().key(scancode, extended, true);
    tokio::time::sleep(Duration::from_millis(60)).await;
    session.input().key(scancode, extended, false);
    tokio::time::sleep(Duration::from_millis(120)).await;
}

fn connect() -> (Session, Receiver) {
    let name = std::env::var(TARGET_ENV).unwrap_or_else(|_| panic!("set {TARGET_ENV}"));
    let target = common::uat_target(&name);
    let (video_tx, video) = mpsc::unbounded_channel();
    let ear = Arc::new(Ear::default());
    let (session, events) = Session::start(Connect {
        host: target.host.clone(),
        port: target.port,
        username: target.username.clone(),
        password: target.password.clone(),
        domain: target.domain.clone(),
        width: OPENING.0,
        height: OPENING.1,
        scale_percent: 0,
        resize: true,
        egfx: true,
        clipboard: false,
        audio: Some(Box::new(Listen(Arc::clone(&ear)))),
        camera: None,
        microphone: None,
        video: Some(video_tx),
    });
    (session, Receiver { decoded_size: (0, 0), ear, last_hash: 0, events, video, partial: Vec::new(), decoder: None, bgrx: Vec::new() })
}

async fn wait_connected(rx: &mut Receiver) {
    let first = tokio::time::timeout(Duration::from_secs(60), rx.events.recv()).await.expect("connect in time");
    match first {
        Some(Event::Connected { width, height }) => println!("connected {width}x{height}"),
        other => panic!("not connected: {other:?}"),
    }
}

async fn phase(rx: &mut Receiver, name: &str, seconds: u64) {
    let mut p = Phase::default();
    let (buffers, bytes) = (rx.ear.buffers.load(Ordering::Relaxed), rx.ear.bytes.load(Ordering::Relaxed));
    rx.run(&mut p, Instant::now() + Duration::from_secs(seconds), false).await;
    p.sound_buffers = rx.ear.buffers.load(Ordering::Relaxed) - buffers;
    p.sound_bytes = rx.ear.bytes.load(Ordering::Relaxed) - bytes;
    p.print(name, seconds);
}

async fn probe() {
    common::init_logging();
    let (session, mut rx) = connect();
    wait_connected(&mut rx).await;
    // Let the logon settle into a desktop before starting anything in it.
    let mut settle = Phase::default();
    rx.run(&mut settle, Instant::now() + Duration::from_secs(8), false).await;
    script("start-agent.ps1");

    let mut first = Phase::default();
    let got = rx.run(&mut first, Instant::now() + Duration::from_secs(60), true).await;
    first.print("waiting-for-agent", 0);
    assert!(got, "no decodable video arrived on remotex.video");

    phase(&mut rx, "graphics-on", 15).await;
    dump(&session, "1-graphics-on");
    session.input().suppress_output(false);
    phase(&mut rx, "suppressed", 15).await;
    session.input().resize(RESIZED.0, RESIZED.1, 100);
    phase(&mut rx, "suppressed+resize", 15).await;
    session.input().suppress_output(true);
    phase(&mut rx, "graphics-back-on", 12).await;
    dump(&session, "2-graphics-back-on");

    println!("disconnecting");
    drop(session);
    drop(rx);
    tokio::time::sleep(Duration::from_secs(5)).await;

    let (session, mut rx) = connect();
    wait_connected(&mut rx).await;
    let mut again = Phase::default();
    let got = rx.run(&mut again, Instant::now() + Duration::from_secs(60), true).await;
    again.print("reconnect-wait", 0);
    if got {
        phase(&mut rx, "reconnected", 5).await;
        session.input().suppress_output(false);
        phase(&mut rx, "reconnected+suppressed", 15).await;
        session.input().suppress_output(true);
        phase(&mut rx, "reconnected-back-on", 8).await;
        dump(&session, "3-reconnected-back-on");
    }
    drop(session);
    script("stop-agent.ps1");
}

/// Display updates stay on; the graphics pipeline's frames go unacknowledged instead, so
/// the host throttles its own graphics while the session's display stays on.
async fn probe_acks() {
    common::init_logging();
    let (session, mut rx) = connect();
    wait_connected(&mut rx).await;
    let mut settle = Phase::default();
    rx.run(&mut settle, Instant::now() + Duration::from_secs(8), false).await;
    script("start-agent.ps1");

    let mut first = Phase::default();
    let got = rx.run(&mut first, Instant::now() + Duration::from_secs(60), true).await;
    first.print("waiting-for-agent", 0);
    assert!(got, "no decodable video arrived on remotex.video");

    for i in 0..3 {
        phase(&mut rx, &format!("acked-{i}"), 10).await;
    }
    dump(&session, "3-acked");
    session.input().withhold_frame_acks(true);
    // Two minutes stalled, the soak as well as the measurement.
    for i in 0..12 {
        phase(&mut rx, &format!("withheld-{i}"), 10).await;
        if i % 3 == 0 {
            save_agent_frame(&rx, &format!("9-agent-withheld-{i:02}"));
        }
        if i == 2 {
            // The keyboard, while the host's graphics are stalled: open Start and type
            // into its search, which redraws a large part of the screen.
            save_agent_frame(&rx, "6-agent-before-start");
            const LWIN: u8 = 0x5B;
            const ESCAPE: u8 = 0x01;
            tap(&session, LWIN, true).await;
            phase(&mut rx, "withheld+start-menu", 3).await;
            for scancode in [0x2E, 0x1E, 0x26, 0x2E] {
                // c a l c
                tap(&session, scancode, false).await;
            }
            phase(&mut rx, "withheld+typed-calc", 4).await;
            save_agent_frame(&rx, "7-agent-start-search");
            dump(&session, "7-host-start-search");
            tap(&session, ESCAPE, false).await;
            tap(&session, ESCAPE, false).await;
            phase(&mut rx, "withheld+start-closed", 3).await;
            save_agent_frame(&rx, "8-agent-start-closed");
        }
    }
    session.input().resize(RESIZED.0, RESIZED.1, 100);
    phase(&mut rx, "withheld+resize-0", 10).await;
    phase(&mut rx, "withheld+resize-1", 10).await;
    save_agent_frame(&rx, "9-agent-withheld-resized");
    dump(&session, "4-withheld");
    session.input().withhold_frame_acks(false);
    phase(&mut rx, "acked-again-0", 10).await;
    phase(&mut rx, "acked-again-1", 10).await;
    dump(&session, "5-acked-again");
    drop(session);
    script("stop-agent.ps1");
}

/// Whether the animation and sound left playing on the host keep going across
/// disconnects: three connections, fifteen seconds apart. No agent; the host's own
/// graphics and sound are what is counted.
async fn page_across_reconnects() {
    common::init_logging();
    for round in 1..=3 {
        let (session, mut rx) = connect();
        wait_connected(&mut rx).await;
        phase(&mut rx, &format!("connection-{round}-first-3s"), 3).await;
        phase(&mut rx, &format!("connection-{round}"), 10).await;
        dump(&session, &format!("page-{round}"));
        drop(session);
        drop(rx);
        if round < 3 {
            println!("disconnected for 15 s");
            tokio::time::sleep(Duration::from_secs(15)).await;
        }
    }
}

fn unix_now() -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs_f64()
}

/// Host CPU with the graphics acknowledged and withheld, alternating a minute each, with
/// the agent running throughout: each phase's bounds are written as unix seconds to
/// `cpu-phases.txt` under [`OUT`], for `cpu-procs.ps1`'s samples to be cut by.
async fn cpu_ab() {
    common::init_logging();
    let (session, mut rx) = connect();
    wait_connected(&mut rx).await;
    phase(&mut rx, "settle", 5).await;
    script("start-agent.ps1");
    let mut first = Phase::default();
    let got = rx.run(&mut first, Instant::now() + Duration::from_secs(60), true).await;
    assert!(got, "no decodable video arrived on remotex.video");
    phase(&mut rx, "warm-up", 10).await;
    let mut bounds = String::new();
    for (i, withheld) in [false, true, false, true].into_iter().enumerate() {
        session.input().withhold_frame_acks(withheld);
        // The first seconds of each are the host catching up or running down its queue.
        phase(&mut rx, "transition", 5).await;
        let name = format!("{}-{i}", if withheld { "withheld" } else { "acked" });
        let start = unix_now();
        phase(&mut rx, &name, 55).await;
        bounds.push_str(&format!("{name} {start:.2} {:.2}\n", unix_now()));
    }
    std::fs::create_dir_all(OUT).expect("creating the output directory");
    std::fs::write(format!("{OUT}/cpu-phases.txt"), bounds).expect("writing the phases");
    session.input().withhold_frame_acks(false);
    phase(&mut rx, "acked-end", 3).await;
    drop(session);
    script("stop-agent.ps1");
}

#[tokio::test]
#[ignore = "drives a real RDP host named in tmp/test_uat.toml and the POC agent"]
async fn host_cpu_acked_against_withheld() {
    cpu_ab().await;
}

#[tokio::test]
#[ignore = "drives a real RDP host named in tmp/test_uat.toml"]
async fn animation_page_survives_reconnects() {
    page_across_reconnects().await;
}

#[tokio::test]
#[ignore = "drives a real RDP host named in tmp/test_uat.toml and the POC agent"]
async fn dvc_video_with_frame_acks_withheld() {
    probe_acks().await;
}

#[tokio::test]
#[ignore = "drives a real RDP host named in tmp/test_uat.toml and the POC agent"]
async fn dvc_video_survives_suppress_output() {
    probe().await;
}
