//! POC: an in-session agent that captures the RDP session's desktop, codes it as VP9
//! and writes it to the `remotex.video` dynamic virtual channel of the RDP connection
//! the session is attached to, in the protocol `src/rdp_client/proto/video.rs` reads.
//!
//! It codes nothing until the gateway's plan arrives, keeps one frame in flight and
//! sends the next on the echo of the one before, walks its quality by how long the
//! echoes take, and sends the pointer as its own shape, never in the picture. When
//! it cannot duplicate the desktop — the secure desktop of a UAC prompt or the lock
//! screen — it says so and tries again until it can, and starts over at a keyframe.
//!
//! Two switches are the probe's (`tests/rdp_dvc_video_probe.rs`):
//!
//! - `--patch` paints a small window a colour that follows the frame's number,
//!   `PALETTE[seq % 8]`, and waits for the composed screen to show it before each
//!   capture, so the probe can tell a fresh frame from a stale surface handed back
//!   again by reading the decoded patch.
//! - `--big <bytes>` sends one message of that size ahead of the stream, to show the
//!   channel carries a frame of megabytes in one write.

#![windows_subsystem = "windows"]

use std::fs::File;
use std::io::Write as _;
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, TryRecvError};
use std::time::{Duration, Instant};

use anyhow::{Context as _, Result, bail};
use desktop_vp9::walk::{Pace, QualityWalk};
use desktop_vp9::{Chroma, Encoder, Picture};
use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Direct3D::*;
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dwm::DwmFlush;
use windows::Win32::Graphics::Dxgi::Common::*;
use windows::Win32::Graphics::Dxgi::*;
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::Storage::FileSystem::{ReadFile, WriteFile};
use windows::Win32::System::IO::{CancelIoEx, GetOverlappedResult, OVERLAPPED};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::RemoteDesktop::*;
use windows::Win32::System::Threading::{CreateEventW, GetCurrentProcess};
use windows::Win32::UI::HiDpi::*;
use windows::Win32::UI::WindowsAndMessaging::*;
use windows::core::{Interface as _, PCSTR, w};

const CHANNEL: &[u8] = b"remotex.video\0";
/// What this agent speaks, which the plan must name.
const VERSION: u8 = 1;

const FRAME: u8 = 0x01;
const POINTER: u8 = 0x02;
const POINTER_HIDDEN: u8 = 0x03;
const GAP: u8 = 0x04;
const PLAN: u8 = 0x81;
const ECHO: u8 = 0x82;
const KEYFRAME: u8 = 0x83;

/// The least gap between two frames on a link that is not slowed: 30 a second.
const INTERVAL: Duration = Duration::from_millis(33);
/// How long a desktop sent below the plan's quality stays quiet, with the gateway
/// holding the last frame, before it is sharpened there. wlshare's `SETTLE_IDLE`.
const SETTLE_IDLE: Duration = Duration::from_millis(500);
/// How long a capture waits for the desktop to change.
const CAPTURE_WAIT: u32 = 100;
/// How long an echo may take before the frame is given up as lost. The gateway holds
/// one half a second at most.
const ECHO_LOST: Duration = Duration::from_secs(3);
/// How long between two attempts to duplicate a desktop that is refused.
const RETRY: Duration = Duration::from_millis(250);
/// RDP's own bound on a pointer's side, which the gateway holds this one to.
const POINTER_MAX: u32 = 384;
const THREADS: usize = 2;

const WIN_X: i32 = 100;
const WIN_Y: i32 = 100;
const WIN_SIDE: i32 = 160;
/// How long the composed screen is given to show a colour just painted.
const COMPOSED: Duration = Duration::from_millis(200);

const PALETTE: [(u8, u8, u8); 8] =
    [(255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 0), (0, 255, 255), (255, 0, 255), (255, 255, 255), (0, 0, 0)];

/// The agent's log, each line dated in UTC to the millisecond.
struct Log(File);

