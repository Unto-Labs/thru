use std::{env, fs, path::Path};

use vergen_gitcl::{BuildBuilder, CargoBuilder, Emitter, GitclBuilder};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    emit_release_identity()?;

    let build = BuildBuilder::default().build_timestamp(true).build()?;
    let cargo = CargoBuilder::default().build()?;
    let gitcl = GitclBuilder::default()
        .sha(true)
        .dirty(true)
        .describe(true, false, None)
        .build()?;

    Emitter::default()
        .add_instructions(&build)?
        .add_instructions(&cargo)?
        .add_instructions(&gitcl)?
        .emit()?;

    Ok(())
}

fn emit_release_identity() -> Result<(), Box<dyn std::error::Error>> {
    println!("cargo:rerun-if-env-changed=THRU_BUILD_VERSION");
    println!("cargo:rerun-if-env-changed=THRU_BUILD_CHANNEL");

    if let Ok(version) = env::var("THRU_BUILD_VERSION") {
        println!("cargo:rustc-env=THRU_BUILD_VERSION={version}");
        if let Ok(channel) = env::var("THRU_BUILD_CHANNEL") {
            println!("cargo:rustc-env=THRU_BUILD_CHANNEL={channel}");
        }
        return Ok(());
    }

    let manifest_dir = env::var("CARGO_MANIFEST_DIR")?;
    let vcs_info_path = Path::new(&manifest_dir).join(".cargo_vcs_info.json");
    if !vcs_info_path.exists() {
        return Ok(());
    }

    let vcs_info: serde_json::Value = serde_json::from_str(&fs::read_to_string(vcs_info_path)?)?;
    let Some(sha) = vcs_info
        .pointer("/git/sha1")
        .and_then(|value| value.as_str())
    else {
        return Ok(());
    };

    let package_version = env::var("CARGO_PKG_VERSION")?;
    let sha_short = &sha[..sha.len().min(8)];
    println!("cargo:rustc-env=THRU_BUILD_VERSION={package_version}+{sha_short}");
    println!("cargo:rustc-env=THRU_BUILD_CHANNEL=release");

    Ok(())
}
