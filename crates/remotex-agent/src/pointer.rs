//! The pointer, as Desktop Duplication hands it over beside the picture, which never
//! holds it: a shape message of its own for the gateway, which the browser draws.

use windows::Win32::Graphics::Dxgi::DXGI_OUTDUPL_POINTER_SHAPE_INFO;

use crate::channel::{POINTER, POINTER_HIDDEN};

/// RDP's own bound on a pointer's side, which the gateway holds this one to.
const POINTER_MAX: u32 = 384;

/// The pointer and whether the gateway has heard of it.
#[derive(Default)]
pub struct PointerState {
    /// The shape's message, as it goes out.
    pub shape: Option<Vec<u8>>,
    pub visible: bool,
    /// Whether what the gateway was last told is out of date.
    pub dirty: bool,
}

impl PointerState {
    /// What to tell the gateway, if it is owed anything.
    pub fn message(&mut self) -> Option<Vec<u8>> {
        if !std::mem::take(&mut self.dirty) {
            return None;
        }
        if !self.visible {
            return Some(vec![POINTER_HIDDEN]);
        }
        // Visible, in a shape not handed over yet: said when it is.
        self.shape.clone()
    }
}

/// A pixel the desktop under it would be inverted by, which cannot be: the desktop is
/// not here. The checkerboard the gateway's own pointer decoder draws.
fn inverted(row: u32, column: u32) -> [u8; 4] {
    if (row + column).is_multiple_of(2) { [0xFF; 4] } else { [0x00, 0x00, 0x00, 0xFF] }
}

/// A pointer shape as its message: straight-alpha `RGBA`, top row first.
pub fn message(info: &DXGI_OUTDUPL_POINTER_SHAPE_INFO, bytes: &[u8]) -> Option<Vec<u8>> {
    const MONOCHROME: u32 = 1;
    const COLOR: u32 = 2;
    const MASKED_COLOR: u32 = 4;
    let (width, pitch) = (info.Width, info.Pitch as usize);
    // A monochrome shape is its AND mask above its XOR mask, each `height` rows.
    let height = if info.Type == MONOCHROME { info.Height / 2 } else { info.Height };
    if width == 0 || height == 0 || width > POINTER_MAX || height > POINTER_MAX {
        return None;
    }
    let rows = if info.Type == MONOCHROME { height * 2 } else { height } as usize;
    if bytes.len() < rows * pitch {
        return None;
    }
    let hot = |at: i32, side: u32| at.clamp(0, side as i32 - 1) as u16;
    let mut message = vec![POINTER];
    message.extend_from_slice(&(width as u16).to_le_bytes());
    message.extend_from_slice(&(height as u16).to_le_bytes());
    message.extend_from_slice(&hot(info.HotSpot.x, width).to_le_bytes());
    message.extend_from_slice(&hot(info.HotSpot.y, height).to_le_bytes());
    for row in 0..height {
        for column in 0..width {
            let (r, c) = (row as usize, column as usize);
            let pixel = match info.Type {
                MONOCHROME => {
                    let bit = |row: usize| bytes[row * pitch + c / 8] >> (7 - c % 8) & 1;
                    match (bit(r), bit(r + height as usize)) {
                        (0, 0) => [0x00, 0x00, 0x00, 0xFF],
                        (0, _) => [0xFF; 4],
                        (_, 0) => [0x00; 4],
                        _ => inverted(row, column),
                    }
                }
                COLOR => {
                    let at = r * pitch + c * 4;
                    [bytes[at + 2], bytes[at + 1], bytes[at], bytes[at + 3]]
                }
                MASKED_COLOR => {
                    let at = r * pitch + c * 4;
                    let (b, g, r, mask) = (bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
                    match (mask, (r, g, b)) {
                        (0, _) => [r, g, b, 0xFF],
                        (_, (0, 0, 0)) => [0x00; 4],
                        _ => inverted(row, column),
                    }
                }
                _ => return None,
            };
            message.extend_from_slice(&pixel);
        }
    }
    Some(message)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(kind: u32, width: u32, height: u32, pitch: u32, hot: (i32, i32)) -> DXGI_OUTDUPL_POINTER_SHAPE_INFO {
        DXGI_OUTDUPL_POINTER_SHAPE_INFO {
            Type: kind,
            Width: width,
            Height: height,
            Pitch: pitch,
            HotSpot: windows::Win32::Foundation::POINT { x: hot.0, y: hot.1 },
        }
    }

    /// A monochrome shape is two masks stacked; each pair of bits is one of four
    /// pixels, and the one that would invert the desktop is the checkerboard.
    #[test]
    fn a_monochrome_shape_is_its_two_masks() {
        // One row of four pixels: AND 0011, XOR 0101.
        let bytes = [0b0011_0000, 0b0101_0000];
        let got = message(&info(1, 4, 2, 1, (1, 0)), &bytes).unwrap();
        assert_eq!(&got[..9], &[POINTER, 4, 0, 1, 0, 1, 0, 0, 0]);
        let pixels: Vec<&[u8]> = got[9..].chunks(4).collect();
        assert_eq!(pixels, [&[0, 0, 0, 0xFF][..], &[0xFF; 4], &[0; 4], &inverted(0, 3)]);
    }

    /// A colour shape is BGRA and goes out RGBA; a hotspot outside it is held to its
    /// edge; a shape past RDP's bound is not sent at all.
    #[test]
    fn a_colour_shape_is_reordered_and_bounded() {
        let got = message(&info(2, 1, 1, 4, (5, -3)), &[1, 2, 3, 4]).unwrap();
        assert_eq!(got, [POINTER, 1, 0, 1, 0, 0, 0, 0, 0, 3, 2, 1, 4]);
        assert!(message(&info(2, POINTER_MAX + 1, 1, (POINTER_MAX + 1) * 4, (0, 0)), &vec![0; 4 * 385]).is_none());
        assert!(message(&info(2, 2, 2, 8, (0, 0)), &[0; 8]).is_none(), "fewer bytes than rows");
    }

    /// A hidden pointer is said once, and a shape only once it is known.
    #[test]
    fn the_gateway_is_told_each_change_once() {
        let mut state = PointerState { dirty: true, ..Default::default() };
        assert_eq!(state.message(), Some(vec![POINTER_HIDDEN]));
        assert_eq!(state.message(), None);
        state.visible = true;
        state.dirty = true;
        assert_eq!(state.message(), None, "no shape yet");
        state.shape = Some(vec![POINTER]);
        state.dirty = true;
        assert_eq!(state.message(), Some(vec![POINTER]));
    }
}
