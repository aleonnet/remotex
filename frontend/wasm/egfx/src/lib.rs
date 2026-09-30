//! The page's compositor for an RDP host's graphics pipeline.
//!
//! On a target with `egfx_passthrough` the gateway passes the pipeline's commands
//! to the browser instead of composing them and encoding the picture. This is what
//! composes them there: the gateway's own compositor and codecs, which are the
//! `remotex-rdp-graphics` crate both are built with, behind the few calls the paint
//! worker makes (`frontend/src/egfxCompositor.ts`).
//!
//! The framebuffer stays in this module's memory, which is shared with the threads
//! below: the page uploads the rectangles a run painted out of it, into a texture.
//!
//! Progressive's tiles are decoded side by side, on rayon's pool, and a page has no
//! threads to spawn: a thread is a worker the page starts, running an instance of
//! this module on the one memory. So the pool's threads are seats the page's workers
//! take ([`run_pool_thread`]) before the pool is made of them ([`start_pool`]). A
//! module whose pool was never started composes on the thread that calls it.

use std::io;
use std::sync::mpsc::{Receiver, Sender, channel};
use std::sync::{Mutex, OnceLock};

use rayon::{ThreadBuilder, ThreadPoolBuilder};
use remotex_rdp_graphics::Compositor;
use wasm_bindgen::prelude::*;

/// The pool's threads on their way from the pool that makes them to the workers
/// that run them.
struct Seats {
    offer: Mutex<Sender<ThreadBuilder>>,
    take: Mutex<Receiver<ThreadBuilder>>,
}

fn seats() -> &'static Seats {
    static SEATS: OnceLock<Seats> = OnceLock::new();
    SEATS.get_or_init(|| {
        let (offer, take) = channel();
        Seats { offer: Mutex::new(offer), take: Mutex::new(take) }
    })
}

/// The compiled module, for a worker to make its instance of.
#[wasm_bindgen]
pub fn module() -> JsValue {
    wasm_bindgen::module()
}

/// Run one of the pool's threads on the worker that calls this, which waits for
/// the pool to be started and returns when the pool is gone: never, in a page.
#[wasm_bindgen(js_name = runPoolThread)]
pub fn run_pool_thread() {
    let thread = seats().take.lock().expect("no thread panics holding a seat").recv();
    if let Ok(thread) = thread {
        thread.run();
    }
}

/// Make the pool, of `threads` workers that are each in [`run_pool_thread`]
/// already: this waits for every thread to have started, and a worker cannot start
/// while the thread that made it waits.
#[wasm_bindgen(js_name = startPool)]
pub fn start_pool(threads: usize) -> Result<(), JsError> {
    let offer = seats().offer.lock().expect("no thread panics holding a seat").clone();
    ThreadPoolBuilder::new()
        .num_threads(threads)
        // The thread that was not sent is dropped with the error: it is not `Sync`,
        // which an error is.
        .spawn_handler(move |thread| offer.send(thread).map_err(|_| io::Error::other("the pool's seats are gone")))
        .build_global()
        .map_err(|e| JsError::new(&e.to_string()))
}

/// One pipeline's compositor. Made where a pipeline starts (`graphicsStart`) and
/// thrown away where the next one does: it is right only for a pipeline it has
/// followed from its first command.
#[wasm_bindgen]
pub struct Egfx {
    compositor: Compositor,
    /// What the last run painted: `x, y, width, height` for each rectangle.
    painted: Vec<u32>,
    resized: bool,
}

#[wasm_bindgen]
impl Egfx {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Egfx {
        Egfx { compositor: Compositor::new(), painted: Vec::new(), resized: false }
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
    /// bytes, `RGBX` — the fourth byte unused — top row first. Good until the next
    /// [`Self::compose`], which may move it.
    pub fn pixels(&self) -> *const u8 {
        self.compositor.framebuffer().with(|frame| frame.pixels.as_ptr())
    }
}

impl Default for Egfx {
    fn default() -> Self {
        Self::new()
    }
}
