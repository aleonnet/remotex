//! The page's compositor for an RDP host's graphics pipeline.
//!
//! On a target with `egfx_passthrough` the gateway passes the pipeline's commands
//! to the browser instead of composing them and encoding the picture. This is what
//! composes them there: the gateway's own compositor and codecs — the modules
//! below are its sources, not copies of them — behind the few calls the paint
//! worker makes (`frontend/src/egfxCompositor.ts`).
//!
//! The framebuffer stays in this module's memory. The page reads it in place, as
//! the image data of the rectangles a run painted, so a frame costs the decode and
//! one copy onto the canvas.

// The gateway's modules, whole: what the page never calls is still theirs.
#![allow(dead_code)]

use wasm_bindgen::prelude::*;

#[path = "../../../../src/rdp_client"]
mod rdp_client {
    #[path = "compositor.rs"]
    pub mod compositor;
    #[path = "framebuffer.rs"]
    pub mod framebuffer;
    #[path = "gfx.rs"]
    pub mod gfx;
    #[path = "proto"]
    pub mod proto {
        #[path = "bitmap.rs"]
        pub mod bitmap;
        #[path = "clear.rs"]
        pub mod clear;
        #[path = "gfx.rs"]
        pub mod gfx;
        #[path = "nsc.rs"]
        pub mod nsc;
        #[path = "planar.rs"]
        pub mod planar;
        #[path = "progressive.rs"]
        pub mod progressive;
        #[path = "wire.rs"]
        pub mod wire;
        #[path = "zgfx.rs"]
        pub mod zgfx;
    }

    pub use compositor::Compositor;
}

/// One pipeline's compositor. Made where a pipeline starts (`graphicsStart`) and
/// thrown away where the next one does: it is right only for a pipeline it has
/// followed from its first command.
#[wasm_bindgen]
pub struct Egfx {
    compositor: rdp_client::Compositor,
    /// What the last run painted: `x, y, width, height` for each rectangle.
    painted: Vec<u32>,
    resized: bool,
}

#[wasm_bindgen]
impl Egfx {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Egfx {
        Egfx { compositor: rdp_client::Compositor::opaque(), painted: Vec::new(), resized: false }
    }

    /// Compose one `GRAPHICS` record's commands, and return how many frames they
    /// ended. What they painted is [`Self::painted`] until the next call.
    ///
    /// Throws for a command that does not decode. The compositor is then no longer
    /// the host's picture of its client, and is not to be fed again.
    pub fn compose(&mut self, commands: &[u8]) -> Result<u32, JsError> {
        self.painted.clear();
        self.resized = false;
        let composed = self.compositor.compose(commands).map_err(|e| JsError::new(&format!("{e:#}")))?;
        self.resized = composed.resized.is_some();
        for rect in composed.painted {
            self.painted.extend([rect.x, rect.y, rect.width, rect.height]);
        }
        Ok(composed.frames)
    }

    /// The rectangles the last run painted, four numbers each: `x, y, width,
    /// height`, in framebuffer pixels.
    pub fn painted(&self) -> Vec<u32> {
        self.painted.clone()
    }

    /// Whether the last run reset the output, which leaves the framebuffer at its
    /// new size and blank but for what the run painted after.
    pub fn resized(&self) -> bool {
        self.resized
    }

    pub fn width(&self) -> u32 {
        self.compositor.framebuffer().with(|frame| frame.width)
    }

    pub fn height(&self) -> u32 {
        self.compositor.framebuffer().with(|frame| frame.height)
    }

    /// Where the framebuffer is in this module's memory: `width * height * 4`
    /// bytes, RGBA, top row first. Good until the next [`Self::compose`], which may
    /// move it, as may anything that grows the memory.
    pub fn pixels(&self) -> *const u8 {
        self.compositor.framebuffer().with(|frame| frame.pixels.as_ptr())
    }
}

impl Default for Egfx {
    fn default() -> Self {
        Self::new()
    }
}
