//! remotex's agent's VP9 over a dynamic virtual channel of the RDP connection, carrying
//! the desktop in place of the host's graphics pipeline.
//!
//! The agent (`crates/remotex-agent`) runs in the RDP session, opens
//! `remotex.video` with `WTSVirtualChannelOpenEx`, captures the desktop with DXGI
//! Desktop Duplication, codes it with desktop-vp9 to the plan this end states, and
//! writes it to the channel beside the pointer's shape. The RDP client
//! (`src/rdp_client/proto/video.rs`) takes the stream as the picture from its first
//! keyframe, while the host's own graphics go on beside it, and gives the picture back
//! to the pipeline when the agent cannot see the desktop, the desktop changes size, or
//! the channel closes.
//!
//! Most tests start a session's agent themselves, by scheduled task, which the host's
//! `RemotexAgent` service would otherwise do: they refuse to run beside it. Three test
//! the service, installed from the agent's MSI: one through a gateway of its own, and one
//! that removes it.
//!
//! Started with `--patch`, the agent paints a small window the colour its next frame's
//! number names just before it captures, so a frame counts as *fresh* here only when
//! the decoded patch shows that colour: a stale surface handed back again does not.
//!
//! What was measured, and what each rule rests on, is
//! [A Windows host's video over its own RDP connection](../docs/rdp-in-session-video.md),
//! and how to run each test is its
//! [Running it](../docs/rdp-in-session-video.md#running-it).

mod common;

use std::process::Command;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use futures_util::{SinkExt as _, StreamExt as _};
use remotex::rdp_client::proto::rdpsnd;
use remotex::rdp_client::{AudioSink, Connect, Cursor, Event, Input, Session, VideoFrame, VideoPlan};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

const TARGET_ENV: &str = "REMOTEX_UAT_TARGET";
const OPENING: (u32, u32) = (1280, 800);
const RESIZED: (u32, u32) = (1600, 900);
/// What the agent is asked to code: what a target with no stream keys resolves to for
/// a browser whose decoder takes profile 1.
const PLAN: VideoPlan = VideoPlan { chroma: desktop_vp9::Chroma::Full, quality: 90, adaptive: true };
/// One message of this many bytes goes ahead of the stream, under `--big`.
const BIG: usize = 4 << 20;

/// The agent's patch: a 160-pixel window at (100, 100), so this is its centre.
const PATCH: (usize, usize) = (180, 180);
/// Half the side of the square read for a pointer around it, clear of the window's
/// edge.
const PATCH_REACH: usize = 64;

const PALETTE: [(u8, u8, u8); 8] =
    [(255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 0), (0, 255, 255), (255, 0, 255), (255, 255, 255), (0, 0, 0)];

fn nearest(r: u8, g: u8, b: u8) -> usize {
    let d = |p: &(u8, u8, u8)| {
        (i32::from(p.0) - i32::from(r)).abs() + (i32::from(p.1) - i32::from(g)).abs() + (i32::from(p.2) - i32::from(b)).abs()
    };
    (0..PALETTE.len()).min_by_key(|&i| d(&PALETTE[i])).unwrap()
}

/// Where a run's products go.
const OUT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tmp/rdp-agent");

fn script(name: &str, args: &[&str]) {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/rdp-agent/");
    let status = Command::new("pwsh").arg("-NoProfile").arg("-File").arg(format!("{path}{name}")).args(args).status().expect("pwsh");
    println!("{name} {args:?}: {status}");
}

/// Deploy and start the agent, on a thread of its own: the script takes seconds, and
/// the session's events are to be taken meanwhile.
fn start_agent(switches: &str) -> tokio::task::JoinHandle<()> {
    let switches = switches.to_owned();
    tokio::task::spawn_blocking(move || script("start-agent.ps1", &["-AgentArgs", &switches]))
}

/// Stop the agent and bring its log back, the same way.
fn stop_agent() -> tokio::task::JoinHandle<()> {
    tokio::task::spawn_blocking(|| script("stop-agent.ps1", &[]))
}

