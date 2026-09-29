//! FFmpeg's libavcodec and libavutil, which decode High Performance's HEVC
//! picture (`vnc_apple_media::Hevc`).
//!
//! The gateway loads the system's shared libraries the first time a session
//! needs them (see [`load`]): FFmpeg 6.1 to 9, libavcodec 60 to 63
//! with the libavutil each was released with, so no build compiles or links
//! FFmpeg. `apple-hp-media-static` links `libavcodec-hevc-prebuilt`'s private
//! static archives instead. Either way the calls below are the whole interface.
//!
//! Those releases lay their structures out differently, so this reads none past
//! the fields every one of them puts at the same place, the heads of `AVFrame`
//! and `AVPacket` ([`Frame`], [`Packet`]). The codec context is set and read
//! through AVOptions, by name, save `hw_device_ctx` on macOS, which has no option
//! and whose place is known per major ([`hw_device_ctx`]). Pixel formats and the
//! codec are looked up by name too.

use std::ffi::{c_char, c_int, c_uint, c_void};

/// `AV_LOG_QUIET`.
pub const LOG_QUIET: c_int = -8;

/// `AVERROR(EAGAIN)`: the decoder wants another unit before it has a picture.
pub const EAGAIN: c_int = if cfg!(target_os = "macos") { -35 } else { -11 };

/// `AVCOL_RANGE_JPEG`: full-range samples.
pub const RANGE_FULL: i64 = 2;

/// `AV_ERROR_MAX_STRING_SIZE`.
pub const ERROR_TEXT: usize = 64;

/// The head of `AVFrame`, the same in FFmpeg 6.1 to 9.
#[repr(C)]
pub struct Frame {
    pub data: [*mut u8; 8],
    pub linesize: [c_int; 8],
    _extended_data: *mut *mut u8,
    pub width: c_int,
    pub height: c_int,
    _nb_samples: c_int,
    pub format: c_int,
}

/// The head of `AVPacket`, the same in FFmpeg 6.1 to 9.
#[repr(C)]
pub struct Packet {
    _buf: *mut c_void,
    _pts: i64,
    _dts: i64,
    pub data: *mut u8,
    pub size: c_int,
}

/// Which library each call is in, for loading it.
#[cfg(not(feature = "apple-hp-media-static"))]
#[derive(Clone, Copy)]
enum Lib {
    Avcodec,
    Avutil,
}

/// Declares the calls once: the table's fields, and either the static archive's
/// symbols or the names looked up in the loaded libraries.
macro_rules! calls {
    ($($from:ident fn $name:ident($($arg:ident: $ty:ty),*) $(-> $ret:ty)?;)*) => {
        pub struct Api {
            $(pub $name: unsafe extern "C" fn($($ty),*) $(-> $ret)?,)*
            /// Keeps the loaded libraries mapped for as long as the pointers above
            /// live.
            #[cfg(not(feature = "apple-hp-media-static"))]
            _libraries: [libloading::Library; 2],
        }

        #[cfg(feature = "apple-hp-media-static")]
        unsafe extern "C" {
            $(fn $name($($arg: $ty),*) $(-> $ret)?;)*
        }

        #[cfg(feature = "apple-hp-media-static")]
        static STATIC: Api = Api { $($name,)* };

        #[cfg(not(feature = "apple-hp-media-static"))]
        fn resolve(avcodec: libloading::Library, avutil: libloading::Library) -> anyhow::Result<Api> {
            use anyhow::Context as _;
            let pick = |lib: Lib| match lib {
                Lib::Avcodec => &avcodec,
                Lib::Avutil => &avutil,
            };
            // SAFETY: each symbol is typed as FFmpeg's headers declare it, the same
            // in every release loaded, and the libraries are kept in the table the
            // pointers are copied into.
            let api = unsafe {
                Api {
                    $($name: *pick(Lib::$from)
                        .get(concat!(stringify!($name), "\0").as_bytes())
                        .context(stringify!($name))?,)*
                    _libraries: [avcodec, avutil],
                }
            };
            // Moving the libraries into the table leaves the pointers as they were.
            Ok(api)
        }
    };
}

