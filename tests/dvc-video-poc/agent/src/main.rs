//! POC: an in-session agent that captures the RDP session's desktop, codes it as
//! VP9 and writes it to the `remotex.video` dynamic virtual channel of the RDP
//! connection the session is attached to.
//!
//! It also paints a small window whose colour changes every tick, and checks the
//! captured pixels against the colour it just painted, so "capture still runs"
//! means fresh pixels, not a stale surface handed back again.
//!
//! Message (one logical message, split over DVC writes of at most CHUNK bytes,
//! each write prefixed with a flags byte: 1 = first, 2 = last):
//!   0  "RXV1"
//!   4  u32 seq
//!   8  u32 painted colour index
//!   12 u8  capture: 0 none (timeout / unavailable), 1 DXGI, 2 GDI
//!   13 u8  flags: 1 keyframe, 2 capture fresh, 4 GetPixel fresh, 8 DwmFlush failed,
//!             16 input desktop is not "Default" (or cannot be opened)
//!   14 u16 reserved
//!   16 u16 width, 18 u16 height (of the VP9 picture, 0 when none)
//!   20 u32 patch x, 24 u32 patch y (centre of the painted patch, picture coords)
//!   28 u32 DXGI timeouts since the last message
//!   32 VP9 frame (may be empty)

#![windows_subsystem = "windows"]

use std::fs::File;
use std::io::Write as _;
use std::time::{Duration, Instant};

use anyhow::{Context as _, Result, bail};
use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Direct3D::*;
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dwm::DwmFlush;
use windows::Win32::Graphics::Dxgi::Common::*;
use windows::Win32::Graphics::Dxgi::*;
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::Storage::FileSystem::WriteFile;
use windows::Win32::System::IO::{GetOverlappedResult, OVERLAPPED};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::RemoteDesktop::*;
use windows::Win32::System::StationsAndDesktops::*;
use windows::Win32::System::Threading::{CreateEventW, GetCurrentProcess};
use windows::Win32::UI::HiDpi::*;
use windows::Win32::UI::WindowsAndMessaging::*;
use windows::core::{Interface as _, PCSTR, w};

const CHANNEL: &[u8] = b"remotex.video\0";
const CHUNK: usize = 32_000;
const TICK: Duration = Duration::from_millis(100);
const RUN_FOR: Duration = Duration::from_secs(300);
const KEY_EVERY: u32 = 30;

const WIN_X: i32 = 100;
const WIN_Y: i32 = 100;
const WIN_SIDE: i32 = 160;
const PATCH_X: i32 = WIN_X + WIN_SIDE / 2;
const PATCH_Y: i32 = WIN_Y + WIN_SIDE / 2;

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

struct Log(File);

impl Log {
    fn say(&mut self, what: impl AsRef<str>) {
        let line = format!("{:?} {}\n", std::time::SystemTime::now(), what.as_ref());
        let _ = self.0.write_all(line.as_bytes());
        let _ = self.0.flush();
    }
}

// ------------------------------------------------------------------ the channel

struct Channel {
    wts: HANDLE,
    file: HANDLE,
    event: HANDLE,
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
            Ok(Self { wts, file, event })
        }
    }

    fn write_one(&self, bytes: &[u8]) -> Result<()> {
        unsafe {
            let mut ov = OVERLAPPED { hEvent: self.event, ..Default::default() };
            let mut written = 0u32;
            if let Err(e) = WriteFile(self.file, Some(bytes), None, Some(&mut ov)) {
                if e.code() != ERROR_IO_PENDING.to_hresult() {
                    return Err(e).context("WriteFile");
                }
            }
            GetOverlappedResult(self.file, &ov, &mut written, true).context("GetOverlappedResult")?;
            if written as usize != bytes.len() {
                bail!("short write: {written} of {}", bytes.len());
            }
            Ok(())
        }
    }

    fn send(&self, message: &[u8]) -> Result<()> {
        let pieces: Vec<&[u8]> = message.chunks(CHUNK).collect();
        let last = pieces.len() - 1;
        let mut buf = Vec::with_capacity(CHUNK + 1);
        for (i, piece) in pieces.iter().enumerate() {
            buf.clear();
            buf.push(u8::from(i == 0) | if i == last { 2 } else { 0 });
            buf.extend_from_slice(piece);
            self.write_one(&buf)?;
        }
        Ok(())
    }
}