/// Remove the service's MSI with `uninstall-service.ps1`, on a task of its own, as the
/// session's events are to be taken meanwhile, and within five minutes: `true` when it
/// finished and succeeded.
fn uninstall_service() -> tokio::task::JoinHandle<bool> {
    tokio::spawn(async {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/rdp-agent/uninstall-service.ps1");
        let mut child = tokio::process::Command::new("pwsh")
            .args(["-NoProfile", "-File", path])
            .stdin(std::process::Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .expect("pwsh");
        match tokio::time::timeout(Duration::from_secs(300), child.wait()).await {
            Ok(status) => {
                let status = status.expect("pwsh");
                println!("uninstall-service.ps1: {status}");
                status.success()
            }
            Err(_) => {
                println!("uninstall-service.ps1: still running after 5 minutes, stopped");
                false
            }
        }
    })
}

/// The host's sound, counted: buffers since the session began.
#[derive(Default)]
struct Ear {
    buffers: AtomicU64,
}

struct Listen(Arc<Ear>);

impl AudioSink for Listen {
    fn negotiated(&self, format: rdpsnd::Format) {
        println!("sound negotiated: {format:?}");
    }
    fn wave(&self, _samples: Vec<u8>) {
        self.0.buffers.fetch_add(1, Ordering::Relaxed);
    }
    fn closed(&self) {
        println!("sound closed");
    }
}

#[derive(Default)]
struct Phase {
    /// The agent's frames, those among them that are keyframes, that decoded, and that
    /// show the colour painted for them.
    frames: u32,
    keyframes: u32,
    decoded: u32,
    fresh: u32,
    bytes: usize,
    largest: usize,
    sizes: Vec<(u16, u16)>,
    /// Decoded frames whose picture outside the patch differs from the frame before:
    /// the desktop's own animation, carried by the agent.
    changed: u32,
    /// Times the pipeline took the picture back.
    ended: u32,
    /// The host's own graphics: frames, painted rectangles, and graphics resets.
    host_frames: u32,
    paints: u32,
    resizes: Vec<(u32, u32)>,
    /// Pointer shapes, from the host's own updates or from the agent.
    cursors: u32,
    hidden: u32,
    /// Fresh frames whose patch was read for a pointer drawn into it, and the most
    /// pixels of it any of them had in another colour than the one painted.
    patch_frames: u32,
    patch_foreign: u32,
    sound: u64,
}

impl Phase {
    fn print(&self, name: &str, seconds: u64) {
        println!(
            "PHASE {name:<26} {seconds:>4}s | agent frames {:>5} key {:>3} decoded {:>5} fresh {:>5} changed {:>5} {:>6} KiB largest {:>8} sizes {:?} ended {} | host frames {:>5} paints {:>6} resets {:?} | cursors {:>4} hidden {:>2} | patch read in {:>5}, most foreign pixels {:>4} | sound {:>4}",
            self.frames,
            self.keyframes,
            self.decoded,
            self.fresh,
            self.changed,
            self.bytes / 1024,
            self.largest,
            self.sizes,
            self.ended,
            self.host_frames,
            self.paints,
            self.resizes,
            self.cursors,
            self.hidden,
            self.patch_frames,
            self.patch_foreign,
            self.sound
        );
    }
}

/// What ends a wait early.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Until {
    Time,
    /// A frame of the agent's that decoded.
    Video,
    /// The pipeline taking the picture back.
    Ended,
    /// A frame of the host's own graphics.
    HostFrame,
}

struct Receiver {
    input: Input,
    events: mpsc::Receiver<Event>,
    ear: Arc<Ear>,
    decoder: Option<desktop_vp9::Decoder>,
    /// The last decoded frame, and its size.
    bgrx: Vec<u8>,
    decoded_size: (u32, u32),
    last_hash: u64,
}

impl Receiver {
    /// Take events until `deadline` or what `until` names, into `phase`. `true` when it
    /// was what `until` names.
    async fn run(&mut self, phase: &mut Phase, deadline: Instant, until: Until) -> bool {
        let sound = self.ear.buffers.load(Ordering::Relaxed);
        let met = self.turn(phase, deadline, until).await;
        phase.sound += self.ear.buffers.load(Ordering::Relaxed) - sound;
        met
    }

    async fn turn(&mut self, phase: &mut Phase, deadline: Instant, until: Until) -> bool {
        loop {
            let event = tokio::select! {
                () = tokio::time::sleep_until(deadline.into()) => return false,
                event = self.events.recv() => event,
            };
            match event {
                Some(Event::Frame) => {
                    phase.host_frames += 1;
                    if until == Until::HostFrame {
                        return true;
                    }
                }
                Some(Event::Paint(_)) => phase.paints += 1,
                Some(Event::Resize { width, height }) => phase.resizes.push((width, height)),
                Some(Event::Cursor(Cursor::Hidden)) => phase.hidden += 1,
                Some(Event::Cursor(_)) => phase.cursors += 1,
                Some(Event::Video(frame)) => {
                    // At once: nothing is watching behind this end.
                    self.input.echo_video(frame.seq);
                    if self.take(phase, frame) && until == Until::Video {
                        return true;
                    }
                }
                Some(Event::VideoEnded) => {
                    phase.ended += 1;
                    if until == Until::Ended {
                        return true;
                    }
                }
                Some(Event::Ended(result)) => {
                    println!("session ended: {result:?}");
                    return false;
                }
                Some(_) => {}
                None => return false,
            }
        }
    }

