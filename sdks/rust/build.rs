use std::{env, fs, path::PathBuf};

fn copy_linker_script() {
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    let dest_path = out_dir.join("link.x");

    let content = fs::read_to_string("link.x.in").unwrap();
    fs::write(dest_path, content).unwrap();

    println!("cargo:rustc-link-search={}", out_dir.display());
    println!("cargo:rerun-if-changed=link.x.in");
}

fn main() {
    copy_linker_script();
}
