//! Apple High Performance's sound: what the stream is, and the decoder behind it.
//!
//! The Mac's `RemoteDesktopSystemAudio` transmitter encodes AAC-ELD (MPEG-4 audio
//! object type 39) whatever the negotiation agreed — see `docs/apple-vnc-889.md`.
//! The constants describing it are always compiled: a browser that decodes the
//! stream is passed it as it came, described by them. The decoder is compiled only
//! with the `apple-hp-media` feature, for every other browser, whose sound goes as
//! Opus encoded from the PCM it produces.
//!
//! The decoder is Fraunhofer's fdk-aac, whose licence is not OSI-approved and
//! grants no patents, so no build carries it by default. The gateway loads the
//! system's shared library the first time a session needs it (see [`load`]):
//! `libfdk-aac.so.2` on Linux, `libfdk-aac.2.dylib` on macOS and
//! `libfdk-aac-2.dll` on Windows. The `apple-hp-media-static` feature links
//! `fdk-aac-prebuilt`'s private static archive instead, for a build that brings
//! its own. Either way the six calls below are the whole interface.
//!
//! The decoder is configured out of band. RTP carries bare access units with no
//! header naming the stream, so the AudioSpecificConfig is stated here, once, from
//! measurement: 48 kHz, stereo, 480-sample frames (the RTP timestamp advances exactly
//! 480 per packet), no SBR and no error-resilience tools. Run against 377 captured
//! frames it decoded 375 cleanly and concealed two; every other reading — 512-sample
//! frames, the resilience flags, SBR — either refused the configuration or concealed
//! most of the stream.

/// AudioSpecificConfig for what the Mac sends, bit by bit:
///
/// ```text
/// 11111   audioObjectType escape
/// 000111  audioObjectType 39 - 32 = ER AAC ELD
/// 0011    samplingFrequencyIndex 3 = 48 000 Hz
/// 0010    channelConfiguration 2 = stereo
/// 1       frameLengthFlag: 480-sample frames
/// 0 0 0   section / scalefactor / spectral data resilience: off
/// 0       ldSbrPresentFlag: no SBR
/// 0000    eldExtType ELDEXT_TERM
/// ```
pub const AUDIO_SPECIFIC_CONFIG: [u8; 4] = [0xf8, 0xe6, 0x50, 0x00];

/// Samples per channel in one access unit, which is also one RTP packet: 10 ms.
pub const FRAME_SAMPLES: usize = 480;

/// Channels in the stream. Fixed by the configuration above, not read back from
/// the decoder per frame.
pub const CHANNELS: usize = 2;

#[cfg(feature = "apple-hp-media")]
mod fdk {
    //! fdk-aac's decoder calls, as `aacdecoder_lib.h` declares them. Its enums
    //! cross as `int`.

    use std::os::raw::{c_int, c_uint, c_void};

    pub type Handle = *mut c_void;

    /// `TT_MP4_RAW`: bare access units, configured with `aacDecoder_ConfigRaw`.
    pub const TT_MP4_RAW: c_int = 0;
    pub const AAC_DEC_OK: c_int = 0;
    /// `aac_dec_decode_error_start` to `_end`: the unit was damaged and the frame
    /// written is a concealed one.
    pub const CONCEALED: std::ops::RangeInclusive<c_int> = 0x4000..=0x4fff;

    /// The head of `CStreamInfo`: the three fields read here, which have led it in
    /// every fdk-aac release.
    #[repr(C)]
    pub struct StreamInfoHead {
        pub _sample_rate: c_int,
        pub frame_size: c_int,
        pub num_channels: c_int,
    }

