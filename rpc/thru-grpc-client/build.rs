use std::{
    env,
    error::Error,
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use prost::Message;
use prost_types::FileDescriptorSet;
use tonic_prost_build as tonic_build;
use walkdir::WalkDir;

fn main() -> Result<(), Box<dyn Error>> {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR")?);
    let workspace_root = manifest_dir
        .parent()
        .and_then(Path::parent)
        .ok_or("failed to determine workspace root")?;
    let proto_root_local = manifest_dir.join("proto");
    let proto_root = if proto_root_local.exists() {
        proto_root_local
    } else {
        workspace_root.join("proto")
    };

    println!("cargo:rerun-if-env-changed=PROTOC");
    println!("cargo:rerun-if-env-changed=PROTOC_INCLUDE");
    println!("cargo:rerun-if-env-changed=BUF_CACHE_DIR");
    println!(
        "cargo:rerun-if-changed={}",
        manifest_dir.join("build.rs").display()
    );
    let buf_config_dir = if manifest_dir.join("buf.yaml").exists() {
        manifest_dir.clone()
    } else {
        workspace_root.to_path_buf()
    };
    println!(
        "cargo:rerun-if-changed={}",
        buf_config_dir.join("buf.yaml").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        buf_config_dir.join("buf.lock").display()
    );

    for entry in WalkDir::new(&proto_root).follow_links(true) {
        let entry = entry?;
        if entry.file_type().is_file()
            && entry.path().extension().and_then(|ext| ext.to_str()) == Some("proto")
        {
            println!("cargo:rerun-if-changed={}", entry.path().display());
        }
    }

    let out_dir = PathBuf::from(env::var("OUT_DIR")?);
    let descriptor_path = out_dir.join("thru_descriptor.bin");

    generate_descriptor(&buf_config_dir, &descriptor_path)?;

    let descriptor_bytes = fs::read(&descriptor_path)?;
    let mut descriptor = FileDescriptorSet::decode(descriptor_bytes.as_slice())?;
    for file in &mut descriptor.file {
        if matches!(file.syntax.as_deref(), Some("editions")) {
            file.syntax = Some("proto3".to_string());
        }
    }

    tonic_build::configure()
        .build_client(true)
        .build_server(false)
        .compile_fds(descriptor)?;

    Ok(())
}

fn generate_descriptor(workspace_root: &Path, output: &Path) -> Result<(), Box<dyn Error>> {
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }

    let status = Command::new("buf")
        .current_dir(workspace_root)
        .arg("build")
        .arg("--output")
        .arg(output)
        .status();

    match status {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(format!(
            "buf build failed with status {status:?}. Ensure buf is installed and dependencies are fetched with `buf dep update`."
        )
        .into()),
        Err(err) => {
            if err.kind() == std::io::ErrorKind::NotFound {
                Err(format!(
                    "buf is not installed. Please install buf from https://buf.build/docs/cli/installation/"
                ).into())
            } else {
                Err(format!("failed to execute buf build: {err}").into())
            }
        }
    }
}