    /// Count one frame; true if it decoded.
    fn take(&mut self, phase: &mut Phase, frame: VideoFrame) -> bool {
        phase.frames += 1;
        phase.bytes += frame.data.len();
        phase.largest = phase.largest.max(frame.data.len());
        if !phase.sizes.contains(&(frame.width, frame.height)) {
            phase.sizes.push((frame.width, frame.height));
        }
        if frame.keyframe {
            phase.keyframes += 1;
            self.decoder = Some(desktop_vp9::Decoder::new(2).expect("decoder"));
        }
        let Some(decoder) = self.decoder.as_mut() else { return false };
        let decoded = match decoder.decode(&frame.data) {
            Ok(decoded) => decoded,
            Err(e) => {
                println!("frame {} of {} bytes did not decode: {e}", frame.seq, frame.data.len());
                self.decoder = None;
                return false;
            }
        };
        let (w, h) = decoded.size();
        assert_eq!((w, h), (u32::from(frame.width), u32::from(frame.height)), "a frame that is not the size it says");
        assert!(decoded.declares_bt601_studio_swing() || !frame.keyframe, "a keyframe that declares another colour space");
        self.bgrx.resize(w as usize * h as usize * 4, 0);
        decoded.write_bgrx(&mut self.bgrx, w as usize * 4).expect("bgrx");
        self.decoded_size = (w, h);
        phase.decoded += 1;
        let (w, h) = (w as usize, h as usize);
        // Every fourth pixel of every fourth row, leaving out the agent's patch.
        let mut hash = 0xcbf2_9ce4_8422_2325_u64;
        for y in (0..h).step_by(4) {
            for x in (0..w).step_by(4) {
                if x < 300 && y < 300 {
                    continue;
                }
                let i = (y * w + x) * 4;
                for &byte in &self.bgrx[i..i + 3] {
                    hash = (hash ^ u64::from(byte >> 3)).wrapping_mul(0x100_0000_01b3);
                }
            }
        }
        if hash != self.last_hash {
            phase.changed += 1;
            self.last_hash = hash;
        }
        let painted = frame.seq as usize % PALETTE.len();
        let colour = |x: usize, y: usize| {
            let i = (y * w + x) * 4;
            nearest(self.bgrx[i + 2], self.bgrx[i + 1], self.bgrx[i])
        };
        if colour(PATCH.0, PATCH.1) == painted {
            phase.fresh += 1;
            // A pointer drawn into the picture over the patch would be pixels of
            // another colour inside it.
            let foreign = (PATCH.1 - PATCH_REACH..PATCH.1 + PATCH_REACH)
                .flat_map(|y| (PATCH.0 - PATCH_REACH..PATCH.0 + PATCH_REACH).map(move |x| (x, y)))
                .filter(|&(x, y)| colour(x, y) != painted)
                .count();
            phase.patch_frames += 1;
            phase.patch_foreign = phase.patch_foreign.max(foreign as u32);
        }
        true
    }
}