    pub struct Api {
        pub open: unsafe extern "C" fn(transport: c_int, layers: c_uint) -> Handle,
        pub config_raw: unsafe extern "C" fn(Handle, conf: *mut *mut u8, length: *const c_uint) -> c_int,
        pub fill: unsafe extern "C" fn(
            Handle,
            buffer: *mut *mut u8,
            size: *const c_uint,
            bytes_valid: *mut c_uint,
        ) -> c_int,
        pub decode_frame: unsafe extern "C" fn(Handle, pcm: *mut i16, samples: c_int, flags: c_uint) -> c_int,
        pub stream_info: unsafe extern "C" fn(Handle) -> *const StreamInfoHead,
        pub close: unsafe extern "C" fn(Handle),
        /// Keeps the loaded library mapped for as long as the pointers above live.
        #[cfg(not(feature = "apple-hp-media-static"))]
        pub _library: libloading::Library,
    }
}

/// Linked from `fdk-aac-prebuilt-sys`, whose build script supplies the archive.
#[cfg(feature = "apple-hp-media-static")]
use fdk_aac_prebuilt_sys as _;

#[cfg(feature = "apple-hp-media-static")]
unsafe extern "C" {
    fn aacDecoder_Open(transport: std::os::raw::c_int, layers: std::os::raw::c_uint) -> fdk::Handle;
    fn aacDecoder_ConfigRaw(
        decoder: fdk::Handle,
        conf: *mut *mut u8,
        length: *const std::os::raw::c_uint,
    ) -> std::os::raw::c_int;
    fn aacDecoder_Fill(
        decoder: fdk::Handle,
        buffer: *mut *mut u8,
        size: *const std::os::raw::c_uint,
        bytes_valid: *mut std::os::raw::c_uint,
    ) -> std::os::raw::c_int;
    fn aacDecoder_DecodeFrame(
        decoder: fdk::Handle,
        pcm: *mut i16,
        samples: std::os::raw::c_int,
        flags: std::os::raw::c_uint,
    ) -> std::os::raw::c_int;
    fn aacDecoder_GetStreamInfo(decoder: fdk::Handle) -> *const fdk::StreamInfoHead;
    fn aacDecoder_Close(decoder: fdk::Handle);
}

/// fdk-aac, from the static archive linked into this build.
#[cfg(feature = "apple-hp-media-static")]
fn api() -> anyhow::Result<&'static fdk::Api> {
    static API: fdk::Api = fdk::Api {
        open: aacDecoder_Open,
        config_raw: aacDecoder_ConfigRaw,
        fill: aacDecoder_Fill,
        decode_frame: aacDecoder_DecodeFrame,
        stream_info: aacDecoder_GetStreamInfo,
        close: aacDecoder_Close,
    };
    Ok(&API)
}

/// Where the system's fdk-aac is looked for, in order. A bare name is the
/// platform loader's own search; the paths are where Homebrew, MacPorts and MSYS2
/// install it, which that search does not reach.
#[cfg(all(feature = "apple-hp-media", not(feature = "apple-hp-media-static")))]
const LIBRARY: &[&str] = if cfg!(target_os = "macos") {
    &[
        "libfdk-aac.2.dylib",
        "/opt/homebrew/lib/libfdk-aac.2.dylib",
        "/usr/local/lib/libfdk-aac.2.dylib",
        "/opt/local/lib/libfdk-aac.2.dylib",
    ]
} else if cfg!(windows) {
    &["libfdk-aac-2.dll", r"C:\msys64\ucrt64\bin\libfdk-aac-2.dll"]
} else {
    &["libfdk-aac.so.2"]
};

/// How to get the library [`LIBRARY`] names, for the error that says it is missing.
#[cfg(all(feature = "apple-hp-media", not(feature = "apple-hp-media-static")))]
const INSTALL: &str = if cfg!(target_os = "macos") {
    "install it with `brew install fdk-aac`"
} else if cfg!(windows) {
    "install MSYS2's mingw-w64-ucrt-x86_64-fdk-aac, or put its libfdk-aac-2.dll beside \
     remotex.exe or on PATH"
} else {
    "install libfdk-aac2 (Debian's non-free, Ubuntu's multiverse) or your \
     distribution's fdk-aac"
};

