/* Go backend: one Go package per ABI package plus a shared runtime package.

Output layout (rooted at the codegen output directory):

  go.mod                     `module <module>` (`--go-module`, default `abigen`)
  tnabi/runtime.go           package tnabi: errors, checked math, byte sources
  <a>/<b>/<c>/types.go       package c: ABI package `a.b.c`

Generated packages import the runtime as `<module>/tnabi` and each other as
`<module>/<a>/<b>/<c>`. See `docs/go-codegen.md`. */

use crate::abi::resolved::{ResolvedType, ResolvedTypeKind, TypeResolver};
use crate::codegen::go_gen::emit::{GoEmitter, qualifier_marker};
use crate::codegen::go_gen::ir::calls_buffer_sized;
use crate::codegen::go_gen::names::*;
use crate::codegen::go_gen::pkgnames::VNames;
use crate::codegen::rust::static_ir_helpers_supported;
use crate::codegen::rust_gen::model::Model;
use crate::codegen::shared::builder::IrBuilder;
use crate::codegen::shared::package_paths::{PathRules, package_paths};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fmt::Write;
use std::path::Path;

/* Source of the shared runtime package. */
pub const RUNTIME_GO: &str = include_str!("go_gen/runtime_template.go");

/* Directory (and package name) of the shared runtime. */
pub const RUNTIME_DIR: &str = "tnabi";

/* Module path used when `--go-module` is not given. */
pub const DEFAULT_MODULE: &str = "abigen";

/* `go` directive of the generated go.mod (generics, `clear`). */
pub const GO_VERSION: &str = "1.21";

/* Write `go.mod` and the runtime package at the output root. */
pub fn write_root(output_dir: &Path, module: &str) -> std::io::Result<()> {
    std::fs::create_dir_all(output_dir.join(RUNTIME_DIR))?;
    std::fs::write(
        output_dir.join("go.mod"),
        format!("module {module}\n\ngo {GO_VERSION}\n"),
    )?;
    std::fs::write(output_dir.join(RUNTIME_DIR).join("runtime.go"), RUNTIME_GO)
}

/* One directory segment for a package-name segment: characters outside
`[A-Za-z0-9_-]` become `_`, and a segment the go tool would ignore or reject
(empty, or starting with `_` / `-`) gets an `x` prefix. */
fn dir_segment(seg: &str) -> String {
    let mut s: String = seg
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if s.is_empty() || s.starts_with(['_', '-']) {
        s.insert(0, 'x');
    }
    s
}

/* Directories (relative to the output root) of the packages of one run:
`a.b.c` -> `a/b/c`, by the shared rule (`shared::package_paths`): distinct
packages get distinct directories even on a case-insensitive file system
(`cases.Foo` -> `cases/Foo`, `cases.foo` -> `cases/foo_`), and none takes
the runtime's (an ABI package `tnabi` -> `tnabi_`). Importers compute the
same map from the same set. */
pub fn package_dirs<'p>(packages: impl IntoIterator<Item = &'p String>) -> HashMap<String, String> {
    package_paths(
        packages,
        &PathRules {
            segment: dir_segment,
            root_reserved: &[RUNTIME_DIR],
            child_reserved: &[],
        },
    )
    .into_iter()
    .map(|(p, segs)| (p, segs.join("/")))
    .collect()
}

/* Directory of a package generated on its own (see `package_dirs`). */
pub fn package_dir(package: &str) -> String {
    let p = package.to_string();
    package_dirs([&p]).remove(&p).unwrap_or_default()
}

/* Emit `types.go` for one ABI package. `pkg_of` maps every resolved type name
of the run to its ABI package. */
pub fn emit_package(
    resolver: &TypeResolver,
    package: &str,
    types: &[&ResolvedType],
    pkg_of: &HashMap<String, String>,
    module: &str,
) -> String {
    let model = Model::new(resolver);
    let ge = GoEmitter::new(&model, package, pkg_of.clone());
    let ir_builder = IrBuilder::new(resolver);
    let mut ir_cache = BTreeMap::new();
    let mut body = String::new();
    for ty in types {
        match &ty.kind {
            ResolvedTypeKind::Primitive { prim_type } => {
                let _ = writeln!(body, "/* Type: {} */", one_line(&ty.name));
                let _ = writeln!(body, "type {} = {}\n", ge.gn(ty), go_prim(prim_type));
            }
            ResolvedTypeKind::TypeRef { target_name, .. } => {
                emit_alias(&ge, &model, ty, target_name, &mut body);
            }
            _ => {
                model.collect_named(&ty.name);
                for cell in model.views_of_root(&ty.name) {
                    let name = cell.borrow().name.clone();
                    let Some(info) = ge.info(&name) else {
                        continue;
                    };
                    ge.emit_view(&info, &mut body);
                    ge.emit_builder(&info, &mut body);
                }
            }
        }
        /* IR-derived free functions, for the types C and Rust emit them for. */
        if let Ok(ir) = ir_builder.build_type(ty) {
            if static_ir_helpers_supported(
                &ir_builder,
                &ir.type_name,
                &mut ir_cache,
                &mut BTreeSet::new(),
            ) && !calls_buffer_sized(&ir_builder, &ir, 0)
            {
                if let Some(code) = ge.emit_ir_fns(&ir) {
                    body.push_str(&code);
                }
            }
        }
    }
    let imports = ge.take_imports();
    /* Directories of every package of the run, and one import name per
    imported package (sorted; `_` appended to a name already taken), put in
    place of the qualifiers the emitter wrote. */
    let mut run_packages: Vec<String> = pkg_of.values().cloned().collect();
    run_packages.push(package.to_string());
    let dirs = package_dirs(&run_packages);
    let mut taken: HashSet<String> = HashSet::from(["tnabi".to_string()]);
    let mut aliases: Vec<(String, String)> = Vec::new();
    for p in &imports {
        let mut a = package_alias(p);
        while taken.contains(&a) {
            a.push('_');
        }
        taken.insert(a.clone());
        body = body.replace(&qualifier_marker(p), &a);
        aliases.push((p.clone(), a));
    }
    let mut out = String::new();
    out.push_str("// Code generated by abi-gen. DO NOT EDIT.\n\n");
    let _ = writeln!(
        out,
        "// Package {} holds the bindings of ABI package `{}`.",
        package_name(package),
        one_line(package)
    );
    let _ = writeln!(out, "package {}\n", package_name(package));
    let uses_runtime = body.contains("tnabi.");
    if uses_runtime || !imports.is_empty() {
        /* Sorted by path, as gofmt does. */
        let mut specs: Vec<(String, String)> = aliases
            .iter()
            .map(|(p, a)| (format!("{module}/{}", dirs[p]), a.clone()))
            .collect();
        if uses_runtime {
            specs.push((format!("{module}/{RUNTIME_DIR}"), "tnabi".to_string()));
        }
        specs.sort();
        out.push_str("import (\n");
        for (path, alias) in specs {
            let _ = writeln!(out, "\t{alias} \"{path}\"");
        }
        out.push_str(")\n\n");
    }
    out.push_str(&body);
    gofmt_lite(&out)
}