impl Drop for Channel {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.file);
            let _ = CloseHandle(self.event);
            let _ = WTSVirtualChannelClose(self.wts);
        }
    }
}

// ------------------------------------------------------------------ capture

struct Image {
    width: u32,
    height: u32,
    /// Where the desktop's (0,0) is in this image's coordinates, subtracted from.
    origin: (i32, i32),
    bgra: Vec<u8>,
}

impl Image {
    fn at(&self, x: i32, y: i32) -> Option<(u8, u8, u8)> {
        let (x, y) = (x - self.origin.0, y - self.origin.1);
        if x < 0 || y < 0 || x as u32 >= self.width || y as u32 >= self.height {
            return None;
        }
        let i = (y as usize * self.width as usize + x as usize) * 4;
        Some((self.bgra[i + 2], self.bgra[i + 1], self.bgra[i]))
    }
}

struct Dxgi {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    dup: IDXGIOutputDuplication,
    origin: (i32, i32),
    staging: Option<(ID3D11Texture2D, u32, u32)>,
}

enum Grab {
    Frame(Image),
    Timeout,
    Lost(windows::core::Error),
}

impl Dxgi {
    fn new(log: &mut Log) -> Result<Self> {
        unsafe {
            let factory: IDXGIFactory1 = CreateDXGIFactory1().context("CreateDXGIFactory1")?;
            let mut a = 0;
            while let Ok(adapter) = factory.EnumAdapters1(a) {
                let desc = adapter.GetDesc1()?;
                let name = String::from_utf16_lossy(&desc.Description).trim_end_matches('\0').to_owned();
                let mut o = 0;
                while let Ok(output) = adapter.EnumOutputs(o) {
                    let od = output.GetDesc()?;
                    let dn = String::from_utf16_lossy(&od.DeviceName).trim_end_matches('\0').to_owned();
                    let r = od.DesktopCoordinates;
                    log.say(format!(
                        "dxgi: adapter {a} {name:?} output {o} {dn} attached {} rect {},{} {}x{}",
                        od.AttachedToDesktop.as_bool(),
                        r.left,
                        r.top,
                        r.right - r.left,
                        r.bottom - r.top
                    ));
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
                        let dd = dup.GetDesc();
                        log.say(format!(
                            "dxgi: duplicating {dn} {}x{} format {:?} in system memory {}",
                            dd.ModeDesc.Width,
                            dd.ModeDesc.Height,
                            dd.ModeDesc.Format,
                            dd.DesktopImageInSystemMemory.as_bool()
                        ));
                        return Ok(Self { device, context: context.unwrap(), dup, origin: (r.left, r.top), staging: None });
                    }
                    o += 1;
                }
                a += 1;
            }
            bail!("no output at the desktop's origin")
        }
    }

    fn grab(&mut self, timeout_ms: u32) -> Result<Grab> {
        unsafe {
            let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
            let mut resource = None;
            match self.dup.AcquireNextFrame(timeout_ms, &mut info, &mut resource) {
                Ok(()) => {}
                Err(e) if e.code() == DXGI_ERROR_WAIT_TIMEOUT => return Ok(Grab::Timeout),
                Err(e) => return Ok(Grab::Lost(e)),
            }
            let result = self.copy(resource.unwrap());
            let _ = self.dup.ReleaseFrame();
            result.map(Grab::Frame)
        }
    }

    unsafe fn copy(&mut self, resource: IDXGIResource) -> Result<Image> {
        unsafe {
            let texture: ID3D11Texture2D = resource.cast()?;
            let mut desc = D3D11_TEXTURE2D_DESC::default();
            texture.GetDesc(&mut desc);
            let (w, h) = (desc.Width, desc.Height);
            if self.staging.as_ref().is_none_or(|s| (s.1, s.2) != (w, h)) {
                let sd = D3D11_TEXTURE2D_DESC {
                    Width: w,
                    Height: h,
                    MipLevels: 1,
                    ArraySize: 1,
                    Format: desc.Format,
                    SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                    Usage: D3D11_USAGE_STAGING,
                    BindFlags: 0,
                    CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
                    MiscFlags: 0,
                };
                let mut t = None;
                self.device.CreateTexture2D(&sd, None, Some(&mut t)).context("CreateTexture2D")?;
                self.staging = Some((t.unwrap(), w, h));
            }
            let staging = &self.staging.as_ref().unwrap().0;
            self.context.CopyResource(staging, &texture);
            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            self.context.Map(staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped)).context("Map")?;
            let mut bgra = vec![0u8; (w * h * 4) as usize];
            for y in 0..h as usize {
                let src = std::slice::from_raw_parts((mapped.pData as *const u8).add(y * mapped.RowPitch as usize), w as usize * 4);
                bgra[y * w as usize * 4..(y + 1) * w as usize * 4].copy_from_slice(src);
            }
            self.context.Unmap(staging, 0);
            Ok(Image { width: w, height: h, origin: self.origin, bgra })
        }
    }
}

