//! An in-session agent's video: the desktop as a VP9 stream the host codes itself, on a
//! dynamic channel of this connection.
//!
//! Not RDP's. Windows has no extension point for a codec in its graphics pipeline, but an
//! application in the session may open a dynamic channel of its own and write what it
//! likes on it, and [`CHANNEL_NAME`] is the one the agent opens. What travels on it is
//! remotex's alone, each message one write on the host and one Data message here — the
//! channel cuts and joins it ([`super::dvc`]) — with a kind in its first byte and every
//! field little-endian, as RDP's are. Each kind's byte and each message's layout are
//! the `remotex-video-channel` crate's, which the agent builds from too; what they mean
//! is described here.
//!
//! The agent opens the channel and says nothing until it has the **plan**, this end's
//! first word: what the stream is to be coded at. Then it sends **frames**, each the
//! whole desktop, one in flight at a time: the next waits for the **echo** of the one
//! before, which this end sends once the frame has gone on to whoever is watching, so
//! that the agent's quality walk reads the whole path. Beside them travels the
//! **pointer**, as its own shape and never in the picture, because a host whose graphics
//! are stalled sends none of its own. A **gap** says the agent cannot see the desktop —
//! the secure desktop of a UAC prompt or the lock screen, which a capture in the user's
//! session is refused — and this end may ask for a **keyframe**.
//!
//! One in flight is the agent's rule, and it sends another after a frame it has waited
//! too long for; this end holds the frames it has passed on and not yet echoed to
//! [`UNECHOED`] bytes together, past which the channel is closed.
//!
//! # Whose picture it is
//!
//! The graphics pipeline carries the desktop, and the agent's stream carries it instead
//! while it flows: from a keyframe the size of the desktop, until a gap, a frame of any
//! other size, or the channel closing. [`Stream`] keeps that one decision. While the
//! stream is the picture the session withholds the pipeline's frame acknowledgements,
//! which stalls the host's own graphics so the desktop is not encoded twice, and resumes
//! them when the pipeline carries the picture again. A resize is a frame of another size
//! and so a turn of the pipeline's: the host's graphics reset waits for the
//! acknowledgements, and the stream comes back at a keyframe of the new size.
//!
//! # Passed, or not taken
//!
//! The stream is for passing on as it came and for nothing else: it is coded to the
//! plan, which is what whoever is watching decodes, so that nothing between the host
//! and them decodes or encodes a picture. A frame that is not the plan's is refused by
//! name and the channel closed with it, which leaves the desktop on the pipeline, to
//! be encoded by this gateway as it is without an agent. There is no third way, in
//! which the agent's stream is decoded here and coded again.
//!
//! See [A Windows host's video over its own RDP connection](../../../docs/rdp-in-session-video.md)
//! for what was measured against a Windows host and what each rule here rests on.

use std::collections::VecDeque;

use log::{debug, info};

pub use remotex_video_channel::{CHANNEL_NAME, Plan};
use remotex_video_channel::{FRAME, GAP, POINTER, POINTER_HIDDEN};

use super::dvc::MAX_PAYLOAD;
use super::pointer::{MAX_DIMENSION, Shape};
use super::wire::{Malformed, Reader};

const WHAT: &str = "an agent's video message";

/// The most bytes of frames passed on and not yet echoed: one message's worth, which
/// an agent keeping one frame in flight never comes near, and which bounds what one
/// that does not can have waiting on whoever is watching.
pub const UNECHOED: usize = MAX_PAYLOAD;

/// One frame of the stream, the whole desktop.
#[derive(Clone, PartialEq, Eq)]
pub struct Frame {
    /// The agent's number for it, which its echo names.
    pub seq: u32,
    pub width: u16,
    pub height: u16,
    pub keyframe: bool,
    pub data: Vec<u8>,
}

/// Hand-written, because the derived one prints every byte of the frame.
impl std::fmt::Debug for Frame {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Frame {{ seq {}, {}x{}, {}, {} bytes }}",
            self.seq,
            self.width,
            self.height,
            if self.keyframe { "keyframe" } else { "delta" },
            self.data.len()
        )
    }
}

/// The pointer as the agent reports it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Pointer {
    Hidden,
    Shape(Shape),
}

