//! One duplication of the desktop and the encoder for its size. A desktop of another
//! size is another duplication: a mode change ends this one.
//!
//! The output duplicated is the one at the desktop's origin, which is the only one a
//! Windows RDP session has unless its client spans monitors.

use anyhow::{Context as _, Result, bail};
use desktop_vp9::{Encoder, Picture};
use windows::Win32::Foundation::HMODULE;
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_UNKNOWN;
use windows::Win32::Graphics::Direct3D11::{
    D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAP_READ, D3D11_MAPPED_SUBRESOURCE, D3D11_SDK_VERSION,
    D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING, D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
};
use windows::Win32::Graphics::Dxgi::Common::DXGI_SAMPLE_DESC;
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, DXGI_ERROR_WAIT_TIMEOUT, DXGI_OUTDUPL_FRAME_INFO, DXGI_OUTDUPL_POINTER_SHAPE_INFO, IDXGIFactory1,
    IDXGIOutput1, IDXGIOutputDuplication, IDXGIResource,
};
use windows::core::Interface as _;

use remotex_video_channel::Plan;
use crate::log::Log;
use crate::pointer::{self, PointerState};

/// How long a capture waits for the desktop to change.
const CAPTURE_WAIT: u32 = 100;
/// The most threads the encoder codes with: past three a desktop the size of most has
/// little left to share out, and a fourth is for one larger.
const MOST_THREADS: usize = 4;

/// Threads the encoder codes with on a host of `cores`: half of them, two at least. The
/// session's own applications keep the rest, which the agent's priority would take
/// from them.
fn threads_for(cores: usize) -> usize {
    (cores / 2).clamp(2, MOST_THREADS)
}

pub struct Capture {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    dup: IDXGIOutputDuplication,
    staging: Option<ID3D11Texture2D>,
    pub size: (u16, u16),
    /// The desktop as last grabbed, which is blank until [`Self::filled`].
    pub picture: Picture,
    /// Whether a grab has put the desktop in [`Self::picture`] yet.
    pub filled: bool,
    pub encoder: Encoder,
    shape: Vec<u8>,
}

pub enum Grab {
    /// The desktop changed, and the picture holds it.
    Picture,
    /// Nothing of the picture changed; the pointer may have.
    Still,
    /// The duplication is over — a mode change, the secure desktop — and another is
    /// to be made.
    Lost(windows::core::Error),
}

impl Capture {
    /// A duplication of the desktop, refused while this session cannot see it: the
    /// secure desktop of a UAC prompt, Ctrl+Alt+Del or the lock screen.
    pub fn new(plan: Plan, quality: u8, log: &mut Log) -> Result<Self> {
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
                        let (Some(device), Some(context)) = (device, context) else {
                            bail!("D3D11CreateDevice made no device");
                        };
                        let output1: IDXGIOutput1 = output.cast()?;
                        let dup = output1.DuplicateOutput(&device).context("DuplicateOutput")?;
                        let mode = dup.GetDesc().ModeDesc;
                        let (Ok(width), Ok(height)) = (u16::try_from(mode.Width), u16::try_from(mode.Height)) else {
                            bail!("a {}x{} desktop", mode.Width, mode.Height);
                        };
                        let threads = threads_for(std::thread::available_parallelism().map_or(1, |cores| cores.get()));
                        log.say(format!(
                            "duplicating a {width}x{height} desktop, {} at quality {quality}, coded by {threads} threads",
                            plan.chroma.name()
                        ));
                        return Ok(Self {
                            device,
                            context,
                            dup,
                            staging: None,
                            size: (width, height),
                            picture: Picture::new(width, height, plan.chroma)?,
                            filled: false,
                            encoder: Encoder::new(width, height, plan.chroma, quality, threads)?,
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

    /// The next change of the desktop, waiting a little for one, with whatever the
    /// pointer did on the way.
    pub fn grab(&mut self, pointer: &mut PointerState) -> Result<Grab> {
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
                if let Some(message) = pointer::message(&shape, &self.shape) {
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
            let staging = match &self.staging {
                Some(staging) => staging,
                None => {
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
                    self.staging.insert(texture.context("CreateTexture2D made no texture")?)
                }
            };
            self.context.CopyResource(staging, &texture);
            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            self.context.Map(staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped)).context("Map")?;
            let pitch = mapped.RowPitch as usize;
            let (w, h) = (usize::from(self.size.0), usize::from(self.size.1));
            let pixels = std::slice::from_raw_parts(mapped.pData as *const u8, (h - 1) * pitch + w * 4);
            let read = self.picture.read_bgrx(pixels, pitch);
            self.context.Unmap(staging, 0);
            read?;
            self.filled = true;
            Ok(Grab::Picture)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_encoder_has_half_the_cores_between_two_and_four() {
        assert_eq!(threads_for(1), 2);
        assert_eq!(threads_for(4), 2);
        assert_eq!(threads_for(6), 3);
        assert_eq!(threads_for(8), 4);
        assert_eq!(threads_for(32), 4);
    }
}