fn png(name: &str, width: u32, height: u32, rgba: &[u8]) {
    let mut out = Vec::new();
    let mut encoder = png::Encoder::new(&mut out, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().expect("png header");
    writer.write_image_data(rgba).expect("png data");
    writer.finish().expect("png finish");
    std::fs::create_dir_all(OUT).expect("creating the output directory");
    let path = format!("{OUT}/{name}.png");
    std::fs::write(&path, out).expect("writing the picture");
    println!("  written to {path}");
}

/// The host's own picture, as PNG under [`OUT`].
fn save_host(session: &Session, name: &str) {
    session.framebuffer().with(|frame| {
        let mut rgba = frame.pixels.clone();
        for px in rgba.as_chunks_mut::<4>().0 {
            px[3] = 0xFF;
        }
        png(name, frame.width, frame.height, &rgba);
    });
}

/// The agent's last decoded frame, as PNG under [`OUT`].
fn save_agent(rx: &Receiver, name: &str) {
    let mut rgba = rx.bgrx.clone();
    for px in rgba.as_chunks_mut::<4>().0 {
        px.swap(0, 2);
        px[3] = 0xFF;
    }
    png(name, rx.decoded_size.0, rx.decoded_size.1, &rgba);
}

/// How much of the desktop differs between the host's own picture and the agent's last
/// frame: 16-pixel blocks whose mean colour is more than 24 apart in some channel, of
/// those compared. The agent's patch is left out, and `None` is two pictures of
/// different sizes.
fn differing_blocks(session: &Session, rx: &Receiver) -> Option<(u32, u32)> {
    const BLOCK: usize = 16;
    let (w, h) = (rx.decoded_size.0 as usize, rx.decoded_size.1 as usize);
    session.framebuffer().with(|host| {
        if (host.width as usize, host.height as usize) != (w, h) || w == 0 {
            return None;
        }
        let (mut differing, mut compared) = (0, 0);
        for by in (0..h - h % BLOCK).step_by(BLOCK) {
            for bx in (0..w - w % BLOCK).step_by(BLOCK) {
                if bx < 300 && by < 300 {
                    continue;
                }
                let (mut ours, mut theirs) = ([0u32; 3], [0u32; 3]);
                for y in by..by + BLOCK {
                    for x in bx..bx + BLOCK {
                        let i = (y * w + x) * 4;
                        for c in 0..3 {
                            // The host's is RGBA, the agent's BGRX.
                            theirs[c] += u32::from(host.pixels[i + c]);
                            ours[c] += u32::from(rx.bgrx[i + 2 - c]);
                        }
                    }
                }
                let area = (BLOCK * BLOCK) as u32;
                compared += 1;
                if (0..3).any(|c| (ours[c] / area).abs_diff(theirs[c] / area) > 24) {
                    differing += 1;
                }
            }
        }
        Some((differing, compared))
    })
}

/// Press and release a key, with the pause a person leaves.
async fn tap(input: &Input, scancode: u8, extended: bool) {
    input.key(scancode, extended, true);
    tokio::time::sleep(Duration::from_millis(60)).await;
    input.key(scancode, extended, false);
    tokio::time::sleep(Duration::from_millis(120)).await;
}

/// Move the pointer along a line, a step every 10 ms, the way a hand crosses a desktop.
async fn sweep(input: &Input, from: (u16, u16), to: (u16, u16), steps: u16) {
    for i in 0..=steps {
        let at = |a: u16, b: u16| (i32::from(a) + (i32::from(b) - i32::from(a)) * i32::from(i) / i32::from(steps)) as u16;
        input.mouse_move(at(from.0, to.0), at(from.1, to.1));
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

/// Cross the desktop four ways in about eight seconds: over the windows, their edges
/// and the taskbar, where the host changes the pointer's shape.
fn sweeps(input: &Input) -> tokio::task::JoinHandle<()> {
    let input = input.clone();
    tokio::spawn(async move {
        let (w, h) = (OPENING.0 as u16, OPENING.1 as u16);
        sweep(&input, (320, 40), (w - 20, h - 10), 200).await;
        sweep(&input, (w - 20, 40), (320, h - 10), 200).await;
        sweep(&input, (320, h / 2), (w - 20, h / 2), 200).await;
        sweep(&input, (w / 2, 320), (w / 2, h - 5), 200).await;
    })
}

fn connect(video: bool) -> (Session, Receiver) {
    let name = std::env::var(TARGET_ENV).unwrap_or_else(|_| panic!("set {TARGET_ENV}"));
    let target = common::uat_target(&name);
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
        video: video.then_some(PLAN),
    });
    let input = session.input().clone();
    (session, Receiver { input, events, ear, decoder: None, bgrx: Vec::new(), decoded_size: (0, 0), last_hash: 0 })
}

async fn wait_connected(rx: &mut Receiver) {
    let first = tokio::time::timeout(Duration::from_secs(60), rx.events.recv()).await.expect("connect in time");
    match first {
        Some(Event::Connected { width, height }) => println!("connected {width}x{height}"),
        other => panic!("not connected: {other:?}"),
    }
}

async fn phase(rx: &mut Receiver, name: &str, seconds: u64) -> Phase {
    let mut p = Phase::default();
    rx.run(&mut p, Instant::now() + Duration::from_secs(seconds), Until::Time).await;
    p.print(name, seconds);
    p
}

/// Wait for what `until` names, for `seconds` at most, and say how long it took.
async fn wait(rx: &mut Receiver, name: &str, seconds: u64, until: Until) -> (bool, Phase) {
    let started = Instant::now();
    let mut p = Phase::default();
    let met = rx.run(&mut p, started + Duration::from_secs(seconds), until).await;
    p.print(name, started.elapsed().as_secs());
    println!("  {name}: {} after {:?}", if met { "came" } else { "never came" }, started.elapsed());
    (met, p)
}

/// Connect, let the logon settle into a desktop, start the agent and wait for its
/// stream.
async fn connect_to_stream(switches: &str) -> (Session, Receiver) {
    common::init_logging();
    let (session, mut rx) = connect(true);
    wait_connected(&mut rx).await;
    phase(&mut rx, "the-pipeline-alone", 8).await;
    let starting = start_agent(switches);
    let (came, _) = wait(&mut rx, "waiting-for-the-stream", 60, Until::Video).await;
    starting.await.unwrap();
    assert!(came, "no decodable video arrived on remotex.video");
    (session, rx)
}

/// The stream takes the picture and gives it back: a frame of megabytes in one write,
/// the host's graphics and the sound going on beside the stream, the pointer
/// as its own shape from the agent and never in the picture, a resize through the
/// pipeline and back, and the agent leaving.
#[tokio::test]
#[ignore = "drives a real RDP host named in tmp/test_uat.toml and the agent"]
async fn the_stream_carries_the_desktop_and_gives_it_back() {
    common::init_logging();
    let (session, mut rx) = connect(true);
    let input = session.input().clone();
    wait_connected(&mut rx).await;
    input.mouse_move(700, 500);
    let alone = phase(&mut rx, "the-pipeline-alone", 8).await;
    assert!(alone.host_frames > 0 && alone.frames == 0);

    let starting = start_agent(&format!("--patch --big {BIG}"));
    let mut opening = Phase::default();
    let came = rx.run(&mut opening, Instant::now() + Duration::from_secs(60), Until::Video).await;
    starting.await.unwrap();
    opening.print("waiting-for-the-stream", 0);
    assert!(came, "no decodable video arrived on remotex.video");
    // The message of megabytes opens a keyframe and carries nothing a decoder takes,
    // so it arrived as the stream's first frame and the first to decode came after.
    assert_eq!(opening.largest, BIG, "the channel did not carry {BIG} bytes as one message");

    let flowing = phase(&mut rx, "the-stream", 10).await;
    assert!(flowing.host_frames > 0, "the host's graphics stopped under the stream");
    assert_eq!(flowing.fresh, flowing.decoded, "a stale frame");
    assert!(flowing.sound > 0, "the sound stopped under the stream");
    assert_eq!(flowing.patch_foreign, 0, "something drawn into the patch");
    println!("  differing blocks, host against agent, under the stream: {:?}", differing_blocks(&session, &rx));

    // The pointer: crossing the desktop its shape changes, and the shapes come from
    // the agent, the host's own updates being held while the stream is the picture.
    let crossing = sweeps(&input);
    let swept = phase(&mut rx, "the-stream+sweeps", 9).await;
    crossing.await.unwrap();
    assert!(swept.cursors > 0, "no pointer shape came while the pointer crossed the desktop");
    // Parked on the patch, where a pointer in the picture would be seen.
    input.mouse_move(PATCH.0 as u16 - 30, PATCH.1 as u16 - 30);
    let parked = phase(&mut rx, "the-stream+pointer-on-patch", 5).await;
    assert!(parked.patch_frames > 0);
    assert_eq!(parked.patch_foreign, 0, "the pointer is drawn into the picture");
    save_agent(&rx, "1-agent-pointer-on-patch");
    input.mouse_move(700, 500);

    // A resize: the pipeline takes the picture for it, and the stream comes back at
    // the new size.
    let asked = Instant::now();
    input.resize(RESIZED.0, RESIZED.1, 100);
    let (ended, _) = wait(&mut rx, "resize-to-the-pipeline", 20, Until::Ended).await;
    assert!(ended, "the pipeline never took the picture for the resize");
    let mut resizing = Phase::default();
    let came = rx.run(&mut resizing, Instant::now() + Duration::from_secs(30), Until::Video).await;
    resizing.print("resize-to-the-stream", asked.elapsed().as_secs());
    println!("  the stream was back {:?} after the resize was asked for", asked.elapsed());
    assert!(came, "the stream never came back after the resize");
    assert_eq!(resizing.resizes, vec![RESIZED], "the host's graphics reset");
    assert_eq!(resizing.sizes, vec![(RESIZED.0 as u16, RESIZED.1 as u16)]);
    assert_eq!(resizing.keyframes, 1, "the stream came back at something other than a keyframe");
    let resized = phase(&mut rx, "the-stream-resized", 10).await;
    assert_eq!(resized.fresh, resized.decoded);
    assert_eq!(resized.ended, 0);

    // The agent leaves, and the pipeline has the desktop as if it had never come.
    let stopping = stop_agent();
    let mut leaving = Phase::default();
    let ended = rx.run(&mut leaving, Instant::now() + Duration::from_secs(30), Until::Ended).await;
    assert!(ended, "the pipeline never took the picture back");
    let left = Instant::now();
    let mut back = Phase::default();
    let drew = rx.run(&mut back, Instant::now() + Duration::from_secs(10), Until::HostFrame).await;
    println!("  the host's next frame came {:?} after the agent's channel closed", left.elapsed());
    assert!(drew, "the host drew nothing after the agent's channel closed");
    stopping.await.unwrap();
    let after = phase(&mut rx, "the-pipeline-again", 8).await;
    assert!(after.host_frames > 0 && after.frames == 0 && after.sound > 0);
    save_host(&session, "2-host-after-the-agent");
}

/// The secure desktop, which a capture in the user's session is refused: the screen
/// Ctrl+Alt+Del brings up, as a UAC prompt and the lock screen are. The agent says it
/// cannot see the desktop, the pipeline shows the screen, and the stream comes back once
/// it is dismissed.
#[tokio::test]
#[ignore = "drives a real RDP host named in tmp/test_uat.toml and the agent"]
async fn the_secure_desktop_is_the_pipelines_to_show() {
    const ESCAPE: u8 = 0x01;
    const LCONTROL: u8 = 0x1D;
    const LALT: u8 = 0x38;
    const DELETE: u8 = 0x53;
    let (session, mut rx) = connect_to_stream("--patch").await;
    let input = session.input().clone();
    phase(&mut rx, "the-stream", 5).await;

    input.key(LCONTROL, false, true);
    input.key(LALT, false, true);
    tap(&input, DELETE, true).await;
    input.key(LALT, false, false);
    input.key(LCONTROL, false, false);
    let asked = Instant::now();

    let (ended, _) = wait(&mut rx, "to-the-secure-desktop", 10, Until::Ended).await;
    if !ended {
        stop_agent().await.unwrap();
        panic!("no secure desktop came up");
    }
    println!("  the agent gave the picture up {:?} after the keys", asked.elapsed());
    let gave_up = Instant::now();
    let (drew, _) = wait(&mut rx, "the-secure-desktop-drawn", 10, Until::HostFrame).await;
    assert!(drew, "the pipeline never drew the secure desktop");
    println!("  the host drew {:?} after the agent gave the picture up", gave_up.elapsed());
    let secure = phase(&mut rx, "the-secure-desktop", 4).await;
    assert_eq!(secure.frames, 0, "the agent sent frames of a desktop it cannot see");
    save_host(&session, "3-host-secure-desktop");

    let dismissed = Instant::now();
    tap(&input, ESCAPE, false).await;
    let mut returning = Phase::default();
    let came = rx.run(&mut returning, Instant::now() + Duration::from_secs(20), Until::Video).await;
    returning.print("back-to-the-stream", dismissed.elapsed().as_secs());
    println!("  the stream was back {:?} after the screen was dismissed", dismissed.elapsed());
    assert!(came, "the stream never came back");
    assert_eq!(returning.keyframes, 1);
    let after = phase(&mut rx, "the-stream-again", 8).await;
    assert_eq!(after.fresh, after.decoded);
    assert_eq!(after.ended, 0);
    save_agent(&rx, "4-agent-after-the-secure-desktop");
    drop(session);
    stop_agent().await.unwrap();
}

/// A reconnect with the agent left running: it opens its channel again on the new
/// connection and the stream is the picture again, from a keyframe to the new plan.
#[tokio::test]
#[ignore = "drives a real RDP host named in tmp/test_uat.toml and the agent"]
async fn the_stream_comes_back_on_a_new_connection() {
    let (session, mut rx) = connect_to_stream("--patch").await;
    phase(&mut rx, "the-stream", 5).await;
    drop(session);
    drop(rx);
    tokio::time::sleep(Duration::from_secs(5)).await;

    let (session, mut rx) = connect(true);
    wait_connected(&mut rx).await;
    let connected = Instant::now();
    let (came, first) = wait(&mut rx, "waiting-for-the-stream", 60, Until::Video).await;
    assert!(came, "the agent never opened its channel on the new connection");
    assert_eq!(first.keyframes, 1);
    println!("  the stream was the picture {:?} after the connection", connected.elapsed());
    let flowing = phase(&mut rx, "the-stream-again", 10).await;
    assert_eq!(flowing.fresh, flowing.decoded);
    drop(session);
    stop_agent().await.unwrap();
}

/// The installed service gives each connection a session's agent of its own: the
/// stream comes on a connection that takes it with nothing started by hand, comes again
/// on the next connection, and stays away from one that refuses the channel, as a
/// target without `agent_passthrough` does, which the pipeline carries alone.
#[tokio::test]
#[ignore = "drives a real RDP host named in tmp/test_uat.toml with the agent's service installed"]
async fn the_service_gives_each_connection_an_agent() {
    common::init_logging();
    for round in 1..=2 {
        let (session, mut rx) = connect(true);
        wait_connected(&mut rx).await;
        let connected = Instant::now();
        let (came, first) = wait(&mut rx, &format!("connection-{round}-waiting"), 60, Until::Video).await;
        assert!(came, "the service started no agent that streamed on connection {round}");
        assert_eq!(first.keyframes, 1);
        println!("  the stream was the picture {:?} after connection {round}", connected.elapsed());
        let flowing = phase(&mut rx, &format!("connection-{round}-stream"), 5).await;
        assert!(flowing.decoded > 0 && flowing.ended == 0);
        assert!(flowing.host_frames > 0, "the host's graphics stopped under the stream");
        drop(session);
        drop(rx);
        tokio::time::sleep(Duration::from_secs(5)).await;
    }

    let (session, mut rx) = connect(false);
    wait_connected(&mut rx).await;
    let refused = phase(&mut rx, "refusing-connection", 30).await;
    assert_eq!(refused.frames, 0);
    assert!(refused.host_frames > 0, "the pipeline did not carry the desktop");
    save_host(&session, "5-host-refusing-the-channel");
    drop(session);
    drop(rx);
    tokio::time::sleep(Duration::from_secs(5)).await;

    let (session, mut rx) = connect(true);
    wait_connected(&mut rx).await;
    let (came, _) = wait(&mut rx, "taking-again-waiting", 60, Until::Video).await;
    assert!(came, "no stream on a connection that takes it, after one that refused it");
    save_agent(&rx, "6-agent-from-the-service");
    drop(session);
}

/// Removing the package while its agent streams: the service stops the session's agent
/// on its way out, the channel closes, and the pipeline takes the picture back on a
/// connection that goes on. The host is left without the MSI.
#[tokio::test]
#[ignore = "drives a real RDP host named in tmp/test_uat.toml with the agent's service installed, and removes it"]
async fn removing_the_service_under_the_stream_gives_the_picture_back() {
    common::init_logging();
    let (session, mut rx) = connect(true);
    wait_connected(&mut rx).await;
    let (came, _) = wait(&mut rx, "waiting-for-the-stream", 60, Until::Video).await;
    assert!(came, "the service started no agent that streamed");
    let flowing = phase(&mut rx, "the-stream", 5).await;
    assert!(flowing.decoded > 0 && flowing.ended == 0);

    let removing = uninstall_service();
    let (ended, _) = wait(&mut rx, "removing-under-the-stream", 300, Until::Ended).await;
    assert!(ended, "the stream did not end while the package was removed");
    let (drew, _) = wait(&mut rx, "the-pipeline-back", 10, Until::HostFrame).await;
    assert!(drew, "the pipeline did not take the picture back");
    // The events are taken until the removal is through, which is bounded.
    while !removing.is_finished() {
        let started = Instant::now();
        let p = phase(&mut rx, "the-removal-finishing", 1).await;
        assert!(started.elapsed() >= Duration::from_secs(1), "the connection ended during the removal");
        assert_eq!(p.frames, 0, "a stream after its agent was stopped");
    }
    assert!(removing.await.unwrap(), "the package was not removed");
    let after = phase(&mut rx, "without-the-agent", 10).await;
    assert_eq!(after.frames, 0);
    assert!(after.host_frames > 0, "the pipeline did not carry the desktop");
    save_host(&session, "7-host-after-the-removal");
    drop(session);
}

/// What a browser was sent on the session socket, of what a reattach turns on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Sent {
    Picker,
    Connected,
    /// A `videoFormat`: the stream passed as it came, or encoded here.
    Format { passthrough: bool },
    Unit { keyframe: bool },
}