/// What a turn amounted to, beyond the messages it put on the wire.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Output {
    /// The stream is the picture from the frame that follows: the pipeline's frames go
    /// unacknowledged.
    Began,
    Frame(Frame),
    Pointer(Pointer),
    /// The pipeline carries the picture again: its acknowledgements resume.
    Ended,
}

/// What a turn put on the wire and what it meant.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Turn {
    pub replies: Vec<Vec<u8>>,
    pub outputs: Vec<Output>,
}

/// The channel's conversation, and whose picture the desktop is.
#[derive(Debug)]
pub struct Stream {
    plan: Plan,
    /// Whether the stream is the picture.
    flowing: bool,
    /// Whether a keyframe has been asked for and not yet come, while the stream is
    /// not the picture.
    asked: bool,
    /// The pointer as the agent last reported it, kept while the pipeline carries the
    /// picture, whose own pointer updates are the ones that count then.
    pointer: Option<Pointer>,
    /// The frames passed on and not yet echoed, by number and size.
    unechoed: VecDeque<(u32, usize)>,
}

impl Stream {
    pub fn new(plan: Plan) -> Self {
        Self { plan, flowing: false, asked: false, pointer: None, unechoed: VecDeque::new() }
    }

    /// Whether the stream is the picture.
    pub fn flowing(&self) -> bool {
        self.flowing
    }

    /// The agent opened the channel: it is told the plan, and codes nothing before it.
    pub fn opened(&mut self) -> Turn {
        *self = Self::new(self.plan);
        Turn { replies: vec![self.plan.message().to_vec()], outputs: Vec::new() }
    }

    /// The channel closed, and the stream with it, for `why`.
    pub fn closed(&mut self, why: &str) -> Turn {
        let mut turn = Turn::default();
        self.end(&mut turn, why);
        *self = Self::new(self.plan);
        turn
    }

    /// The pipeline rebuilt the desktop at a size: the stream starts over at a keyframe
    /// of it, which the agent is asked for.
    pub fn reset(&mut self) -> Turn {
        let mut turn = Turn::default();
        self.end(&mut turn, "the host rebuilt the desktop");
        self.ask(&mut turn);
        turn
    }

    /// One message from the agent, on a desktop of `desktop` pixels.
    pub fn push(&mut self, message: &[u8], desktop: (u32, u32)) -> Result<Turn, Malformed> {
        let mut r = Reader::new(WHAT, message);
        let mut turn = Turn::default();
        match r.u8()? {
            FRAME => {
                let seq = r.u32_le()?;
                let (width, height) = (r.u16_le()?, r.u16_le()?);
                let data = r.rest();
                let header = desktop_vp9::frame_header(data).ok_or_else(|| r.missing("a VP9 frame header"))?;
                if header.profile != self.plan.chroma.profile() {
                    return Err(r.refuse("a VP9 profile that is not the plan's,", header.profile));
                }
                let waiting = self.unechoed.iter().map(|&(_, len)| len).sum::<usize>() + data.len();
                if waiting > UNECHOED {
                    return Err(r.refuse("frames awaiting their echoes, in bytes,", u64::try_from(waiting).unwrap_or(u64::MAX)));
                }
                let frame = Frame { seq, width, height, keyframe: header.keyframe, data: data.to_vec() };
                self.frame(frame, desktop, &mut turn);
            }
            POINTER => {
                let (width, height) = (r.u16_le()?, r.u16_le()?);
                let (hotspot_x, hotspot_y) = (r.u16_le()?, r.u16_le()?);
                if width == 0 || width > MAX_DIMENSION {
                    return Err(r.refuse("a pointer width", width));
                }
                if height == 0 || height > MAX_DIMENSION {
                    return Err(r.refuse("a pointer height", height));
                }
                if hotspot_x >= width || hotspot_y >= height {
                    return Err(r.refuse("a pointer hotspot outside its shape, at", hotspot_x.max(hotspot_y)));
                }
                let rgba = r.bytes(usize::from(width) * usize::from(height) * 4)?.to_vec();
                self.point(Pointer::Shape(Shape { width, height, hotspot_x, hotspot_y, rgba }), &mut turn);
            }
            POINTER_HIDDEN => self.point(Pointer::Hidden, &mut turn),
            // The agent starts again at a keyframe of its own accord.
            GAP => self.end(&mut turn, "the agent cannot see the desktop"),
            other => return Err(r.refuse("a kind", other)),
        }
        Ok(turn)
    }