/// fdk-aac, loaded from the system on the first call that finds it. A failure is
/// not remembered, so a library installed while the gateway runs is found by the
/// next session.
#[cfg(all(feature = "apple-hp-media", not(feature = "apple-hp-media-static")))]
fn api() -> anyhow::Result<&'static fdk::Api> {
    use anyhow::Context as _;

    static API: std::sync::OnceLock<fdk::Api> = std::sync::OnceLock::new();
    if let Some(api) = API.get() {
        return Ok(api);
    }
    let mut refused = Vec::new();
    for name in LIBRARY {
        // SAFETY: fdk-aac's initialisers set up nothing but its own tables.
        match unsafe { libloading::Library::new(*name) } {
            Ok(library) => {
                let api = resolve(library).with_context(|| format!("load fdk-aac from {name}"))?;
                return Ok(API.get_or_init(|| api));
            }
            Err(e) => refused.push(format!("{name}: {e}")),
        }
    }
    anyhow::bail!(
        "the AAC-ELD decoder, fdk-aac, is not installed: {INSTALL} ({})",
        refused.join("; ")
    )
}

#[cfg(all(feature = "apple-hp-media", not(feature = "apple-hp-media-static")))]
fn resolve(library: libloading::Library) -> anyhow::Result<fdk::Api> {
    // SAFETY: each symbol is typed as `aacdecoder_lib.h` declares it, and the
    // library is kept in the table the pointers are copied into.
    unsafe {
        Ok(fdk::Api {
            open: *library.get(b"aacDecoder_Open\0")?,
            config_raw: *library.get(b"aacDecoder_ConfigRaw\0")?,
            fill: *library.get(b"aacDecoder_Fill\0")?,
            decode_frame: *library.get(b"aacDecoder_DecodeFrame\0")?,
            stream_info: *library.get(b"aacDecoder_GetStreamInfo\0")?,
            close: *library.get(b"aacDecoder_Close\0")?,
            _library: library,
        })
    }
}

/// Load the decoder now: a session finds out before it dials the Mac that there
/// is none, and says why.
#[cfg(feature = "apple-hp-media")]
pub fn load() -> anyhow::Result<()> {
    api().map(|_| ())
}

/// One decoder for one stream's access units.
#[cfg(feature = "apple-hp-media")]
pub struct EldDecoder {
    api: &'static fdk::Api,
    handle: fdk::Handle,
    /// Scratch for one decoded frame; fdk-aac writes interleaved `i16`.
    pcm: Vec<i16>,
}

// SAFETY: the handle is used by one thread at a time, whichever owns this value;
// fdk-aac keeps no thread-local state.
#[cfg(feature = "apple-hp-media")]
unsafe impl Send for EldDecoder {}

#[cfg(feature = "apple-hp-media")]
impl EldDecoder {
    pub fn new() -> anyhow::Result<Self> {
        let api = api()?;
        // SAFETY: `open` returns a handle or null; the handle is closed by `Drop`.
        let handle = unsafe { (api.open)(fdk::TT_MP4_RAW, 1) };
        anyhow::ensure!(!handle.is_null(), "fdk-aac could not open an AAC-ELD decoder");
        let decoder = Self {
            api,
            handle,
            pcm: vec![0; FRAME_SAMPLES * CHANNELS],
        };
        let mut conf = AUDIO_SPECIFIC_CONFIG.as_ptr().cast_mut();
        let length = AUDIO_SPECIFIC_CONFIG.len() as std::os::raw::c_uint;
        // SAFETY: fdk-aac reads `length` bytes behind `conf` and only advances its
        // own copy of the pointer; it never writes through it.
        let status = unsafe { (api.config_raw)(handle, &mut conf, &length) };
        anyhow::ensure!(
            status == fdk::AAC_DEC_OK,
            "fdk-aac refused the AAC-ELD 48 kHz stereo 480-sample configuration (error {status:#x})"
        );
        Ok(decoder)
    }