calls! {
    Avcodec fn avcodec_version() -> c_uint;
    Avcodec fn avcodec_find_decoder_by_name(name: *const c_char) -> *const c_void;
    Avcodec fn avcodec_alloc_context3(codec: *const c_void) -> *mut c_void;
    Avcodec fn avcodec_open2(ctx: *mut c_void, codec: *const c_void, options: *mut *mut c_void) -> c_int;
    Avcodec fn avcodec_send_packet(ctx: *mut c_void, packet: *const Packet) -> c_int;
    Avcodec fn avcodec_receive_frame(ctx: *mut c_void, frame: *mut Frame) -> c_int;
    Avcodec fn avcodec_free_context(ctx: *mut *mut c_void);
    Avcodec fn av_packet_alloc() -> *mut Packet;
    Avcodec fn av_packet_free(packet: *mut *mut Packet);
    Avutil fn avutil_version() -> c_uint;
    Avutil fn av_log_set_level(level: c_int);
    Avutil fn av_strerror(err: c_int, text: *mut c_char, size: usize) -> c_int;
    Avutil fn av_frame_alloc() -> *mut Frame;
    Avutil fn av_frame_free(frame: *mut *mut Frame);
    Avutil fn av_frame_unref(frame: *mut Frame);
    Avutil fn av_get_pix_fmt(name: *const c_char) -> c_int;
    Avutil fn av_get_pix_fmt_name(format: c_int) -> *const c_char;
    Avutil fn av_opt_set(obj: *mut c_void, name: *const c_char, value: *const c_char, search: c_int) -> c_int;
    Avutil fn av_opt_get_int(obj: *mut c_void, name: *const c_char, search: c_int, value: *mut i64) -> c_int;
    Avutil fn av_hwdevice_find_type_by_name(name: *const c_char) -> c_int;
    Avutil fn av_hwdevice_ctx_create(
        device: *mut *mut c_void,
        kind: c_int,
        name: *const c_char,
        options: *mut c_void,
        flags: c_int
    ) -> c_int;
    Avutil fn av_hwframe_transfer_data(dst: *mut Frame, src: *const Frame, flags: c_int) -> c_int;
    Avutil fn av_buffer_ref(buffer: *const c_void) -> *mut c_void;
    Avutil fn av_buffer_unref(buffer: *mut *mut c_void);
}

/// Linked from `libavcodec-hevc-prebuilt-sys`, whose build script supplies the
/// archives.
#[cfg(feature = "apple-hp-media-static")]
use avcodec_hevc_sys as _;

/// FFmpeg, from the static archives linked into this build.
#[cfg(feature = "apple-hp-media-static")]
pub fn api() -> anyhow::Result<&'static Api> {
    Ok(&STATIC)
}

/// The libavcodec majors loaded, newest first. Each is paired with the libavutil
/// released with it, two majors behind.
#[cfg(not(feature = "apple-hp-media-static"))]
const MAJORS: [u32; 4] = [63, 62, 61, 60];