    fn frame(&mut self, frame: Frame, desktop: (u32, u32), turn: &mut Turn) {
        let fits = (u32::from(frame.width), u32::from(frame.height)) == desktop;
        if !fits {
            // The desktop the agent sees is not the one the pipeline described: a
            // resize on its way, which the pipeline's graphics reset settles.
            self.end(turn, "the agent's frame is not the desktop's size");
            turn.replies.push(echo(frame.seq));
            return;
        }
        if !self.flowing {
            if !frame.keyframe {
                debug!("rdp: dropping the agent's frame {} until a keyframe", frame.seq);
                self.ask(turn);
                turn.replies.push(echo(frame.seq));
                return;
            }
            info!("rdp: the agent's stream carries the desktop, {}x{}", frame.width, frame.height);
            self.flowing = true;
            turn.outputs.push(Output::Began);
            if let Some(pointer) = self.pointer.clone() {
                turn.outputs.push(Output::Pointer(pointer));
            }
        }
        if frame.keyframe {
            self.asked = false;
        }
        self.unechoed.push_back((frame.seq, frame.data.len()));
        turn.outputs.push(Output::Frame(frame));
    }

    fn point(&mut self, pointer: Pointer, turn: &mut Turn) {
        if self.flowing {
            turn.outputs.push(Output::Pointer(pointer.clone()));
        }
        self.pointer = Some(pointer);
    }

    fn end(&mut self, turn: &mut Turn, why: &str) {
        if self.flowing {
            info!("rdp: the pipeline carries the desktop again: {why}");
            self.flowing = false;
            self.asked = false;
            turn.outputs.push(Output::Ended);
        }
    }

    fn ask(&mut self, turn: &mut Turn) {
        if !self.asked {
            self.asked = true;
            turn.replies.push(keyframe());
        }
    }

    /// The frame numbered `seq` has gone on to whoever is watching: its echo.
    pub fn echoed(&mut self, seq: u32) -> Vec<u8> {
        if let Some(at) = self.unechoed.iter().position(|&(unechoed, _)| unechoed == seq) {
            self.unechoed.remove(at);
        }
        echo(seq)
    }

    /// A keyframe asked for by whoever is watching, whatever was asked before.
    pub fn ask_keyframe(&mut self) -> Vec<u8> {
        self.asked = true;
        keyframe()
    }
}

fn echo(seq: u32) -> Vec<u8> {
    remotex_video_channel::echo(seq).to_vec()
}

fn keyframe() -> Vec<u8> {
    remotex_video_channel::keyframe().to_vec()
}

#[cfg(test)]
mod tests {
    use desktop_vp9::Chroma;
    use remotex_video_channel::{FRAME_HEADER_LEN, frame_header, pointer_header};

    use super::*;

    const DESKTOP: (u32, u32) = (1280, 800);
    const PLAN_444: Plan = Plan { chroma: Chroma::Full, quality: 90, adaptive: true };

    /// A frame message as the agent writes one, with the agent's own header. `0xA0`
    /// opens a VP9 keyframe of profile 1 and `0xA4` a frame predicted from another.
    fn frame(seq: u32, size: (u16, u16), keyframe: bool) -> Vec<u8> {
        let mut message = Vec::new();
        frame_header(&mut message, seq, size);
        message.extend_from_slice(&[if keyframe { 0xA0 } else { 0xA4 }, 0, 0, 0]);
        message
    }

    fn pointer(side: u16) -> Vec<u8> {
        let mut message = pointer_header((side, side), (1, 0));
        message.extend(std::iter::repeat_n(7, usize::from(side) * usize::from(side) * 4));
        message
    }

    fn flowing() -> Stream {
        let mut stream = Stream::new(PLAN_444);
        stream.opened();
        let turn = stream.push(&frame(1, (1280, 800), true), DESKTOP).unwrap();
        assert_eq!(turn.outputs.first(), Some(&Output::Began));
        stream
    }