impl Log {
    fn say(&mut self, what: impl AsRef<str>) {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
        let (day, ms) = (now.as_secs() % 86_400, now.subsec_millis());
        let line = format!("{:02}:{:02}:{:02}.{ms:03} {}\n", day / 3600, day / 60 % 60, day % 60, what.as_ref());
        let _ = self.0.write_all(line.as_bytes());
        let _ = self.0.flush();
    }
}

// ------------------------------------------------------------------ the channel

/// What the gateway is to be sent.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Plan {
    chroma: Chroma,
    quality: u8,
    adaptive: bool,
}

enum Incoming {
    Plan(Plan),
    /// A plan in a version this agent does not speak.
    Foreign(u8),
    Echo(u32),
    Keyframe,
    Closed(String),
}

/// A handle another thread may use: the channel's file, read on one thread and
/// written on another, each with an `OVERLAPPED` of its own.
#[derive(Clone, Copy)]
struct Shared(HANDLE);
// SAFETY: a file handle is a number the kernel resolves, and overlapped reads and
// writes on one are independent of each other.
unsafe impl Send for Shared {}

struct Channel {
    wts: HANDLE,
    file: HANDLE,
    event: HANDLE,
    incoming: Receiver<Incoming>,
    reader: Option<std::thread::JoinHandle<()>>,
}

impl Channel {
    fn open() -> Result<Self> {
        unsafe {
            let flags = WTS_CHANNEL_OPTION_DYNAMIC | WTS_CHANNEL_OPTION_DYNAMIC_PRI_HIGH | WTS_CHANNEL_OPTION_DYNAMIC_NO_COMPRESS;
            let wts = WTSVirtualChannelOpenEx(WTS_CURRENT_SESSION, PCSTR(CHANNEL.as_ptr()), flags)
                .context("WTSVirtualChannelOpenEx")?;
            let mut buffer = std::ptr::null_mut();
            let mut len = 0u32;
            if let Err(e) = WTSVirtualChannelQuery(wts, WTSVirtualFileHandle, &mut buffer, &mut len) {
                let _ = WTSVirtualChannelClose(wts);
                return Err(e).context("WTSVirtualChannelQuery");
            }
            let source = *(buffer as *const HANDLE);
            let mut file = HANDLE::default();
            let dup = DuplicateHandle(GetCurrentProcess(), source, GetCurrentProcess(), &mut file, 0, false, DUPLICATE_SAME_ACCESS);
            WTSFreeMemory(buffer);
            if let Err(e) = dup {
                let _ = WTSVirtualChannelClose(wts);
                return Err(e).context("DuplicateHandle");
            }
            let event = CreateEventW(None, true, false, None).context("CreateEventW")?;
            let (tx, incoming) = std::sync::mpsc::channel();
            let shared = Shared(file);
            let reader = std::thread::Builder::new().name("channel".into()).spawn(move || read(shared, &tx)).context("the reader")?;
            Ok(Self { wts, file, event, incoming, reader: Some(reader) })
        }
    }

    /// One message, one write: the channel cuts it into its own PDUs and the gateway
    /// joins them. Returns how long the write took, which is the channel having no
    /// room.
    fn send(&self, message: &[u8]) -> Result<Duration> {
        let started = Instant::now();
        unsafe {
            let mut ov = OVERLAPPED { hEvent: self.event, ..Default::default() };
            let mut written = 0u32;
            if let Err(e) = WriteFile(self.file, Some(message), None, Some(&mut ov))
                && e.code() != ERROR_IO_PENDING.to_hresult()
            {
                return Err(e).context("WriteFile");
            }
            GetOverlappedResult(self.file, &ov, &mut written, true).context("GetOverlappedResult")?;
            if written as usize != message.len() {
                bail!("short write: {written} of {}", message.len());
            }
        }
        Ok(started.elapsed())
    }
}

impl Drop for Channel {
    fn drop(&mut self) {
        unsafe {
            // The reader is parked in a read, which this ends.
            let _ = CancelIoEx(self.file, None);
            if let Some(reader) = self.reader.take() {
                let _ = reader.join();
            }
            let _ = CloseHandle(self.file);
            let _ = CloseHandle(self.event);
            let _ = WTSVirtualChannelClose(self.wts);
        }
    }
}

