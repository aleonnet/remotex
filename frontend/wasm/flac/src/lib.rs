//! The page's decoder for a session's lossless sound, bound for the audio
//! player (`frontend/src/flacDecoder.ts`): see [`decoder`].

mod decoder;

use wasm_bindgen::prelude::*;

/// One lossless audio stream's decoder, made from what `audioFormat` announced.
#[wasm_bindgen]
pub struct Flac {
    decoder: decoder::Decoder,
    samples: Vec<f32>,
}

#[wasm_bindgen]
impl Flac {
    /// Throws for a stream that is not one carried as FLAC here.
    #[wasm_bindgen(constructor)]
    pub fn new(rate: u32, channels: u8, block: u16) -> Result<Flac, JsError> {
        let decoder = decoder::Decoder::new(decoder::Stream { rate, channels, block })
            .map_err(|e| JsError::new(&e.to_string()))?;
        Ok(Flac { decoder, samples: Vec::new() })
    }

    /// Decode one frame to planar floats in -1 to 1: `block` samples of the
    /// first channel, then of the second. Throws for a frame that is not one of
    /// the stream's, which costs that frame alone: the next decodes on its own.
    pub fn decode(&mut self, frame: &[u8]) -> Result<Vec<f32>, JsError> {
        self.decoder.decode(frame, &mut self.samples).map_err(|e| JsError::new(&e.to_string()))?;
        Ok(self.samples.clone())
    }
}
