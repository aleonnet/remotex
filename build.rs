use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result, bail, ensure};

const PREBUILT_FRONTEND: &str = "REMOTEX_PREBUILT_FRONTEND";

/// The EXPERIMENTAL software HEVC decoder the `hevc-wasm` feature serves at
/// `/hevc/` (src/assets.rs): a release of andrewtheguy/hevc-wasm, pinned by its
/// version and its archive's SHA-256, or a local build's directory.
const HEVC_WASM_VERSION: &str = "0.1.0";
const HEVC_WASM_SHA256: &str =
    "4a1a758d5157a53e5478982d2a0e2658de31e3a8955496e1c003eaf61a5906f4";
const HEVC_WASM_DIR: &str = "REMOTEX_HEVC_WASM_DIR";
const HEVC_WASM_FILES: [&str; 2] = ["hevc.js", "hevc.wasm"];

fn main() -> Result<()> {
    println!("cargo:rerun-if-env-changed={PREBUILT_FRONTEND}");

    let root = PathBuf::from(
        env::var_os("CARGO_MANIFEST_DIR").context("Cargo did not set CARGO_MANIFEST_DIR")?,
    );
    let output = PathBuf::from(env::var_os("OUT_DIR").context("Cargo did not set OUT_DIR")?)
        .join("frontend-dist");

    if let Some(prebuilt) = env::var_os(PREBUILT_FRONTEND) {
        let prebuilt = PathBuf::from(prebuilt);
        ensure!(
            !prebuilt.as_os_str().is_empty(),
            "{PREBUILT_FRONTEND} must name the directory containing index.html"
        );
        let prebuilt = if prebuilt.is_absolute() {
            prebuilt
        } else {
            root.join(prebuilt)
        };
        println!("cargo:rerun-if-changed={}", prebuilt.display());
        replace_dir(&prebuilt, &output).with_context(|| {
            format!(
                "failed to stage the prebuilt frontend from {}",
                prebuilt.display()
            )
        })?;
    } else {
        build_frontend(&root, &output)?;
    }

    ensure!(
        output.join("index.html").is_file(),
        "frontend build produced no {}",
        output.join("index.html").display()
    );

    if env::var_os("CARGO_FEATURE_HEVC_WASM").is_some() {
        let out = PathBuf::from(env::var_os("OUT_DIR").context("Cargo did not set OUT_DIR")?);
        stage_hevc_wasm(&root, &out).context("failed to stage the hevc-wasm decoder")?;
    }
    Ok(())
}

/// Put `hevc.js` and `hevc.wasm` in `OUT_DIR/hevc-wasm`: from `REMOTEX_HEVC_WASM_DIR`
/// when it names a local build, or else from the pinned release, downloaded once
/// and checked against its SHA-256.
fn stage_hevc_wasm(root: &Path, out: &Path) -> Result<()> {
    println!("cargo:rerun-if-env-changed={HEVC_WASM_DIR}");
    let staged = out.join("hevc-wasm");
    if staged.exists() {
        fs::remove_dir_all(&staged)
            .with_context(|| format!("failed to remove {}", staged.display()))?;
    }
    fs::create_dir_all(&staged)
        .with_context(|| format!("failed to create {}", staged.display()))?;

    if let Some(local) = env::var_os(HEVC_WASM_DIR) {
        let local = root.join(PathBuf::from(local));
        for file in HEVC_WASM_FILES {
            let from = local.join(file);
            println!("cargo:rerun-if-changed={}", from.display());
            fs::copy(&from, staged.join(file)).with_context(|| {
                format!("failed to copy {} ({HEVC_WASM_DIR})", from.display())
            })?;
        }
        return Ok(());
    }

    let name = format!("hevc-wasm-v{HEVC_WASM_VERSION}.tar.gz");
    let archive = out.join(&name);
    if !archive.is_file() || sha256_hex(&archive)? != HEVC_WASM_SHA256 {
        let url = format!(
            "https://github.com/andrewtheguy/hevc-wasm/releases/download/v{HEVC_WASM_VERSION}/{name}"
        );
        let status = Command::new("curl")
            .args(["-fsSL", "--retry", "3", "-o"])
            .arg(&archive)
            .arg(&url)
            .status()
            .context("failed to run curl")?;
        ensure!(status.success(), "curl failed to download {url}");
        let got = sha256_hex(&archive)?;
        ensure!(
            got == HEVC_WASM_SHA256,
            "{url} has SHA-256 {got}, not the pinned {HEVC_WASM_SHA256}"
        );
    }
    let status = Command::new("tar")
        .arg("-xzf")
        .arg(&archive)
        .arg("-C")
        .arg(&staged)
        .args(HEVC_WASM_FILES)
        .status()
        .context("failed to run tar")?;
    ensure!(status.success(), "tar failed to unpack {}", archive.display());
    Ok(())
}