    #[test]
    fn the_plan_is_the_first_word_and_written_whole() {
        let mut stream = Stream::new(Plan { chroma: Chroma::Subsampled, quality: 70, adaptive: false });
        let turn = stream.opened();
        assert_eq!(turn.replies, vec![vec![0x81, 1, 0, 70, 0]]);
        assert!(turn.outputs.is_empty());
        assert_eq!(Stream::new(PLAN_444).opened().replies, vec![vec![0x81, 1, 1, 90, 1]]);
    }

    /// The stream becomes the picture at a keyframe the size of the desktop, and until
    /// then the agent is asked for one, once, and each frame dropped is echoed so the
    /// agent sends the next.
    #[test]
    fn the_stream_begins_at_a_keyframe_and_asks_for_one_until_then() {
        let mut stream = Stream::new(PLAN_444);
        stream.opened();
        let turn = stream.push(&frame(4, (1280, 800), false), DESKTOP).unwrap();
        assert_eq!(turn.replies, vec![vec![0x83], vec![0x82, 4, 0, 0, 0]]);
        assert!(turn.outputs.is_empty());
        assert!(!stream.flowing());

        let turn = stream.push(&frame(5, (1280, 800), false), DESKTOP).unwrap();
        assert_eq!(turn.replies, vec![echo(5)], "asked once");

        let turn = stream.push(&frame(6, (1280, 800), true), DESKTOP).unwrap();
        assert!(turn.replies.is_empty(), "a frame that goes on is echoed by whoever takes it");
        let [Output::Began, Output::Frame(first)] = &turn.outputs[..] else { panic!("{:?}", turn.outputs) };
        assert_eq!((first.seq, first.keyframe, first.width, first.height), (6, true, 1280, 800));
        assert!(stream.flowing());

        let turn = stream.push(&frame(7, (1280, 800), false), DESKTOP).unwrap();
        assert!(matches!(&turn.outputs[..], [Output::Frame(next)] if next.seq == 7 && !next.keyframe));
    }

    /// A frame of another size is a resize on its way: the pipeline takes the picture
    /// back, its graphics reset settles the size, and the agent is asked to start over.
    #[test]
    fn a_frame_of_another_size_gives_the_picture_back_until_the_reset() {
        let mut stream = flowing();
        let turn = stream.push(&frame(2, (1600, 900), true), DESKTOP).unwrap();
        assert_eq!(turn.outputs, vec![Output::Ended]);
        assert_eq!(turn.replies, vec![echo(2)]);

        // More of them, before the reset arrives, change nothing.
        let turn = stream.push(&frame(3, (1600, 900), false), DESKTOP).unwrap();
        assert_eq!((turn.outputs, turn.replies), (Vec::new(), vec![echo(3)]));

        assert_eq!(stream.reset().replies, vec![vec![0x83]]);
        let turn = stream.push(&frame(4, (1600, 900), true), (1600, 900)).unwrap();
        assert!(matches!(&turn.outputs[..], [Output::Began, Output::Frame(_)]));
    }

    /// The secure desktop: the agent says so, and comes back at a keyframe unasked.
    #[test]
    fn a_gap_gives_the_picture_back_and_the_keyframe_after_it_takes_it_again() {
        let mut stream = flowing();
        assert_eq!(stream.push(&[GAP], DESKTOP).unwrap(), Turn { replies: Vec::new(), outputs: vec![Output::Ended] });
        assert_eq!(stream.push(&[GAP], DESKTOP).unwrap(), Turn::default(), "said once");
        let turn = stream.push(&frame(9, (1280, 800), true), DESKTOP).unwrap();
        assert!(matches!(&turn.outputs[..], [Output::Began, Output::Frame(_)]));
    }

    #[test]
    fn a_channel_that_closes_gives_the_picture_back() {
        let mut stream = flowing();
        assert_eq!(stream.closed("a test").outputs, vec![Output::Ended]);
        assert!(!stream.flowing());
        assert_eq!(Stream::new(PLAN_444).closed("a test"), Turn::default());
    }

