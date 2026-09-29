//! What tests/rdp_dvc_video_probe.rs asks of a session's agent, by switches the
//! command line hides: a patch whose colour follows the frame's number, so the probe can
//! tell a fresh frame from a stale surface handed back again by reading the decoded
//! patch, and one large message ahead of the stream.

use std::time::{Duration, Instant};

use anyhow::Result;
use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Dwm::DwmFlush;
use windows::Win32::Graphics::Gdi::{CreateSolidBrush, DeleteObject, FillRect, GdiFlush, GetDC, GetPixel, ReleaseDC};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, MSG, PM_REMOVE, PeekMessageW, RegisterClassW, TranslateMessage,
    WNDCLASSW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP, WS_VISIBLE,
};
use windows::core::w;

pub struct Switches {
    pub patch: bool,
    pub big: Option<usize>,
}

const WIN_X: i32 = 100;
const WIN_Y: i32 = 100;
const WIN_SIDE: i32 = 160;
/// How long the composed screen is given to show a colour just painted.
const COMPOSED: Duration = Duration::from_millis(200);

/// What the patch is painted, frame by frame: `PALETTE[seq % 8]`.
const PALETTE: [(u8, u8, u8); 8] =
    [(255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 0), (0, 255, 255), (255, 0, 255), (255, 255, 255), (0, 0, 0)];

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

/// The patch, a small window above everything else.
pub struct Patch(HWND);

impl Patch {
    pub fn new() -> Result<Self> {
        unsafe {
            let instance = GetModuleHandleW(None)?;
            let class = WNDCLASSW {
                lpfnWndProc: Some(wndproc),
                hInstance: instance.into(),
                lpszClassName: w!("RemotexAgentPatch"),
                ..Default::default()
            };
            RegisterClassW(&class);
            let hwnd = CreateWindowExW(
                WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
                w!("RemotexAgentPatch"),
                w!("remotex agent patch"),
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
            Ok(Self(hwnd))
        }
    }

    /// Paint the patch and wait for the composed screen to show it: a capture taken
    /// before the compositor has the colour would be of the desktop before it, and no
    /// fault of the duplication's.
    pub fn paint(&self, seq: u32) {
        unsafe {
            let (r, g, b) = PALETTE[seq as usize % PALETTE.len()];
            let colour = COLORREF(u32::from(r) | u32::from(g) << 8 | u32::from(b) << 16);
            let dc = GetDC(Some(self.0));
            let brush = CreateSolidBrush(colour);
            let rect = RECT { left: 0, top: 0, right: WIN_SIDE, bottom: WIN_SIDE };
            FillRect(dc, &rect, brush);
            let _ = DeleteObject(brush.into());
            ReleaseDC(Some(self.0), dc);
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

    /// The window's messages, which nobody else takes.
    pub fn pump(&self) {
        unsafe {
            let mut msg = MSG::default();
            while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }
}
