//! The messages of the `remotex.video` dynamic channel, which remotex-agent writes in a
//! Windows session and the gateway reads on that session's RDP connection, and the other
//! way round: each kind's byte and each message's layout, in the one place both ends
//! build from, so that neither can change one without the other.
//!
//! Each message is one write on the host and one Data message at the gateway, with its
//! kind in its first byte and every field little-endian, as RDP's are. What each message
//! means and when it is sent is the gateway's to describe, in
//! `src/rdp_client/proto/video.rs`; the gateway also reads the agent's messages there, to
//! refuse each malformed one by the field.

use desktop_vp9::Chroma;

/// The dynamic channel the agent opens.
pub const CHANNEL_NAME: &str = "remotex.video";

/// What the two ends speak, stated in the plan: an agent that speaks another closes the
/// channel, and the gateway's pipeline goes on carrying the picture.
pub const VERSION: u8 = 1;

/// The agent's: one frame of the stream, a [`frame_header`] and the VP9 frame after it.
pub const FRAME: u8 = 0x01;
/// The agent's: the pointer's shape, a [`pointer_header`] and its `RGBA` rows after it.
pub const POINTER: u8 = 0x02;
/// The agent's: the pointer is hidden. The kind alone.
pub const POINTER_HIDDEN: u8 = 0x03;
/// The agent's: it cannot see the desktop. The kind alone.
pub const GAP: u8 = 0x04;
/// The gateway's: the [`Plan`].
pub const PLAN: u8 = 0x81;
/// The gateway's: a frame has gone on, by its number ([`echo`]).
pub const ECHO: u8 = 0x82;
/// The gateway's: send a keyframe ([`keyframe`]).
pub const KEYFRAME: u8 = 0x83;

/// How many bytes open a frame message: its kind, number, width and height.
pub const FRAME_HEADER_LEN: usize = 9;
/// How many bytes open a pointer message: its kind, width, height and hotspot.
pub const POINTER_HEADER_LEN: usize = 9;

/// What the agent is to code, which is what the gateway would have coded from the same
/// pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Plan {
    pub chroma: Chroma,
    /// The dial the agent's walk never goes above.
    pub quality: u8,
    /// Whether the walk listens to the echoes, or holds the dial.
    pub adaptive: bool,
}

impl Plan {
    /// The plan as the gateway's first word on the channel.
    pub fn message(self) -> [u8; 5] {
        [PLAN, VERSION, u8::from(self.chroma == Chroma::Full), self.quality, u8::from(self.adaptive)]
    }
}

/// The echo of the frame numbered `seq`.
pub fn echo(seq: u32) -> [u8; 5] {
    let [a, b, c, d] = seq.to_le_bytes();
    [ECHO, a, b, c, d]
}

/// The gateway's ask for a keyframe.
pub fn keyframe() -> [u8; 1] {
    [KEYFRAME]
}

/// What the gateway said, as the agent reads it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Said {
    Plan(Plan),
    /// A plan in a version the agent does not speak.
    Foreign(u8),
    Echo(u32),
    Keyframe,
}

impl Said {
    /// One of the gateway's messages, or `None` for one this version does not know,
    /// which is passed over.
    pub fn read(message: &[u8]) -> Option<Self> {
        Some(match *message {
            [PLAN, VERSION, chroma, quality, adaptive] => Said::Plan(Plan {
                chroma: if chroma == 0 { Chroma::Subsampled } else { Chroma::Full },
                quality,
                adaptive: adaptive != 0,
            }),
            [PLAN, version, ..] => Said::Foreign(version),
            [ECHO, a, b, c, d] => Said::Echo(u32::from_le_bytes([a, b, c, d])),
            [KEYFRAME] => Said::Keyframe,
            _ => return None,
        })
    }
}

/// Start a frame message in `out`, emptied first: the kind, the frame's number and
/// the desktop's size, which the VP9 frame follows.
pub fn frame_header(out: &mut Vec<u8>, seq: u32, (width, height): (u16, u16)) {
    out.clear();
    out.push(FRAME);
    out.extend_from_slice(&seq.to_le_bytes());
    out.extend_from_slice(&width.to_le_bytes());
    out.extend_from_slice(&height.to_le_bytes());
}

/// Start a pointer message with room for its shape: the kind, the shape's size and
/// its hotspot, which `width`×`height` `RGBA` pixels follow, top row first.
pub fn pointer_header((width, height): (u16, u16), (hotspot_x, hotspot_y): (u16, u16)) -> Vec<u8> {
    let mut message = Vec::with_capacity(POINTER_HEADER_LEN + usize::from(width) * usize::from(height) * 4);
    message.push(POINTER);
    for field in [width, height, hotspot_x, hotspot_y] {
        message.extend_from_slice(&field.to_le_bytes());
    }
    message
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_gateways_messages_read_back_as_written() {
        for plan in [
            Plan { chroma: Chroma::Full, quality: 90, adaptive: true },
            Plan { chroma: Chroma::Subsampled, quality: 70, adaptive: false },
        ] {
            assert_eq!(Said::read(&plan.message()), Some(Said::Plan(plan)));
        }
        assert_eq!(Said::read(&echo(0x0403_0201)), Some(Said::Echo(0x0403_0201)));
        assert_eq!(Said::read(&keyframe()), Some(Said::Keyframe));
    }

    #[test]
    fn a_plan_is_written_whole_and_another_versions_is_foreign() {
        let plan = Plan { chroma: Chroma::Subsampled, quality: 70, adaptive: false };
        assert_eq!(plan.message(), [0x81, 1, 0, 70, 0]);
        assert_eq!(Said::read(&[PLAN, VERSION + 1, 0, 70, 0, 9]), Some(Said::Foreign(VERSION + 1)));
        assert_eq!(Said::read(&[0x7F]), None);
        assert_eq!(Said::read(&[ECHO, 1, 2]), None);
    }

    #[test]
    fn the_agents_headers_are_written_whole() {
        let mut out = vec![0xEE];
        frame_header(&mut out, 0x0403_0201, (1280, 800));
        assert_eq!(out, [FRAME, 1, 2, 3, 4, 0x00, 0x05, 0x20, 0x03]);
        assert_eq!(out.len(), FRAME_HEADER_LEN);

        let pointer = pointer_header((32, 16), (1, 2));
        assert_eq!(pointer, [POINTER, 32, 0, 16, 0, 1, 0, 2, 0]);
        assert_eq!(pointer.len(), POINTER_HEADER_LEN);
        assert!(pointer.capacity() >= POINTER_HEADER_LEN + 32 * 16 * 4);
    }
}
