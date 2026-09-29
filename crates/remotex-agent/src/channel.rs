//! The `remotex.video` dynamic virtual channel: opened on the RDP connection this
//! session is attached to, one message per write, and the gateway's messages read off it
//! on a thread of its own.
//!
//! The protocol is the gateway's (`src/rdp_client/proto/video.rs` holds its whole
//! description), and its messages are the `remotex-video-channel` crate's, which the
//! gateway builds from too: its `VERSION` is what keeps an agent and a gateway that
//! disagree from streaming past each other.

use std::sync::mpsc::{Receiver, Sender};
use std::time::{Duration, Instant};

use anyhow::{Context as _, Result, anyhow, bail};
use remotex_video_channel::{CHANNEL_NAME, Said};
use windows::Win32::Foundation::{CloseHandle, DUPLICATE_SAME_ACCESS, DuplicateHandle, ERROR_IO_PENDING, HANDLE};
use windows::Win32::Storage::FileSystem::{ReadFile, WriteFile};
use windows::Win32::System::IO::{CancelIoEx, GetOverlappedResult, OVERLAPPED};
use windows::Win32::System::RemoteDesktop::{
    WTS_CHANNEL_OPTION_DYNAMIC, WTS_CHANNEL_OPTION_DYNAMIC_NO_COMPRESS, WTS_CHANNEL_OPTION_DYNAMIC_PRI_HIGH,
    WTS_CURRENT_SESSION, WTSFreeMemory, WTSVirtualChannelClose, WTSVirtualChannelOpenEx, WTSVirtualChannelQuery,
    WTSVirtualFileHandle,
};
use windows::Win32::System::Threading::{CreateEventW, GetCurrentProcess};
use windows::core::PCSTR;

pub enum Incoming {
    /// What the gateway said, and when it was read: the loop that takes it may be
    /// coding a frame.
    Said(Said, Instant),
    /// The channel cannot be read any more, and why.
    Closed(anyhow::Error),
}

/// A handle another thread may use: the channel's file, read on one thread and
/// written on another, each with an `OVERLAPPED` of its own.
#[derive(Clone, Copy)]
struct Shared(HANDLE);
// SAFETY: a file handle is a number the kernel resolves, and overlapped reads and
// writes on one are independent of each other.
unsafe impl Send for Shared {}

pub struct Channel {
    wts: HANDLE,
    file: HANDLE,
    event: HANDLE,
    pub incoming: Receiver<Incoming>,
    reader: Option<std::thread::JoinHandle<()>>,
}

impl Channel {
    /// The channel, on this session's RDP connection. Refused where the session is
    /// not attached over RDP, and where the client there takes no such channel — a
    /// gateway whose target does not set `agent_passthrough`.
    pub fn open() -> Result<Self> {
        unsafe {
            let flags = WTS_CHANNEL_OPTION_DYNAMIC | WTS_CHANNEL_OPTION_DYNAMIC_PRI_HIGH | WTS_CHANNEL_OPTION_DYNAMIC_NO_COMPRESS;
            let name = std::ffi::CString::new(CHANNEL_NAME).expect("a channel name without a NUL");
            let wts = WTSVirtualChannelOpenEx(WTS_CURRENT_SESSION, PCSTR(name.as_ptr().cast()), flags).context("WTSVirtualChannelOpenEx")?;
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
            let event = match CreateEventW(None, true, false, None) {
                Ok(event) => event,
                Err(e) => {
                    let _ = CloseHandle(file);
                    let _ = WTSVirtualChannelClose(wts);
                    return Err(e).context("CreateEventW");
                }
            };
            let (tx, incoming) = std::sync::mpsc::channel();
            let shared = Shared(file);
            let reader = std::thread::Builder::new().name("channel".into()).spawn(move || read(shared, &tx));
            let reader = match reader {
                Ok(reader) => reader,
                Err(e) => {
                    let _ = CloseHandle(event);
                    let _ = CloseHandle(file);
                    let _ = WTSVirtualChannelClose(wts);
                    return Err(e).context("the channel's reader");
                }
            };
            Ok(Self { wts, file, event, incoming, reader: Some(reader) })
        }
    }

    /// One message, one write: the channel cuts it into its own PDUs and the gateway
    /// joins them. Returns how long the write took, which is the channel having no
    /// room.
    pub fn send(&self, message: &[u8]) -> Result<Duration> {
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
            // The reader is parked in a read, which this ends; one it starts between
            // two cancels, having been between reads at the first, is ended by the next.
            if let Some(reader) = self.reader.take() {
                while !reader.is_finished() {
                    let _ = CancelIoEx(self.file, None);
                    std::thread::sleep(Duration::from_millis(1));
                }
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
    let closed = |why: anyhow::Error| {
        let _ = tx.send(Incoming::Closed(why));
    };
    let event = match unsafe { CreateEventW(None, true, false, None) } {
        Ok(event) => event,
        Err(e) => return closed(anyhow!(e).context("CreateEventW")),
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
                closed(anyhow!(e).context("ReadFile"));
                break;
            }
            if let Err(e) = GetOverlappedResult(file.0, &ov, &mut got, true) {
                closed(anyhow!(e).context("GetOverlappedResult"));
                break;
            }
        }
        let got = got as usize;
        if got < 8 {
            continue;
        }
        let flags = u32::from_le_bytes(chunk[4..8].try_into().expect("four bytes"));
        if flags & FIRST != 0 {
            message.clear();
        }
        message.extend_from_slice(&chunk[8..got]);
        if flags & LAST == 0 {
            continue;
        }
        let Some(said) = Said::read(&message) else {
            continue;
        };
        if tx.send(Incoming::Said(said, Instant::now())).is_err() {
            break;
        }
    }
    unsafe {
        let _ = CloseHandle(event);
    }
}