/// The gateway's messages, off the channel until it closes. A read returns one chunk
/// behind a `CHANNEL_PDU_HEADER`: the whole message's length and the flags that say
/// where in it the chunk falls.
fn read(file: Shared, tx: &Sender<Incoming>) {
    const CHUNK: usize = 1600 + 8;
    const FIRST: u32 = 1;
    const LAST: u32 = 2;
    let closed = |why: String| {
        let _ = tx.send(Incoming::Closed(why));
    };
    let event = match unsafe { CreateEventW(None, true, false, None) } {
        Ok(event) => event,
        Err(e) => return closed(format!("CreateEventW: {e}")),
    };
    let mut message = Vec::new();
    let mut chunk = [0u8; CHUNK];
    loop {
        let mut got = 0u32;
        unsafe {
            let mut ov = OVERLAPPED { hEvent: event, ..Default::default() };
            if let Err(e) = ReadFile(file.0, Some(&mut chunk), None, Some(&mut ov))
                && e.code() != ERROR_IO_PENDING.to_hresult()
            {
                closed(format!("ReadFile: {e}"));
                break;
            }
            if let Err(e) = GetOverlappedResult(file.0, &ov, &mut got, true) {
                closed(format!("GetOverlappedResult: {e}"));
                break;
            }
        }
        let got = got as usize;
        if got < 8 {
            continue;
        }
        let flags = u32::from_le_bytes(chunk[4..8].try_into().unwrap());
        if flags & FIRST != 0 {
            message.clear();
        }
        message.extend_from_slice(&chunk[8..got]);
        if flags & LAST == 0 {
            continue;
        }
        let said = match message[..] {
            [PLAN, VERSION, chroma, quality, adaptive] => Incoming::Plan(Plan {
                chroma: if chroma == 0 { Chroma::Subsampled } else { Chroma::Full },
                quality,
                adaptive: adaptive != 0,
            }),
            [PLAN, version, ..] => Incoming::Foreign(version),
            [ECHO, a, b, c, d] => Incoming::Echo(u32::from_le_bytes([a, b, c, d])),
            [KEYFRAME] => Incoming::Keyframe,
            _ => continue,
        };
        if tx.send(said).is_err() {
            break;
        }
    }
    unsafe {
        let _ = CloseHandle(event);
    }
}

// ------------------------------------------------------------------ the pointer

/// The pointer as Desktop Duplication hands it over beside the picture, which never
/// holds it, and whether the gateway has heard of it.
#[derive(Default)]
struct PointerState {
    /// The shape's message, as it goes out.
    shape: Option<Vec<u8>>,
    visible: bool,
    /// Whether what the gateway was last told is out of date.
    dirty: bool,
}

impl PointerState {
    /// What to tell the gateway, if it is owed anything.
    fn message(&mut self) -> Option<Vec<u8>> {
        if !std::mem::take(&mut self.dirty) {
            return None;
        }
        if !self.visible {
            return Some(vec![POINTER_HIDDEN]);
        }
        // Visible, in a shape not handed over yet: said when it is.
        self.shape.clone()
    }
}

/// A pixel the desktop under it would be inverted by, which cannot be: the desktop is
/// not here. The checkerboard the gateway's own pointer decoder draws.
fn inverted(row: u32, column: u32) -> [u8; 4] {
    if (row + column) % 2 == 0 { [0xFF; 4] } else { [0x00, 0x00, 0x00, 0xFF] }
}