fn gdi_capture() -> Result<Image> {
    unsafe {
        let x = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let y = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let w = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        let h = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        let screen = GetDC(None);
        let mem = CreateCompatibleDC(Some(screen));
        let bitmap = CreateCompatibleBitmap(screen, w, h);
        let old = SelectObject(mem, bitmap.into());
        let blt = BitBlt(mem, 0, 0, w, h, Some(screen), x, y, SRCCOPY | CAPTUREBLT);
        let mut info = BITMAPINFO::default();
        info.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        info.bmiHeader.biWidth = w;
        info.bmiHeader.biHeight = -h;
        info.bmiHeader.biPlanes = 1;
        info.bmiHeader.biBitCount = 32;
        info.bmiHeader.biCompression = BI_RGB.0;
        let mut bgra = vec![0u8; (w * h * 4) as usize];
        let lines = GetDIBits(mem, bitmap, 0, h as u32, Some(bgra.as_mut_ptr().cast()), &mut info, DIB_RGB_COLORS);
        SelectObject(mem, old);
        let _ = DeleteObject(bitmap.into());
        let _ = DeleteDC(mem);
        ReleaseDC(None, screen);
        blt.context("BitBlt")?;
        if lines != h {
            bail!("GetDIBits read {lines} of {h} lines");
        }
        Ok(Image { width: w as u32, height: h as u32, origin: (x, y), bgra })
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

fn paint(hwnd: HWND, index: u32) {
    unsafe {
        let (r, g, b) = PALETTE[index as usize % PALETTE.len()];
        let dc = GetDC(Some(hwnd));
        let brush = CreateSolidBrush(COLORREF(u32::from(r) | u32::from(g) << 8 | u32::from(b) << 16));
        let rect = RECT { left: 0, top: 0, right: WIN_SIDE, bottom: WIN_SIDE };
        FillRect(dc, &rect, brush);
        let _ = DeleteObject(brush.into());
        ReleaseDC(Some(hwnd), dc);
        let _ = GdiFlush();
    }
}

fn input_desktop() -> String {
    unsafe {
        let desk = match OpenInputDesktop(DESKTOP_CONTROL_FLAGS(0), false, DESKTOP_READOBJECTS) {
            Ok(desk) => desk,
            Err(e) => return format!("<cannot open: {e}>"),
        };
        let mut name = [0u16; 128];
        let mut needed = 0u32;
        let got = GetUserObjectInformationW(HANDLE(desk.0), UOI_NAME, Some(name.as_mut_ptr().cast()), 256, Some(&mut needed));
        let _ = CloseDesktop(desk);
        match got {
            Ok(()) => String::from_utf16_lossy(&name).trim_end_matches('\0').to_owned(),
            Err(e) => format!("<no name: {e}>"),
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

fn gdi_pixel() -> (u8, u8, u8) {
    unsafe {
        let screen = GetDC(None);
        let c = GetPixel(screen, PATCH_X, PATCH_Y).0;
        ReleaseDC(None, screen);
        ((c & 0xFF) as u8, (c >> 8 & 0xFF) as u8, (c >> 16 & 0xFF) as u8)
    }
}

// ------------------------------------------------------------------ the encoder

struct Vp9 {
    size: (u16, u16),
    picture: desktop_vp9::Picture,
    encoder: desktop_vp9::Encoder,
    frames: u32,
}

impl Vp9 {
    fn new(w: u16, h: u16) -> Result<Self> {
        let chroma = desktop_vp9::Chroma::Subsampled;
        Ok(Self {
            size: (w, h),
            picture: desktop_vp9::Picture::new(w, h, chroma)?,
            encoder: desktop_vp9::Encoder::new(w, h, chroma, 60, 2)?,
            frames: 0,
        })
    }
}

// ------------------------------------------------------------------ main

fn main() {
    let log_path = std::env::current_exe().unwrap().with_file_name("agent.log");
    let mut log = Log(File::create(&log_path).expect("log file"));
    if let Err(e) = run(&mut log) {
        log.say(format!("fatal: {e:#}"));
    }
    log.say("exit");
}

fn run(log: &mut Log) -> Result<()> {
    unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        let mut session = 0u32;
        let _ = windows::Win32::System::RemoteDesktop::ProcessIdToSessionId(std::process::id(), &mut session);
        log.say(format!("agent start, session {session}"));
    }
    let hwnd = make_window()?;
    let started = Instant::now();
    let mut channel: Option<Channel> = None;
    let mut dxgi: Option<Dxgi> = None;
    let mut dxgi_retry_at = Instant::now();
    let mut last_capture_error = String::new();
    let mut last_desktop = String::new();
    let mut vp9: Option<Vp9> = None;
    let mut seq = 0u32;
    let mut index = 0u32;
    let mut timeouts = 0u32;
    let mut last_open_error = String::new();
    let mut stats = (0u32, 0u32, 0u32, 0u32, 0u32); // frames, fresh, gdi fresh, timeouts, sent bytes KiB
    let mut stats_at = Instant::now();
    let mut out = Vec::new();

    while started.elapsed() < RUN_FOR {
        let tick = Instant::now();
        pump();

        if channel.is_none() {
            match Channel::open() {
                Ok(c) => {
                    log.say("channel open");
                    channel = Some(c);
                    last_open_error.clear();
                    if let Some(v) = vp9.as_mut() {
                        v.frames = 0;
                    }
                }
                Err(e) => {
                    let text = format!("{e:#}");
                    if text != last_open_error {
                        log.say(format!("channel not open: {text}"));
                        last_open_error = text;
                    }
                    std::thread::sleep(Duration::from_secs(1));
                    continue;
                }
            }
        }

        index = index.wrapping_add(1);
        paint(hwnd, index);
        let flushed = unsafe { DwmFlush() };
        let gdi_fresh = {
            let (r, g, b) = gdi_pixel();
            nearest(r, g, b) == index as usize % PALETTE.len()
        };

        let desktop = input_desktop();
        if desktop != last_desktop {
            log.say(format!("input desktop: {desktop}"));
            last_desktop = desktop.clone();
        }

        if dxgi.is_none() && Instant::now() >= dxgi_retry_at {
            match Dxgi::new(log) {
                Ok(d) => {
                    log.say("dxgi duplicating");
                    dxgi = Some(d);
                }
                Err(e) => {
                    let text = format!("dxgi unavailable: {e:#}");
                    if text != last_capture_error {
                        log.say(&text);
                        last_capture_error = text;
                    }
                    dxgi_retry_at = Instant::now() + Duration::from_secs(1);
                }
            }
        }

        let mut grabbed = match dxgi.as_mut() {
            Some(d) => match d.grab(150) {
                Ok(Grab::Frame(image)) => (1u8, Some(image)),
                Ok(Grab::Timeout) => {
                    timeouts += 1;
                    stats.3 += 1;
                    (0, None)
                }
                Ok(Grab::Lost(e)) => {
                    log.say(format!("dxgi lost ({e}); duplicating again"));
                    dxgi = None;
                    (0, None)
                }
                Err(e) => {
                    log.say(format!("dxgi copy failed ({e:#}); duplicating again"));
                    dxgi = None;
                    (0, None)
                }
            },
            None => (0, None),
        };
        if dxgi.is_none() && grabbed.1.is_none() {
            match gdi_capture() {
                Ok(image) => grabbed = (2, Some(image)),
                Err(e) => {
                    let text = format!("gdi capture failed: {e:#}");
                    if text != last_capture_error {
                        log.say(&text);
                        last_capture_error = text;
                    }
                }
            }
        }
        let (capture, image) = grabbed;

        let mut flags = 0u8;
        if gdi_fresh {
            flags |= 4;
        }
        if flushed.is_err() {
            flags |= 8;
        }
        if desktop != "Default" {
            flags |= 16;
        }
        out.clear();
        out.extend_from_slice(b"RXV1");
        out.extend_from_slice(&seq.to_le_bytes());
        out.extend_from_slice(&index.to_le_bytes());
        let (mut width, mut height) = (0u16, 0u16);
        let mut frame = Vec::new();
        let mut patch = (0u32, 0u32);
        if let Some(image) = image {
            if image.at(PATCH_X, PATCH_Y).is_some_and(|(r, g, b)| nearest(r, g, b) == index as usize % PALETTE.len()) {
                flags |= 2;
            }
            let w = (image.width & !1) as u16;
            let h = (image.height & !1) as u16;
            if vp9.as_ref().is_none_or(|v| v.size != (w, h)) {
                log.say(format!("encoder {w}x{h}"));
                vp9 = Some(Vp9::new(w, h)?);
            }
            let v = vp9.as_mut().unwrap();
            v.picture.read_bgrx(&image.bgra, image.width as usize * 4)?;
            let key = v.frames % KEY_EVERY == 0;
            if let Some(k) = v.encoder.encode(&v.picture, key, &mut frame)? {
                if k {
                    flags |= 1;
                }
                v.frames += 1;
            }
            width = w;
            height = h;
            patch = ((PATCH_X - image.origin.0) as u32, (PATCH_Y - image.origin.1) as u32);
        }
        out.push(capture);
        out.push(flags);
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&width.to_le_bytes());
        out.extend_from_slice(&height.to_le_bytes());
        out.extend_from_slice(&patch.0.to_le_bytes());
        out.extend_from_slice(&patch.1.to_le_bytes());
        out.extend_from_slice(&timeouts.to_le_bytes());
        out.extend_from_slice(&frame);

        if capture != 0 {
            stats.0 += 1;
            if flags & 2 != 0 {
                stats.1 += 1;
            }
        }
        if gdi_fresh {
            stats.2 += 1;
        }
        stats.4 += (out.len() / 1024) as u32;

        if let Err(e) = channel.as_ref().unwrap().send(&out) {
            log.say(format!("channel write failed, reopening: {e:#}"));
            channel = None;
            if let Some(v) = vp9.as_mut() {
                v.frames = 0;
            }
        } else {
            seq += 1;
            timeouts = 0;
        }

        if stats_at.elapsed() >= Duration::from_secs(1) {
            log.say(format!(
                "1s: captured {} fresh {} gdi-fresh {} dxgi-timeouts {} sent {} KiB dwmflush-ok {}",
                stats.0,
                stats.1,
                stats.2,
                stats.3,
                stats.4,
                flushed.is_ok()
            ));
            stats = (0, 0, 0, 0, 0);
            stats_at = Instant::now();
        }
        if let Some(rest) = TICK.checked_sub(tick.elapsed()) {
            std::thread::sleep(rest);
        }
    }
    Ok(())
}