/// Where the libraries are looked for, in order. The empty prefix is the platform
/// loader's own search; the others are where Homebrew, MacPorts and MSYS2 install
/// FFmpeg, which that search does not reach.
#[cfg(not(feature = "apple-hp-media-static"))]
const DIRS: &[&str] = if cfg!(target_os = "macos") {
    &["", "/opt/homebrew/lib/", "/usr/local/lib/", "/opt/local/lib/"]
} else if cfg!(windows) {
    &["", r"C:\msys64\ucrt64\bin\"]
} else {
    &[""]
};

/// The files of one libavcodec major and its libavutil, in `dir`.
#[cfg(not(feature = "apple-hp-media-static"))]
fn files(dir: &str, major: u32) -> [String; 2] {
    let util = major - 2;
    if cfg!(target_os = "macos") {
        [format!("{dir}libavcodec.{major}.dylib"), format!("{dir}libavutil.{util}.dylib")]
    } else if cfg!(windows) {
        [format!("{dir}avcodec-{major}.dll"), format!("{dir}avutil-{util}.dll")]
    } else {
        [format!("{dir}libavcodec.so.{major}"), format!("{dir}libavutil.so.{util}")]
    }
}

/// How to get what [`files`] names, for the error that says it is missing.
#[cfg(not(feature = "apple-hp-media-static"))]
const INSTALL: &str = if cfg!(target_os = "macos") {
    "install it with `brew install ffmpeg`"
} else if cfg!(windows) {
    "install MSYS2's mingw-w64-ucrt-x86_64-ffmpeg, or put a shared FFmpeg build's bin \
     directory on PATH"
} else {
    "install your distribution's libavcodec, libavcodec60 to libavcodec63"
};

/// Open one library. On Windows a DLL named by its path finds the DLLs it needs
/// beside it, as MSYS2's FFmpeg does in its `bin`.
#[cfg(not(feature = "apple-hp-media-static"))]
fn open(file: &str) -> Result<libloading::Library, libloading::Error> {
    // SAFETY: FFmpeg's initialisers set up nothing but its own tables.
    unsafe {
        #[cfg(windows)]
        if file.contains('\\') {
            return libloading::os::windows::Library::load_with_flags(
                file,
                libloading::os::windows::LOAD_WITH_ALTERED_SEARCH_PATH,
            )
            .map(Into::into);
        }
        libloading::Library::new(file)
    }
}

/// FFmpeg, loaded from the system on the first call that finds it. A failure is
/// not remembered, so a library installed while the gateway runs is found by the
/// next session.
#[cfg(not(feature = "apple-hp-media-static"))]
pub fn api() -> anyhow::Result<&'static Api> {
    use anyhow::Context as _;

    static API: std::sync::OnceLock<Api> = std::sync::OnceLock::new();
    if let Some(api) = API.get() {
        return Ok(api);
    }
    let mut refused = Vec::new();
    for dir in DIRS {
        for major in MAJORS {
            let [avcodec, avutil] = files(dir, major);
            let library = match open(&avcodec) {
                Ok(library) => library,
                Err(e) => {
                    refused.push(format!("{avcodec}: {e}"));
                    continue;
                }
            };
            let api = match open(&avutil)
                .map_err(anyhow::Error::new)
                .and_then(|util| resolve(library, util))
                .with_context(|| format!("load FFmpeg from {avcodec} and {avutil}"))
            {
                Ok(api) => api,
                Err(e) => {
                    refused.push(format!("{e:#}"));
                    continue;
                }
            };
            // SAFETY: plain version queries.
            let versions = unsafe { ((api.avcodec_version)(), (api.avutil_version)()) };
            if versions.0 >> 16 != major || versions.1 >> 16 != major - 2 {
                refused.push(format!(
                    "{avcodec} and {avutil} report libavcodec {} and libavutil {}",
                    dotted(versions.0),
                    dotted(versions.1)
                ));
                continue;
            }
            log::info!("vnc: the HEVC decoder is libavcodec {}, from {avcodec}", dotted(versions.0));
            return Ok(API.get_or_init(|| api));
        }
    }
    anyhow::bail!(
        "the HEVC decoder, FFmpeg's libavcodec, is not installed: {INSTALL} ({})",
        refused.join("; ")
    )
}

#[cfg(not(feature = "apple-hp-media-static"))]
fn dotted(version: c_uint) -> String {
    format!("{}.{}.{}", version >> 16, (version >> 8) & 0xff, version & 0xff)
}

/// Load the decoder now: a session finds out before it dials the Mac that there
/// is none, and says why.
pub fn load() -> anyhow::Result<()> {
    api().map(|_| ())
}

/// Where `AVCodecContext::hw_device_ctx` is in the loaded libavcodec, read from
/// the headers of FFmpeg 6.1, 7.1, 8.0 and 9.0 for a 64-bit target: 864 bytes in
/// 60, and 560 since. `None` for any other major, which then decodes in software.
#[cfg(target_os = "macos")]
pub fn hw_device_ctx(api: &Api) -> Option<usize> {
    // SAFETY: a plain version query.
    match unsafe { (api.avcodec_version)() } >> 16 {
        60 => Some(864),
        61..=63 => Some(560),
        _ => None,
    }
}