/// A pointer shape as its message: straight-alpha `RGBA`, top row first.
fn pointer_message(info: &DXGI_OUTDUPL_POINTER_SHAPE_INFO, bytes: &[u8]) -> Option<Vec<u8>> {
    const MONOCHROME: u32 = 1;
    const COLOR: u32 = 2;
    const MASKED_COLOR: u32 = 4;
    let (width, pitch) = (info.Width, info.Pitch as usize);
    // A monochrome shape is its AND mask above its XOR mask, each `height` rows.
    let height = if info.Type == MONOCHROME { info.Height / 2 } else { info.Height };
    if width == 0 || height == 0 || width > POINTER_MAX || height > POINTER_MAX {
        return None;
    }
    let rows = if info.Type == MONOCHROME { height * 2 } else { height } as usize;
    if bytes.len() < rows * pitch {
        return None;
    }
    let hot = |at: i32, side: u32| at.clamp(0, side as i32 - 1) as u16;
    let mut message = vec![POINTER];
    message.extend_from_slice(&(width as u16).to_le_bytes());
    message.extend_from_slice(&(height as u16).to_le_bytes());
    message.extend_from_slice(&hot(info.HotSpot.x, width).to_le_bytes());
    message.extend_from_slice(&hot(info.HotSpot.y, height).to_le_bytes());
    for row in 0..height {
        for column in 0..width {
            let (r, c) = (row as usize, column as usize);
            let pixel = match info.Type {
                MONOCHROME => {
                    let bit = |row: usize| bytes[row * pitch + c / 8] >> (7 - c % 8) & 1;
                    match (bit(r), bit(r + height as usize)) {
                        (0, 0) => [0x00, 0x00, 0x00, 0xFF],
                        (0, _) => [0xFF; 4],
                        (_, 0) => [0x00; 4],
                        _ => inverted(row, column),
                    }
                }
                COLOR => {
                    let at = r * pitch + c * 4;
                    [bytes[at + 2], bytes[at + 1], bytes[at], bytes[at + 3]]
                }
                MASKED_COLOR => {
                    let at = r * pitch + c * 4;
                    let (b, g, r, mask) = (bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
                    match (mask, (r, g, b)) {
                        (0, _) => [r, g, b, 0xFF],
                        (_, (0, 0, 0)) => [0x00; 4],
                        _ => inverted(row, column),
                    }
                }
                _ => return None,
            };
            message.extend_from_slice(&pixel);
        }
    }
    Some(message)
}

// ------------------------------------------------------------------ capture

/// One duplication of the desktop and the encoder for its size. A desktop of another
/// size is another duplication: a mode change ends this one.
struct Capture {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    dup: IDXGIOutputDuplication,
    staging: Option<ID3D11Texture2D>,
    size: (u16, u16),
    picture: Picture,
    encoder: Encoder,
    shape: Vec<u8>,
}

enum Grab {
    /// The desktop changed, and the picture holds it.
    Picture,
    /// Nothing of the picture changed; the pointer may have.
    Still,
    Lost(windows::core::Error),
}

impl Capture {
    fn new(plan: Plan, quality: u8, log: &mut Log) -> Result<Self> {
        unsafe {
            let factory: IDXGIFactory1 = CreateDXGIFactory1().context("CreateDXGIFactory1")?;
            let mut a = 0;
            while let Ok(adapter) = factory.EnumAdapters1(a) {
                let mut o = 0;
                while let Ok(output) = adapter.EnumOutputs(o) {
                    let od = output.GetDesc()?;
                    let r = od.DesktopCoordinates;
                    if od.AttachedToDesktop.as_bool() && r.left == 0 && r.top == 0 {
                        let mut device = None;
                        let mut context = None;
                        D3D11CreateDevice(
                            &adapter,
                            D3D_DRIVER_TYPE_UNKNOWN,
                            HMODULE::default(),
                            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                            None,
                            D3D11_SDK_VERSION,
                            Some(&mut device),
                            None,
                            Some(&mut context),
                        )
                        .context("D3D11CreateDevice")?;
                        let device = device.unwrap();
                        let output1: IDXGIOutput1 = output.cast()?;
                        let dup = output1.DuplicateOutput(&device).context("DuplicateOutput")?;
                        let mode = dup.GetDesc().ModeDesc;
                        let (Ok(width), Ok(height)) = (u16::try_from(mode.Width), u16::try_from(mode.Height)) else {
                            bail!("a {}x{} desktop", mode.Width, mode.Height);
                        };
                        log.say(format!("duplicating a {width}x{height} desktop, {} at quality {quality}", plan.chroma.name()));
                        return Ok(Self {
                            device,
                            context: context.unwrap(),
                            dup,
                            staging: None,
                            size: (width, height),
                            picture: Picture::new(width, height, plan.chroma)?,
                            encoder: Encoder::new(width, height, plan.chroma, quality, THREADS)?,
                            shape: Vec::new(),
                        });
                    }
                    o += 1;
                }
                a += 1;
            }
            bail!("no output at the desktop's origin")
        }
    }

    fn grab(&mut self, pointer: &mut PointerState) -> Result<Grab> {
        unsafe {
            let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
            let mut resource = None;
            match self.dup.AcquireNextFrame(CAPTURE_WAIT, &mut info, &mut resource) {
                Ok(()) => {}
                Err(e) if e.code() == DXGI_ERROR_WAIT_TIMEOUT => return Ok(Grab::Still),
                Err(e) => return Ok(Grab::Lost(e)),
            }
            let result = self.take(&info, resource, pointer);
            let _ = self.dup.ReleaseFrame();
            result
        }
    }

    unsafe fn take(&mut self, info: &DXGI_OUTDUPL_FRAME_INFO, resource: Option<IDXGIResource>, pointer: &mut PointerState) -> Result<Grab> {
        unsafe {
            if info.LastMouseUpdateTime != 0 {
                let visible = info.PointerPosition.Visible.as_bool();
                pointer.dirty |= visible != pointer.visible;
                pointer.visible = visible;
            }
            if info.PointerShapeBufferSize > 0 {
                self.shape.resize(info.PointerShapeBufferSize as usize, 0);
                let mut needed = 0u32;
                let mut shape = DXGI_OUTDUPL_POINTER_SHAPE_INFO::default();
                self.dup
                    .GetFramePointerShape(info.PointerShapeBufferSize, self.shape.as_mut_ptr().cast(), &mut needed, &mut shape)
                    .context("GetFramePointerShape")?;
                if let Some(message) = pointer_message(&shape, &self.shape) {
                    pointer.shape = Some(message);
                    pointer.dirty = true;
                }
            }
            // A frame that moved the pointer alone presents nothing.
            let Some(resource) = resource.filter(|_| info.LastPresentTime != 0) else {
                return Ok(Grab::Still);
            };
            let texture: ID3D11Texture2D = resource.cast()?;
            let mut desc = D3D11_TEXTURE2D_DESC::default();
            texture.GetDesc(&mut desc);
            if (desc.Width, desc.Height) != (u32::from(self.size.0), u32::from(self.size.1)) {
                bail!("a {}x{} surface of a {}x{} desktop", desc.Width, desc.Height, self.size.0, self.size.1);
            }
            if self.staging.is_none() {
                let staged = D3D11_TEXTURE2D_DESC {
                    Width: desc.Width,
                    Height: desc.Height,
                    MipLevels: 1,
                    ArraySize: 1,
                    Format: desc.Format,
                    SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                    Usage: D3D11_USAGE_STAGING,
                    BindFlags: 0,
                    CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
                    MiscFlags: 0,
                };
                let mut texture = None;
                self.device.CreateTexture2D(&staged, None, Some(&mut texture)).context("CreateTexture2D")?;
                self.staging = texture;
            }
            let staging = self.staging.as_ref().unwrap();
            self.context.CopyResource(staging, &texture);
            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            self.context.Map(staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped)).context("Map")?;
            let pitch = mapped.RowPitch as usize;
            let (w, h) = (usize::from(self.size.0), usize::from(self.size.1));
            let pixels = std::slice::from_raw_parts(mapped.pData as *const u8, (h - 1) * pitch + w * 4);
            let read = self.picture.read_bgrx(pixels, pitch);
            self.context.Unmap(staging, 0);
            read?;
            Ok(Grab::Picture)
        }
    }
}

