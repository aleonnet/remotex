//! The page's decoder for a session's lossless sound: one FLAC frame in, its
//! samples out.
//!
//! A target with `audio_format = "flac"` sends the browser FLAC instead of Opus:
//! wlshare's own frames passed as they came, or an RDP host's PCM coded by the
//! gateway with libFLAC. Either way a packet on the audio socket is one FLAC
//! frame, a stream of its own one block long (`desktop-flac` makes them so), and
//! no browser's WebCodecs is asked to read that: this decodes it.
//!
//! It is here and nowhere else. The gateway's FLAC is libFLAC, loaded at run
//! time, which a page cannot have, and the gateway never decodes a frame it
//! sends on. So the decoder is this module's alone, tested through the binding
//! against frames libFLAC made (`frontend/src/flacDecoder.test.ts`).
//!
//! No stream header is sent. The `audioFormat` message names the rate, the
//! channels and the frames in a packet, and the samples are 16 bits, the one
//! width either source has. A frame states all four itself, so [`Decoder`] holds
//! each frame to what was announced rather than building a header to read it
//! behind: one of any other shape is refused, and costs its own samples and
//! nothing after it.

use std::fmt;
use std::io::Cursor;

use claxon::frame::FrameReader;

/// What `audioFormat` announced: the shape every frame of the stream has.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stream {
    /// Samples per second per channel: 48 000 for wlshare's, 44 100 for an RDP
    /// host's.
    pub rate: u32,
    /// 1 or 2.
    pub channels: u8,
    /// The frames of samples in every FLAC frame.
    pub block: u16,
}

/// Why a frame was not decoded.
#[derive(Debug)]
pub enum Error {
    Unsupported(Stream),
    NotAFrame(usize),
    Header,
    Decode(claxon::Error),
    Shape { frames: u32, channels: u32, want: Stream },
    Trailing(usize),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unsupported(stream) => {
                write!(f, "{stream:?} is not a stream carried here: 44.1 or 48 kHz, 1 or 2 channels")
            }
            Self::NotAFrame(len) => write!(f, "{len} bytes are not a FLAC frame"),
            Self::Header => {
                write!(f, "a FLAC frame whose header states another rate or sample width than the stream's")
            }
            Self::Decode(_) => write!(f, "decoding a FLAC frame"),
            Self::Shape { frames, channels, want } => {
                write!(f, "a FLAC frame of {frames} frames of {channels} channels, where {want:?} was announced")
            }
            Self::Trailing(len) => write!(f, "{len} bytes after the FLAC frame"),
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Decode(e) => Some(e),
            _ => None,
        }
    }
}

/// The code a frame header states `rate` with, in the low four bits of its third
/// byte.
fn rate_code(rate: u32) -> Option<u8> {
    match rate {
        44_100 => Some(0b1001),
        48_000 => Some(0b1010),
        _ => None,
    }
}

/// One stream's decoder. Each frame decodes on its own, so a frame that fails
/// leaves the decoder good for the next.
pub struct Decoder {
    stream: Stream,
    rate_code: u8,
    /// claxon's buffer, handed back after every frame.
    samples: Vec<i32>,
}

impl Decoder {
    pub fn new(stream: Stream) -> Result<Self, Error> {
        let rate_code = rate_code(stream.rate).ok_or(Error::Unsupported(stream))?;
        if !(1..=2).contains(&stream.channels) || stream.block < 16 {
            return Err(Error::Unsupported(stream));
        }
        Ok(Self { stream, rate_code, samples: Vec::new() })
    }

    /// Decode one frame, the whole of `frame` and nothing more, and write its
    /// samples to `out` as planar floats in -1 to 1: every sample of the first
    /// channel, then every sample of the second. That is what Web Audio plays,
    /// and the division by 2^15 is exact, so nothing is lost on the way.
    ///
    /// The frame's CRCs are checked, and its header against the stream. A frame
    /// that is refused leaves `out` as it was.
    pub fn decode(&mut self, frame: &[u8], out: &mut Vec<f32>) -> Result<(), Error> {
        // The sync code, then the rate and the sample width where the header
        // states them: claxon reads both and tells its caller neither.
        if frame.len() < 6 || frame[0] != 0xFF || frame[1] & 0xFE != 0xF8 {
            return Err(Error::NotAFrame(frame.len()));
        }
        // 0b100 is 16 bits a sample.
        if frame[2] & 0x0F != self.rate_code || (frame[3] >> 1) & 0b111 != 0b100 {
            return Err(Error::Header);
        }
        let mut reader = FrameReader::new(Cursor::new(frame));
        let block = reader
            .read_next_or_eof(std::mem::take(&mut self.samples))
            .map_err(Error::Decode)?
            .ok_or(Error::NotAFrame(frame.len()))?;
        let (frames, channels) = (block.duration(), block.channels());
        let read = reader.into_inner().position() as usize;
        let shaped = frames == u32::from(self.stream.block) && channels == u32::from(self.stream.channels);
        if shaped && read == frame.len() {
            out.clear();
            for channel in 0..channels {
                out.extend(block.channel(channel).iter().map(|&sample| sample as f32 / 32_768.0));
            }
        }
        self.samples = block.into_buffer();
        if !shaped {
            return Err(Error::Shape { frames, channels, want: self.stream });
        }
        if read != frame.len() {
            return Err(Error::Trailing(frame.len() - read));
        }
        Ok(())
    }
}