/* The layout `gofmt` gives the emitted code: one-line function bodies are
expanded and consecutive struct fields are aligned. */
pub fn gofmt_lite(src: &str) -> String {
    let mut out = String::with_capacity(src.len() + src.len() / 8);
    let mut in_struct = false;
    let mut block: Vec<(String, String)> = Vec::new();
    let flush = |block: &mut Vec<(String, String)>, out: &mut String| {
        let w = block.iter().map(|(n, _)| n.len()).max().unwrap_or(0);
        for (n, t) in block.drain(..) {
            let _ = writeln!(out, "\t{n:<w$} {t}");
        }
    };
    for line in src.lines() {
        if in_struct {
            let field = line
                .strip_prefix('\t')
                .filter(|f| !f.starts_with('\t') && !f.starts_with("//"))
                .and_then(|f| f.split_once(' '));
            if let Some((n, t)) = field {
                block.push((n.to_string(), t.trim_start().to_string()));
                continue;
            }
            flush(&mut block, &mut out);
            if line == "}" {
                in_struct = false;
            }
        } else if line.starts_with("type ") && line.ends_with(" struct {") {
            in_struct = true;
        } else if line.starts_with("func ") && line.ends_with(" }") {
            if let Some(i) = line.find(" { ") {
                let _ = writeln!(out, "{} {{", &line[..i]);
                let _ = writeln!(out, "\t{}", line[i + 3..line.len() - 2].trim_end());
                out.push_str("}\n");
                continue;
            }
        }
        out.push_str(line);
        out.push('\n');
    }
    flush(&mut block, &mut out);
    while out.ends_with("\n\n") {
        out.pop();
    }
    out
}

/* A named type that is another name for an existing type. */
fn emit_alias(
    ge: &GoEmitter<'_, '_>,
    model: &Model<'_>,
    ty: &ResolvedType,
    target: &str,
    out: &mut String,
) {
    let an = ge.vnames_of(&ty.name);
    let name = an.ty.clone();
    let Some(target_ty) = model.named(target).map(|t| model.deref(t)) else {
        return;
    };
    let _ = writeln!(
        out,
        "/* Type: {} (alias of {}) */",
        one_line(&ty.name),
        one_line(target)
    );
    if let ResolvedTypeKind::Primitive { prim_type } = &target_ty.kind {
        let _ = writeln!(out, "type {name} = {}\n", go_prim(prim_type));
        return;
    }
    model.collect_named(&target_ty.name);
    let Some(info) = ge.info(&target_ty.name) else {
        return;
    };
    let t = ge.qn(target_ty);
    let tq = |pick: fn(&VNames) -> &String| ge.qname(target_ty, pick);
    let tg = ge.gn(target_ty);
    let _ = writeln!(out, "type {name} = {t}");
    let _ = writeln!(out, "type {} = {}", an.ext, tq(|v| &v.ext));
    if ge.r.has_params(&info) {
        let _ = writeln!(out, "type {} = {}", an.params, tq(|v| &v.params));
    }
    if ge.builder_kind(&info).is_some() {
        let _ = writeln!(out, "type {} = {}", an.builder, tq(|v| &v.builder));
    }
    out.push('\n');
    if !info.has_ext() {
        let (parse, validate) = (&an.parse, &an.validate);
        let _ = writeln!(out, "// {parse} validates b as a {name} (alias of {tg}).");
        let _ = writeln!(
            out,
            "func {parse}(b []byte) ({name}, error) {{ return {}(b) }}",
            tq(|v| &v.parse)
        );
        out.push('\n');
        let _ = writeln!(
            out,
            "// {validate} validates b as a {name} and returns the consumed size."
        );
        let _ = writeln!(
            out,
            "func {validate}(b []byte) (int, error) {{ return {}(b) }}",
            tq(|v| &v.validate)
        );
        out.push('\n');
    }
}