// ------------------------------------------------------------------ the patch window

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

fn make_window() -> Result<HWND> {
    unsafe {
        let instance = GetModuleHandleW(None)?;
        let class = WNDCLASSW {
            lpfnWndProc: Some(wndproc),
            hInstance: instance.into(),
            lpszClassName: w!("RemotexDvcVideoPatch"),
            ..Default::default()
        };
        RegisterClassW(&class);
        let hwnd = CreateWindowExW(
            WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
            w!("RemotexDvcVideoPatch"),
            w!("remotex dvc video patch"),
            WS_POPUP | WS_VISIBLE,
            WIN_X,
            WIN_Y,
            WIN_SIDE,
            WIN_SIDE,
            None,
            None,
            Some(instance.into()),
            None,
        )?;
        Ok(hwnd)
    }
}

/// Paint the patch and wait for the composed screen to show it: a capture taken
/// before the compositor has the colour would be of the desktop before it, and no
/// fault of the duplication's.
fn paint(hwnd: HWND, index: u32) {
    unsafe {
        let (r, g, b) = PALETTE[index as usize % PALETTE.len()];
        let colour = COLORREF(u32::from(r) | u32::from(g) << 8 | u32::from(b) << 16);
        let dc = GetDC(Some(hwnd));
        let brush = CreateSolidBrush(colour);
        let rect = RECT { left: 0, top: 0, right: WIN_SIDE, bottom: WIN_SIDE };
        FillRect(dc, &rect, brush);
        let _ = DeleteObject(brush.into());
        ReleaseDC(Some(hwnd), dc);
        let _ = GdiFlush();
        let started = Instant::now();
        loop {
            let _ = DwmFlush();
            let screen = GetDC(None);
            let shown = GetPixel(screen, WIN_X + WIN_SIDE / 2, WIN_Y + WIN_SIDE / 2);
            ReleaseDC(None, screen);
            if shown == colour || started.elapsed() >= COMPOSED {
                break;
            }
        }
    }
}