/// What was sent after the last announcement of a passed stream: `None` before any.
fn after_passing(sent: &[Sent]) -> Option<&[Sent]> {
    let at = sent.iter().rposition(|s| *s == Sent::Format { passthrough: true })?;
    Some(&sent[at + 1..])
}

/// Take what the gateway sends on `ws`, acknowledging each batch as a browser that
/// painted it at once, until `done` says so or `seconds` pass.
async fn watch(ws: &mut common::Ws, seconds: u64, done: impl Fn(&[Sent]) -> bool) -> (Vec<Sent>, Duration) {
    let started = Instant::now();
    let deadline = started + Duration::from_secs(seconds);
    let mut sent = Vec::new();
    while !done(&sent) {
        let message = match tokio::time::timeout_at(deadline.into(), ws.next()).await {
            Err(_) => break,
            Ok(Some(Ok(message))) => message,
            Ok(other) => panic!("the gateway closed the session socket: {other:?}"),
        };
        match message {
            Message::Binary(frame) if frame.first() == Some(&remotex::protocol::batch::FRAME_KIND) => {
                ws.send(Message::text(common::paint_ack(&frame))).await.unwrap();
                sent.extend(common::batch_units(&frame).iter().map(|unit| Sent::Unit { keyframe: unit.keyframe }));
            }
            Message::Text(text) => {
                let json: serde_json::Value = serde_json::from_str(&text).unwrap();
                match json["type"].as_str() {
                    Some("picker") => sent.push(Sent::Picker),
                    Some("connected") => sent.push(Sent::Connected),
                    Some("videoFormat") => {
                        sent.push(Sent::Format { passthrough: json["passthrough"].as_bool().unwrap() });
                    }
                    Some("error") => panic!("the gateway said: {text}"),
                    _ => {}
                }
            }
            _ => {}
        }
    }
    (sent, started.elapsed())
}