    /// The pointer travels as its own shape. While the pipeline carries the picture the
    /// host's own pointer updates count and the agent's is kept; it goes out with the
    /// stream's first frame, ahead of it.
    #[test]
    fn the_pointer_is_kept_until_the_stream_is_the_picture() {
        let mut stream = Stream::new(PLAN_444);
        stream.opened();
        assert!(stream.push(&pointer(2), DESKTOP).unwrap().outputs.is_empty());
        let turn = stream.push(&frame(1, (1280, 800), true), DESKTOP).unwrap();
        let [Output::Began, Output::Pointer(Pointer::Shape(shape)), Output::Frame(_)] = &turn.outputs[..] else {
            panic!("{:?}", turn.outputs)
        };
        assert_eq!((shape.width, shape.height, shape.hotspot_x, shape.hotspot_y), (2, 2, 1, 0));
        assert_eq!(shape.rgba, vec![7; 16]);

        assert_eq!(stream.push(&[POINTER_HIDDEN], DESKTOP).unwrap().outputs, vec![Output::Pointer(Pointer::Hidden)]);
    }

    #[test]
    fn a_message_that_is_not_one_is_refused_by_the_field() {
        let mut stream = Stream::new(PLAN_444);
        let refused = |stream: &mut Stream, message: &[u8]| stream.push(message, DESKTOP).unwrap_err().to_string();
        assert!(refused(&mut stream, &[0x7F]).contains("a kind"));
        assert!(refused(&mut stream, &[FRAME, 1, 0, 0, 0, 0, 5, 0x20, 3]).contains("a VP9 frame header"));
        // A shape past RDP's own bound, one shorter than its size, and a hotspot outside.
        let huge = pointer_header((385, 1), (0, 0));
        assert!(refused(&mut stream, &huge).contains("a pointer width"));
        let mut short = pointer(2);
        short.pop();
        assert!(stream.push(&short, DESKTOP).is_err());
        let mut outside = pointer(2);
        outside[7] = 2;
        assert!(refused(&mut stream, &outside).contains("a pointer hotspot"));
    }

    /// A stream coded to something other than the plan cannot be passed on as it came,
    /// and is not taken: the frame is refused, which closes the channel.
    #[test]
    fn a_frame_that_is_not_the_plans_is_refused() {
        let mut subsampled = frame(1, (1280, 800), true);
        subsampled[FRAME_HEADER_LEN] = 0x80; // a keyframe of profile 0
        let mut stream = Stream::new(PLAN_444);
        stream.opened();
        let refused = stream.push(&subsampled, DESKTOP).unwrap_err().to_string();
        assert!(refused.contains("a VP9 profile that is not the plan's"), "{refused}");
        assert!(!stream.flowing());

        let mut stream = Stream::new(Plan { chroma: Chroma::Subsampled, ..PLAN_444 });
        stream.opened();
        assert!(stream.push(&subsampled, DESKTOP).unwrap().outputs.contains(&Output::Began));
        assert!(stream.push(&frame(2, (1280, 800), false), DESKTOP).is_err(), "a 4:4:4 frame for a 4:2:0 plan");
    }

    /// An agent that does not wait for its echoes has what it sends refused once the
    /// frames passed on and not yet echoed would pass the budget, and each echo makes
    /// room again.
    #[test]
    fn frames_awaiting_their_echoes_are_held_to_a_budget() {
        let big = |seq| {
            let mut message = frame(seq, (1280, 800), false);
            message.resize(message.len() - 4 + UNECHOED / 2, 0);
            message
        };
        let mut stream = flowing();
        assert!(matches!(&stream.push(&big(2), DESKTOP).unwrap().outputs[..], [Output::Frame(_)]));
        let refused = stream.push(&big(3), DESKTOP).unwrap_err().to_string();
        assert!(refused.contains("frames awaiting their echoes"), "{refused}");

        assert_eq!(stream.echoed(2), echo(2));
        assert!(matches!(&stream.push(&big(3), DESKTOP).unwrap().outputs[..], [Output::Frame(_)]));
    }

    /// Whoever is watching asks for a keyframe when its decoder has to start over, and
    /// the stream's own asking waits for that one.
    #[test]
    fn a_keyframe_asked_for_from_above_is_not_asked_for_twice() {
        let mut stream = Stream::new(PLAN_444);
        stream.opened();
        assert_eq!(stream.ask_keyframe(), vec![0x83]);
        let turn = stream.push(&frame(1, (1280, 800), false), DESKTOP).unwrap();
        assert_eq!(turn.replies, vec![echo(1)]);
    }
}