fn pump() {
    unsafe {
        let mut msg = MSG::default();
        while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}

// ------------------------------------------------------------------ the stream

/// A frame the gateway has not echoed yet.
struct InFlight {
    seq: u32,
    sent: Instant,
    /// Whether its delivery is a verdict about the link: a delta frame at the walk's
    /// quality, not a keyframe and not a settle's frame.
    verdict: bool,
}

struct Stream {
    plan: Plan,
    walk: QualityWalk,
    in_flight: Option<InFlight>,
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
            captured: None,
            coarse_since: None,
            keyframe_owed: true,
            gap_said: false,
        }
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

struct Args {
    patch: bool,
    big: Option<usize>,
}

fn args() -> Args {
    let mut args = Args { patch: false, big: None };
    let mut given = std::env::args().skip(1);
    while let Some(arg) = given.next() {
        match arg.as_str() {
            "--patch" => args.patch = true,
            "--big" => args.big = given.next().and_then(|bytes| bytes.parse().ok()),
            _ => {}
        }
    }
    args
}

fn main() {
    let log_path = std::env::current_exe().unwrap().with_file_name("agent.log");
    let mut log = Log(File::create(&log_path).expect("log file"));
    if let Err(e) = run(&mut log, args()) {
        log.say(format!("fatal: {e:#}"));
    }
    log.say("exit");
}

fn run(log: &mut Log, args: Args) -> Result<()> {
    unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        let mut session = 0u32;
        let _ = ProcessIdToSessionId(std::process::id(), &mut session);
        log.say(format!("agent start, session {session}, patch {}, big {:?}", args.patch, args.big));
    }
    let patch = if args.patch { Some(make_window()?) } else { None };
    let mut big = args.big;
    let mut channel: Option<Channel> = None;
    let mut stream: Option<Stream> = None;
    let mut capture: Option<Capture> = None;
    let mut pointer = PointerState::default();
    let mut seq = 0u32;
    let mut last_open_error = String::new();
    let mut last_capture_error = String::new();
    let mut stats = (0u32, 0u32, 0usize); // frames, keyframes, bytes
    // What a second's frames spent: capturing, encoding, writing, and in flight.
    let mut spent = [Duration::ZERO; 4];
    let mut stats_at = Instant::now();
    let mut out = Vec::new();

    loop {
        pump();
        if stats_at.elapsed() >= Duration::from_secs(1) {
            if stats.0 > 0 {
                let each = |spent: Duration| spent.as_millis() / u128::from(stats.0);
                log.say(format!(
                    "1s: {} frames, {} keyframes, {} KiB; each {} ms capturing, {} encoding, {} writing, {} in flight",
                    stats.0,
                    stats.1,
                    stats.2 / 1024,
                    each(spent[0]),
                    each(spent[1]),
                    each(spent[2]),
                    each(spent[3])
                ));
            }
            stats = (0, 0, 0);
            spent = [Duration::ZERO; 4];
            stats_at = Instant::now();
        }

        let Some(open) = channel.as_ref() else {
            match Channel::open() {
                Ok(opened) => {
                    log.say("channel open");
                    channel = Some(opened);
                    stream = None;
                    last_open_error.clear();
                }
                Err(e) => {
                    let text = format!("{e:#}");
                    if text != last_open_error {
                        log.say(format!("channel not open: {text}"));
                        last_open_error = text;
                    }
                    std::thread::sleep(Duration::from_secs(1));
                }
            }
            continue;
        };

        // What the gateway said, waiting for it while there is nothing else to do:
        // no plan yet, or a frame in flight.
        let idle = stream.as_ref().is_none_or(|stream| stream.in_flight.is_some());
        let mut said = if idle {
            match open.incoming.recv_timeout(Duration::from_millis(20)) {
                Ok(said) => Some(said),
                Err(RecvTimeoutError::Timeout) => None,
                Err(RecvTimeoutError::Disconnected) => Some(Incoming::Closed("the reader stopped".into())),
            }
        } else {
            None
        };
        let mut closed = None;
        loop {
            let next = match said.take() {
                Some(said) => said,
                None => match open.incoming.try_recv() {
                    Ok(said) => said,
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => Incoming::Closed("the reader stopped".into()),
                },
            };
            match next {
                Incoming::Plan(plan) => {
                    log.say(format!("the plan: {} at quality {}, {}", plan.chroma.name(), plan.quality, if plan.adaptive { "walked" } else { "held" }));
                    stream = Some(Stream::new(plan));
                    // The encoder is the plan's.
                    capture = None;
                    pointer.dirty = true;
                }
                Incoming::Foreign(version) => closed = Some(format!("the gateway speaks version {version}, this agent {VERSION}")),
                Incoming::Echo(echoed) => {
                    if let Some(stream) = stream.as_mut()
                        && let Some(flight) = stream.in_flight.take_if(|flight| flight.seq == echoed)
                    {
                        let now = Instant::now();
                        spent[3] += now.saturating_duration_since(flight.sent);
                        let moved = stream.walk.fenced(now.saturating_duration_since(flight.sent), flight.verdict, now);
                        follow(moved, &mut stream.walk, &mut capture, log);
                        if stream.coarse_since.is_some() {
                            stream.coarse_since = Some(now);
                        }
                    }
                }
                Incoming::Keyframe => {
                    if let Some(stream) = stream.as_mut() {
                        stream.keyframe_owed = true;
                    }
                }
                Incoming::Closed(why) => closed = Some(why),
            }
            if closed.is_some() {
                break;
            }
        }
        if let Some(why) = closed {
            log.say(format!("channel closed: {why}"));
            channel = None;
            stream = None;
            capture = None;
            std::thread::sleep(Duration::from_secs(1));
            continue;
        }
        let Some(stream) = stream.as_mut() else {
            continue;
        };
        if let Some(flight) = &stream.in_flight {
            if flight.sent.elapsed() < ECHO_LOST {
                continue;
            }
            log.say(format!("frame {} was never echoed", flight.seq));
            stream.in_flight = None;
        }
        // No more often than the interval, which a link slowed past the floor has
        // had doubled.
        if let Some(due) = stream.captured.map(|captured| captured + stream.walk.interval())
            && let Some(wait) = due.checked_duration_since(Instant::now())
        {
            std::thread::sleep(wait.min(Duration::from_millis(20)));
            continue;
        }

        let write = |message: &[u8], log: &mut Log| match open.send(message) {
            Ok(blocked) => Some(blocked),
            Err(e) => {
                log.say(format!("channel write failed: {e:#}"));
                None
            }
        };

        if let Some(bytes) = big.take() {
            // A keyframe's opening byte and nothing a decoder would take: the
            // channel's business is the bytes.
            let size = capture.as_ref().map_or((1280, 800), |capture| capture.size);
            out.clear();
            out.push(FRAME);
            out.extend_from_slice(&seq.to_le_bytes());
            out.extend_from_slice(&size.0.to_le_bytes());
            out.extend_from_slice(&size.1.to_le_bytes());
            let profile = if stream.plan.chroma == Chroma::Full { 0xA0 } else { 0x80 };
            out.extend((0..bytes).map(|i| if i == 0 { profile } else { (i % 251) as u8 }));
            log.say(format!("one message of {} bytes", out.len()));
            let Some(_) = write(&out, log) else {
                channel = None;
                continue;
            };
            stream.in_flight = Some(InFlight { seq, sent: Instant::now(), verdict: false });
            stream.keyframe_owed = true;
            seq = seq.wrapping_add(1);
            continue;
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
                        if write(&[GAP], log).is_none() {
                            channel = None;
                            continue;
                        }
                    }
                    std::thread::sleep(RETRY);
                    continue;
                }
            }
        }
        let taking = capture.as_mut().unwrap();

        if let Some(hwnd) = patch {
            paint(hwnd, seq);
        }
        let capturing = Instant::now();
        let changed = match taking.grab(&mut pointer) {
            Ok(Grab::Picture) => true,
            Ok(Grab::Still) => false,
            Ok(Grab::Lost(e)) => {
                log.say(format!("duplication lost ({e}); duplicating again"));
                capture = None;
                continue;
            }
            Err(e) => {
                log.say(format!("capture failed ({e:#}); duplicating again"));
                capture = None;
                continue;
            }
        };
        spent[0] += capturing.elapsed();
        if let Some(message) = pointer.message()
            && write(&message, log).is_none()
        {
            channel = None;
            continue;
        }

        // A desktop that went quiet below the plan's quality is sharpened there once,
        // with the unchanged picture as one more frame.
        let now = Instant::now();
        let settling = !changed && !stream.keyframe_owed && stream.coarse_since.is_some_and(|since| now >= since + SETTLE_IDLE);
        if !changed && !stream.keyframe_owed && !settling {
            continue;
        }
        if settling {
            stream.walk.settle(now);
            let _ = taking.encoder.set_quality(stream.plan.quality);
        }
        out.clear();
        out.push(FRAME);
        out.extend_from_slice(&seq.to_le_bytes());
        out.extend_from_slice(&taking.size.0.to_le_bytes());
        out.extend_from_slice(&taking.size.1.to_le_bytes());
        let quality = taking.encoder.quality();
        let encoding = Instant::now();
        let encoded = taking.encoder.encode(&taking.picture, stream.keyframe_owed, &mut out);
        spent[1] += encoding.elapsed();
        if settling {
            let _ = taking.encoder.set_quality(stream.walk.quality());
        }
        let Some(keyframe) = encoded.context("encoding a frame")? else {
            continue;
        };
        let sent = Instant::now();
        let Some(blocked) = write(&out, log) else {
            channel = None;
            continue;
        };
        spent[2] += blocked;
        if keyframe {
            stream.keyframe_owed = false;
            stream.walk.keyframe(sent);
        }
        let verdict = !keyframe && !settling;
        if verdict {
            let moved = stream.walk.written(blocked, true, Instant::now());
            follow(moved, &mut stream.walk, &mut capture, log);
        }
        stream.coarse_since = stream.walk.coarse(quality).then_some(sent);
        stream.captured = Some(capturing);
        stream.in_flight = Some(InFlight { seq, sent, verdict });
        stats.0 += 1;
        stats.1 += u32::from(keyframe);
        stats.2 += out.len();
        seq = seq.wrapping_add(1);
    }
}