/// Whether a passed keyframe has come since the stream was last announced as passed.
fn passed_keyframe(sent: &[Sent]) -> bool {
    after_passing(sent).is_some_and(|after| after.contains(&Sent::Unit { keyframe: true }))
}

/// A browser's reattach under the stream, through a gateway: the socket drops, the
/// same browser comes back on its claim, and the engine it left running is resumed.
/// The new socket is sent nothing of the stream until a keyframe the engine asks the
/// agent for, behind a fresh announcement, and the stream goes on passed from there.
/// The agent is the installed service's.
#[tokio::test]
#[ignore = "drives a real RDP host named in tmp/test_uat.toml with the agent's service installed"]
async fn a_reattach_starts_the_stream_over_at_a_keyframe() {
    common::init_logging();
    let name = std::env::var(TARGET_ENV).unwrap_or_else(|_| panic!("set {TARGET_ENV}"));
    let mut target = common::uat_target(&name);
    target.agent_passthrough = true;
    let config = remotex::config::AppConfig {
        listen: remotex::config::ListenAddr::Tcp("127.0.0.1:0".to_owned()),
        targets: vec![target],
        auth: common::test_auth(),
        branding: remotex::config::Branding { text: "remotex".to_owned(), logo: None },
        dev_hostname: None,
        meter: None,
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, remotex::server::router(config, Default::default())).await.unwrap() });

    let cookie = common::login(addr).await;
    let token = common::claim_session(addr, &cookie).await;
    let mut ws = common::connect_ws(addr, &token, &cookie).await;
    common::connect_target(&mut ws, &name).await;
    let (opening, took) = watch(&mut ws, 60, passed_keyframe).await;
    assert!(passed_keyframe(&opening), "the agent's stream was never passed: {opening:?}");
    println!("  the stream was passed {took:?} after the connect");
    let (flowing, _) = watch(&mut ws, 3, |_| false).await;
    assert!(!flowing.contains(&Sent::Format { passthrough: false }), "the pipeline took the picture: {flowing:?}");
    assert!(flowing.contains(&Sent::Unit { keyframe: false }), "the stream did not flow");

    // The socket drops, as a browser's does on a network change or a reload.
    drop(ws);
    tokio::time::sleep(Duration::from_secs(3)).await;

    let (status, body) = common::post_session(addr, &cookie, &format!(r#"{{"sessionId":"{token}"}}"#)).await;
    assert_eq!(status, 200, "the same browser's reclaim was refused: {body}");
    let token: String = serde_json::from_str::<serde_json::Value>(&body).unwrap()["sessionId"].as_str().unwrap().to_owned();
    let mut ws = common::connect_ws(addr, &token, &cookie).await;
    let (back, took) = watch(&mut ws, 20, passed_keyframe).await;
    println!("  after the reattach: {back:?}");
    assert_eq!(back.first(), Some(&Sent::Connected), "the engine was not resumed");
    assert!(!back.contains(&Sent::Picker));
    assert!(passed_keyframe(&back), "no passed keyframe after the reattach");
    let first_unit = back.iter().find(|s| matches!(s, Sent::Unit { .. }));
    assert_eq!(first_unit, Some(&Sent::Unit { keyframe: true }), "a unit ahead of the keyframe the restart needs");
    let announced = back.iter().position(|s| *s == Sent::Format { passthrough: true }).unwrap();
    let keyframe = back.iter().position(|s| *s == Sent::Unit { keyframe: true }).unwrap();
    assert!(announced < keyframe, "the keyframe went out ahead of its announcement");
    assert!(!back.contains(&Sent::Format { passthrough: false }), "the pipeline took the picture");
    println!("  the stream was passed again {took:?} after the reattach");
    let (flowing, _) = watch(&mut ws, 5, |_| false).await;
    assert!(!flowing.contains(&Sent::Format { passthrough: false }), "the pipeline took the picture: {flowing:?}");
    assert!(flowing.contains(&Sent::Unit { keyframe: false }), "the stream did not go on after the reattach");

    ws.send(Message::text(r#"{"type":"disconnect"}"#)).await.unwrap();
    let _ = tokio::time::timeout(Duration::from_secs(5), ws.next()).await;
}

/// Whether the animation and sound left playing on the host keep going across
/// disconnects: three connections, fifteen seconds apart. No agent; the host's own
/// graphics and sound are what is counted.
#[tokio::test]
#[ignore = "drives a real RDP host named in tmp/test_uat.toml"]
async fn animation_page_survives_reconnects() {
    common::init_logging();
    for round in 1..=3 {
        let (session, mut rx) = connect(false);
        wait_connected(&mut rx).await;
        phase(&mut rx, &format!("connection-{round}-first-3s"), 3).await;
        phase(&mut rx, &format!("connection-{round}"), 10).await;
        save_host(&session, &format!("page-{round}"));
        drop(session);
        drop(rx);
        if round < 3 {
            println!("disconnected for 15 s");
            tokio::time::sleep(Duration::from_secs(15)).await;
        }
    }
}