fn sha256_hex(path: &Path) -> Result<String> {
    use sha2::{Digest, Sha256};
    use std::fmt::Write as _;

    let bytes = fs::read(path).with_context(|| format!("failed to read {}", path.display()))?;
    let mut hex = String::with_capacity(64);
    for byte in Sha256::digest(&bytes) {
        write!(hex, "{byte:02x}").expect("writing to a String cannot fail");
    }
    Ok(hex)
}

fn build_frontend(root: &Path, output: &Path) -> Result<()> {
    for path in [
        "Cargo.toml",
        "frontend/src",
        "frontend/index.html",
        "frontend/package.json",
        "frontend/bun.lock",
        "frontend/tsconfig.json",
        "frontend/tsconfig.app.json",
        "frontend/tsconfig.node.json",
        "frontend/vite.config.ts",
        // The page's compositor for a passed graphics pipeline, built to
        // WebAssembly (frontend/wasm/egfx) from the crate the gateway composes
        // with. The binding's files are named one by one: its directory also
        // holds what the build writes.
        "frontend/wasm/egfx/Cargo.toml",
        "frontend/wasm/egfx/Cargo.lock",
        "frontend/wasm/egfx/.cargo/config.toml",
        "frontend/wasm/egfx/src",
        "crates/remotex-rdp-graphics/Cargo.toml",
        "crates/remotex-rdp-graphics/src",
    ] {
        println!("cargo:rerun-if-changed={path}");
    }

    let frontend_dir = root.join("frontend");
    let mut bun = Command::new("bun");
    bun.args(["run", "build"]).current_dir(&frontend_dir).env("REMOTEX_FRONTEND_OUT_DIR", output);
    // The frontend's build runs Cargo for its WebAssembly module, and that Cargo
    // must not take this one's for its own: the flags and wrappers this build was
    // given are for the gateway's target — under `cargo clippy` the wrapper *is*
    // clippy — the job server's descriptors are not passed down, and a target
    // directory shared with the build that is waiting on this script is a lock
    // neither would ever be given.
    for inherited in [
        "CARGO_BUILD_TARGET",
        "CARGO_ENCODED_RUSTFLAGS",
        "CARGO_MAKEFLAGS",
        "CLIPPY_ARGS",
        "CLIPPY_CONF_DIR",
        "MAKEFLAGS",
        "MFLAGS",
        "RUSTC_WORKSPACE_WRAPPER",
        "RUSTDOCFLAGS",
        "RUSTFLAGS",
    ] {
        bun.env_remove(inherited);
    }
    bun.env("CARGO_TARGET_DIR", frontend_dir.join("wasm/egfx/target"));
    let status = bun
        .status()
        .context("failed to run `bun run build` for the frontend")?;
    ensure!(status.success(), "`bun run build` for the frontend failed");
    Ok(())
}

fn replace_dir(source: &Path, destination: &Path) -> Result<()> {
    ensure!(
        source.join("index.html").is_file(),
        "{} contains no index.html",
        source.display()
    );
    if destination.exists() {
        fs::remove_dir_all(destination)
            .with_context(|| format!("failed to remove {}", destination.display()))?;
    }
    copy_dir(source, destination)
}

fn copy_dir(source: &Path, destination: &Path) -> Result<()> {
    fs::create_dir_all(destination)
        .with_context(|| format!("failed to create {}", destination.display()))?;
    for entry in fs::read_dir(source)
        .with_context(|| format!("failed to read {}", source.display()))?
    {
        let entry =
            entry.with_context(|| format!("failed to read an entry in {}", source.display()))?;
        let file_type = entry
            .file_type()
            .with_context(|| format!("failed to inspect {}", entry.path().display()))?;
        let target = destination.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), &target).with_context(|| {
                format!(
                    "failed to copy {} to {}",
                    entry.path().display(),
                    target.display()
                )
            })?;
        } else {
            bail!(
                "prebuilt frontend contains unsupported entry {}",
                entry.path().display()
            );
        }
    }
    Ok(())
}
