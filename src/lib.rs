//! remotex — a browser-based RDP client.
//!
//! The library exposes the pieces the binary wires together and that the
//! integration tests exercise at the protocol level. See docs/architecture.md.

pub mod aac_eld;
pub mod assets;
pub mod audio;
pub mod auth;
pub mod camera;
pub mod cli;
pub mod config;
#[cfg(feature = "embedded-gateway")]
pub mod embedded;
pub mod encode;
pub mod engine;
pub mod error;
pub mod feedback;
pub mod keymap;
pub mod libav;
pub mod mic;
pub mod opus_stream;
pub mod pcm48;
pub mod protocol;
pub mod rdp;
pub mod rdp_camera;
pub mod rdp_client;
pub mod rdp_clipboard;
pub mod rdp_mic;
pub mod server;
pub mod session;
pub mod shadow;
pub mod stream;
pub mod throughput;
pub mod video;
pub mod vnc;
pub mod vnc_apple;
pub mod vnc_apple_clipboard;
pub mod vnc_apple_media;
pub mod vnc_audio;
pub mod vnc_camera;
pub mod vnc_clipboard;
pub mod vnc_encodings;
pub mod vnc_mic;
pub mod vnc_record;
pub mod vnc_rsa_aes;
pub mod vp9;
pub mod wire;
pub mod ws;

/// THIRD-PARTY-NOTICES.txt names the lockfiles it was made from, so a dependency
/// change fails here until packaging/third-party-notices.py has run again.
#[cfg(test)]
mod third_party_notices {
    use sha2::{Digest, Sha256};

    /// The script's `lock_digest`: a lockfile's SHA-256, less the entry of the
    /// package it locks, whose version moves with every release.
    fn lock_digest(lock: &str, own: Option<&str>) -> String {
        let lock = lock.replace('\r', "");
        let head = own.map(|own| format!("[[package]]\nname = \"{own}\"\n"));
        let kept: Vec<&str> = lock
            .split("\n\n")
            .filter(|block| head.as_deref().is_none_or(|head| !block.starts_with(head)))
            .collect();
        Sha256::digest(kept.join("\n\n")).iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn the_notices_are_the_locked_dependencies() {
        let notices = include_str!("../THIRD-PARTY-NOTICES.txt");
        for (name, lock, own) in [
            ("Cargo.lock", include_str!("../Cargo.lock"), Some("remotex")),
            ("frontend/bun.lock", include_str!("../frontend/bun.lock"), None),
        ] {
            let line = format!("  {name:<17} {}", lock_digest(lock, own));
            assert!(
                notices.lines().any(|l| l == line),
                "THIRD-PARTY-NOTICES.txt was not made from this {name}: \
                 run `uv run --python 3.13 packaging/third-party-notices.py`"
            );
        }
    }
}