    /// Decode one access unit into interleaved little-endian 16-bit PCM appended to
    /// `out`.
    ///
    /// A *concealed* frame — the decoder found the unit damaged and synthesised
    /// something plausible in its place — is still appended, because the alternative
    /// is a 10 ms hole where the decoder had already filled one. Only a frame the
    /// decoder could not produce at all is an error, and the caller keeps going: the
    /// next unit is independently decodable.
    pub fn decode(&mut self, access_unit: &[u8], out: &mut Vec<u8>) -> anyhow::Result<bool> {
        let mut buffer = access_unit.as_ptr().cast_mut();
        let size = access_unit.len() as std::os::raw::c_uint;
        let mut left = size;
        // SAFETY: as in `new`, fdk-aac copies the unit and advances only its own
        // pointer; `left` is set to what it did not take.
        let status = unsafe { (self.api.fill)(self.handle, &mut buffer, &size, &mut left) };
        anyhow::ensure!(status == fdk::AAC_DEC_OK, "fdk-aac refused an AAC-ELD access unit (error {status:#x})");
        anyhow::ensure!(
            left == 0,
            "the AAC-ELD decoder took {} of a {}-byte access unit",
            size - left,
            access_unit.len()
        );
        // SAFETY: `pcm` holds as many samples as it is said to.
        let status = unsafe {
            (self.api.decode_frame)(self.handle, self.pcm.as_mut_ptr(), self.pcm.len() as _, 0)
        };
        let concealed = match status {
            fdk::AAC_DEC_OK => false,
            status if fdk::CONCEALED.contains(&status) => true,
            status => anyhow::bail!("fdk-aac could not decode an AAC-ELD access unit (error {status:#x})"),
        };
        // SAFETY: the decoder has decoded a frame, so its stream information is set;
        // it is read before the next call can change it.
        let produced = unsafe {
            let info = &*(self.api.stream_info)(self.handle);
            (info.frame_size.max(0) as usize) * (info.num_channels.max(0) as usize)
        };
        let produced = produced.min(self.pcm.len());
        out.reserve(produced * 2);
        for sample in &self.pcm[..produced] {
            out.extend_from_slice(&sample.to_le_bytes());
        }
        Ok(concealed)
    }
}

#[cfg(feature = "apple-hp-media")]
impl Drop for EldDecoder {
    fn drop(&mut self) {
        // SAFETY: the handle came from `open` and is closed once.
        unsafe { (self.api.close)(self.handle) }
    }
}

#[cfg(all(test, feature = "apple-hp-media"))]
mod tests {
    use super::*;

    /// The configuration is accepted by the decoder that is actually linked — the
    /// one check that does not need a captured stream.
    #[test]
    fn the_audio_specific_config_is_accepted() {
        EldDecoder::new().expect("fdk-aac accepts the AAC-ELD 48 kHz stereo configuration");
    }

    /// The bit layout above, re-derived: the constant is the bytes and this is the
    /// arithmetic, so a wrong transcription of either shows up here.
    #[test]
    fn the_audio_specific_config_says_what_its_comment_says() {
        let mut bits = Vec::new();
        let mut push = |value: u32, width: u32| {
            for i in (0..width).rev() {
                bits.push(((value >> i) & 1) as u8);
            }
        };
        push(31, 5);
        push(39 - 32, 6);
        push(3, 4);
        push(2, 4);
        push(1, 1); // 480-sample frames
        push(0, 3); // resilience tools off
        push(0, 1); // no SBR
        push(0, 4); // ELDEXT_TERM
        while bits.len() % 8 != 0 {
            bits.push(0);
        }
        let bytes: Vec<u8> =
            bits.chunks(8).map(|byte| byte.iter().fold(0u8, |acc, b| (acc << 1) | b)).collect();
        assert_eq!(bytes, AUDIO_SPECIFIC_CONFIG);
    }

    /// Garbage is refused as a decode error rather than a panic, and the decoder is
    /// still usable afterwards.
    #[test]
    fn a_bad_access_unit_is_an_error_not_a_crash() {
        let mut decoder = EldDecoder::new().unwrap();
        let mut out = Vec::new();
        // Whatever this does — conceal or refuse — it must return.
        let _ = decoder.decode(&[0xff; 40], &mut out);
        let _ = decoder.decode(&[0x00; 40], &mut out);
    }
}
