/* Module-level Rust names.

Every module-level item of a generated package (the view type `T` and its
`TView` / `TMut` / `T__Ext` / `T__layout` / `TParams` / `TBuilder` /
`TOwned` companions, the typed enum `T<F>Ref` / `T<F>RefMut` of each enum or
size-discriminated slot, and the `t_footprint_ir_checked` / `t_footprint_ir` /
`t_validate_ir` free functions) is allocated in one table per ABI package, so
declared ABI types and generated items can never collide (`MessageBuilder`
and the builder of `Message`; `foo` and `Foo`, whose IR helpers are both
`foo_...`). The table depends only on the package's types, so every package
of a run computes the same names for the types it references. Rule, in this
order, appending `_` to a name already taken:

0. every item of the generated runtime (`AbiError`, `TnBuf`, `VariantInfo`,
   `tn_expect`, ...), read from the runtime template itself:
   `functions.rs` glob-imports both `types::*` and `runtime::*`, so a
   declared `AbiError` becomes `AbiError_`;
1. the declared types of the package, sorted by ABI name;
2. their inline views (`T_field...`), in model order (a declared `A_b`
   keeps `A_b`; the inline view of field `b` of `A` becomes `A_b_`);
3. `TView` and `TMut` of every type (same order: each declared type, then its
   inline views);
4. the other items of each type (same order): `T__Ext`, `T__layout`,
   `TParams`, `TBuilder`, `TOwned`, the IR helpers (declared types only),
   then per enum / size-discriminated slot `T<F>Ref` and `T<F>RefMut`.

So a declared type always keeps its name when it is free, and a generated
item that would clash with one (or with an earlier item) gets the `_`
suffix. Types and functions share the table (one namespace), which only
renames more often than Rust strictly requires.

A package sees the items of the packages it imports through `pub use
<dep>::*`, which a local item of the same name silently shadows (the
importer's inline `A_b` hides an imported `A_b`). An item of another package
is therefore referenced by its path (`super::...::<dep>::A_b`) when its name
is taken in the current package's table or in any other package's table (two
glob imports of one name are ambiguous); otherwise by its bare name. */

use super::emit::{Emitter, Shape};
use super::ir_helpers::sanitize_param_name;
use super::model::{to_camel, view_name};
use crate::abi::resolved::ResolvedTypeKind;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

/* Module-level names of one view (or aliased / primitive declared type). */
#[derive(Clone, Debug, Default)]
pub struct RNames {
    /* `T<'a>`: the read-only view alias (or the alias / primitive type). */
    pub ty: String,
    pub view: String,
    pub mut_: String,
    pub ext: String,
    pub layout: String,
    pub params: String,
    pub builder: String,
    pub owned: String,
}

/* Names of the IR-derived free functions of a declared type. */
#[derive(Clone, Debug, Default)]
pub struct IrNames {
    pub footprint_checked: String,
    pub footprint: String,
    pub validate: String,
}

/* Maps a declared type name to its IR helper names. */
pub type IrNameFn<'f> = &'f dyn Fn(&str) -> IrNames;

/* Names of one enum / size-discriminated slot's typed enums. */
#[derive(Clone, Debug, Default)]
pub struct RefNames {
    pub read: String,
    pub write: String,
}

#[derive(Default)]
pub struct PkgTable {
    /* every name allocated in the package */
    taken: HashSet<String>,
    /* by view key (the resolved type name) */
    views: HashMap<String, Rc<RNames>>,
    /* by declared (resolved) type name */
    ir: HashMap<String, Rc<IrNames>>,
    /* (view key, slot index) */
    refs: HashMap<(String, usize), Rc<RefNames>>,
}

/* Package assignment and the lazily built tables. */
#[derive(Default)]
pub struct NameCtx {
    /* Declared type name -> ABI package (absent: the one unnamed package). */
    pub pkg_of: HashMap<String, String>,
    /* Package being emitted (`None`: one package, nothing to qualify). */
    pub current: Option<String>,
    pub tables: std::cell::RefCell<HashMap<String, Rc<PkgTable>>>,
    /* Names of other packages' items as referenced from `current`. */
    pub qualified: std::cell::RefCell<HashMap<String, Rc<RNames>>>,
}

/* Directory / module paths of the packages of one run (`a.b.c` ->
`a/b/c`, module `a::b::c`), by the shared rule (`shared::package_paths`):
distinct packages get distinct paths even on a case-insensitive file system
(`cases.Foo` -> `cases::Foo`, `cases.foo` -> `cases::foo_`); a package never
takes the root's shared runtime module (`tn_abi_runtime` ->
`tn_abi_runtime_`) or a module of a package directory (`types`,
`functions`, `runtime`), nor `mod`. Segments are module names (the directory
of `r#type` is `type`). */
pub fn rust_package_paths<'p>(
    packages: impl IntoIterator<Item = &'p String>,
) -> std::collections::BTreeMap<String, Vec<String>> {
    use crate::codegen::shared::package_paths::{PathRules, package_paths};
    fn segment(s: &str) -> String {
        super::model::escape_ident(s)
            .trim_start_matches("r#")
            .to_string()
    }
    package_paths(
        packages,
        &PathRules {
            segment,
            root_reserved: &[crate::codegen::rust::SHARED_RUNTIME_MODULE, "mod"],
            child_reserved: &["types", "functions", "runtime", "mod"],
        },
    )
}

/* Path from the `types` / `functions` module of package `from` to the
module of package `to` (`super::super::dep`); `packages` are the run's
packages (see `rust_package_paths`). */
pub fn rust_use_path<'p>(
    packages: impl IntoIterator<Item = &'p String>,
    from_package: &str,
    to_package: &str,
) -> String {
    let mut all: Vec<String> = packages.into_iter().cloned().collect();
    all.push(from_package.to_string());
    all.push(to_package.to_string());
    let paths = rust_package_paths(&all);
    let from_parts = &paths[from_package];
    let to_parts = &paths[to_package];
    let common_len = from_parts
        .iter()
        .zip(to_parts)
        .take_while(|(f, t)| f == t)
        .count();
    /* Once for `types` / `functions`, then once per package component after
    the common ancestor. */
    let mut parts: Vec<String> = Vec::new();
    for _ in common_len..=from_parts.len() {
        parts.push("super".to_string());
    }
    for part in &to_parts[common_len..] {
        parts.push(super::model::escape_ident(part));
    }
    parts.join("::")
}

struct Alloc(HashSet<String>);

/* Names of the module-level items of the generated runtime (what
`use runtime::*` brings in), parsed from the template so they cannot drift:
every column-0 `pub` / `pub(crate)` item and `macro_rules!`. */
pub fn runtime_names() -> &'static HashSet<String> {
    static NAMES: std::sync::OnceLock<HashSet<String>> = std::sync::OnceLock::new();
    NAMES.get_or_init(|| {
        let ident = |w: &str| -> String {
            w.chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                .collect()
        };
        let mut out = HashSet::new();
        for line in crate::codegen::rust::RUNTIME_MODULE_CONTENT.lines() {
            let (rest, is_macro) = if let Some(r) = line.strip_prefix("macro_rules!") {
                (r, true)
            } else if let Some(r) = line.strip_prefix("pub ") {
                (r, false)
            } else if let Some(r) = line.strip_prefix("pub(crate) ") {
                (r, false)
            } else {
                continue;
            };
            let words: Vec<&str> = rest.split_whitespace().collect();
            let name = if is_macro {
                words.first().copied()
            } else {
                /* Skip `const` / `unsafe` / `extern "C"` before `fn`, and `mut`
                after `static`. */
                let mut k = 0;
                while k < words.len()
                    && (matches!(words[k], "unsafe" | "async" | "extern" | "\"C\"")
                        || (words[k] == "const" && words.get(k + 1) == Some(&"fn")))
                {
                    k += 1;
                }
                match words.get(k).copied() {
                    Some("static") if words.get(k + 1) == Some(&"mut") => words.get(k + 2).copied(),
                    Some(
                        "fn" | "struct" | "enum" | "trait" | "type" | "static" | "const" | "mod"
                        | "union",
                    ) => words.get(k + 1).copied(),
                    _ => None,
                }
            };
            if let Some(name) = name.map(ident).filter(|n| !n.is_empty()) {
                out.insert(name);
            }
        }
        out
    })
}

impl Alloc {
    fn take(&mut self, want: String) -> String {
        let mut n = want;
        while self.0.contains(&n) {
            n.push('_');
        }
        self.0.insert(n.clone());
        n
    }
}

/* Plain names (no table entry: a type of no known package). */
fn plain_names(key: &str) -> RNames {
    let key = view_name(key);
    RNames {
        ty: key.clone(),
        view: format!("{key}View"),
        mut_: format!("{key}Mut"),
        ext: format!("{key}__Ext"),
        layout: format!("{key}__layout"),
        params: format!("{key}Params"),
        builder: format!("{key}Builder"),
        owned: format!("{key}Owned"),
    }
}

/* IR helper names of `type_name` without a table (`<snake>_footprint_ir`, ...). */
pub fn plain_ir_names(type_name: &str) -> IrNames {
    let base = sanitize_param_name(type_name);
    IrNames {
        footprint_checked: format!("{base}_footprint_ir_checked"),
        footprint: format!("{base}_footprint_ir"),
        validate: format!("{base}_validate_ir"),
    }
}

/* Base of the typed enums of slot `slot_name` of view `ty` (`T<F>`). */
fn ref_base(ty: &str, slot_name: &str) -> String {
    if slot_name.is_empty() {
        ty.to_string()
    } else {
        format!("{}{}", ty, to_camel(slot_name))
    }
}

impl<'a> Emitter<'_, 'a> {
    /* ABI package of a resolved type name (empty: the unnamed package). */
    fn pkg_key(&self, resolved_name: &str) -> String {
        let root = resolved_name.split("::").next().unwrap_or(resolved_name);
        self.names.pkg_of.get(root).cloned().unwrap_or_default()
    }

    /* ABI package of a view key (a resolved type name). */
    fn pkg_of_view(&self, key: &str) -> String {
        self.pkg_key(key)
    }

    fn table(&self, pkg: &str) -> Rc<PkgTable> {
        if let Some(t) = self.names.tables.borrow().get(pkg) {
            return t.clone();
        }
        let t = Rc::new(self.build_table(pkg));
        self.names
            .tables
            .borrow_mut()
            .insert(pkg.to_string(), t.clone());
        t
    }

    fn build_table(&self, pkg: &str) -> PkgTable {
        let mut declared: Vec<String> = self
            .m
            .resolver
            .types
            .keys()
            .filter(|k| !k.contains("::") && self.pkg_key(k) == pkg)
            .cloned()
            .collect();
        declared.sort();
        /* 0. runtime items */
        let mut alloc = Alloc(runtime_names().clone());
        let mut tys: HashMap<String, String> = HashMap::new();
        /* (view key, declared type name if declared), in naming order */
        let mut all: Vec<(String, Option<String>)> = Vec::new();
        /* 1. declared types */
        for name in &declared {
            tys.insert(name.clone(), alloc.take(view_name(name)));
        }
        /* 2. inline views */
        for name in &declared {
            let key = name.clone();
            all.push((key.clone(), Some(name.clone())));
            let Some(ty) = self.m.named(name) else {
                continue;
            };
            if matches!(
                ty.kind,
                ResolvedTypeKind::Primitive { .. } | ResolvedTypeKind::TypeRef { .. }
            ) {
                continue;
            }
            self.m.collect_named(name);
            for cell in self.m.views_of_root(&key) {
                let vk = cell.borrow().name.clone();
                if tys.contains_key(&vk) {
                    continue;
                }
                tys.insert(vk.clone(), alloc.take(view_name(&vk)));
                all.push((vk, None));
            }
        }
        /* 3. read / write view types */
        let mut views: HashMap<String, (String, String)> = HashMap::new();
        for (key, _) in &all {
            let n = &tys[key];
            let view = alloc.take(format!("{n}View"));
            let mut_ = alloc.take(format!("{n}Mut"));
            views.insert(key.clone(), (view, mut_));
        }
        /* 4. the other items */
        let mut table = PkgTable::default();
        for (key, declared_name) in &all {
            let n = tys[key].clone();
            let (view, mut_) = views.remove(key).unwrap_or_default();
            let mut take = |s: &str| alloc.take(format!("{n}{s}"));
            let names = RNames {
                view,
                mut_,
                ext: take("__Ext"),
                layout: take("__layout"),
                params: take("Params"),
                builder: take("Builder"),
                owned: take("Owned"),
                ty: n.clone(),
            };
            table.views.insert(key.clone(), Rc::new(names));
            if let Some(name) = declared_name {
                let base = sanitize_param_name(name);
                let ir = IrNames {
                    footprint_checked: alloc.take(format!("{base}_footprint_ir_checked")),
                    footprint: alloc.take(format!("{base}_footprint_ir")),
                    validate: alloc.take(format!("{base}_validate_ir")),
                };
                table.ir.insert(name.clone(), Rc::new(ir));
            }
            let Some(info) = self.info(key) else {
                continue;
            };
            for slot in self.slots(&info) {
                if !matches!(slot.shape, Shape::Enum { .. } | Shape::Sdu { .. }) {
                    continue;
                }
                let base = ref_base(&n, &slot.name);
                let refs = RefNames {
                    read: alloc.take(format!("{base}Ref")),
                    write: alloc.take(format!("{base}RefMut")),
                };
                table.refs.insert((key.clone(), slot.idx), Rc::new(refs));
            }
        }
        table.taken = alloc.0;
        table
    }

    /* `name`, an item of package `owner`, as referenced from the current
    package: by path when a bare name would be shadowed or ambiguous. */
    fn qualify(&self, owner: &str, name: &str) -> String {
        let Some(cur) = self.names.current.as_deref() else {
            return name.to_string();
        };
        if owner == cur {
            return name.to_string();
        }
        let mut packages: Vec<&String> = self.names.pkg_of.values().collect();
        packages.sort();
        packages.dedup();
        let shadowed = self.table(cur).taken.contains(name)
            || packages
                .iter()
                .filter(|p| p.as_str() != owner && p.as_str() != cur)
                .any(|p| self.table(p).taken.contains(name));
        if shadowed {
            format!(
                "{}::{}",
                rust_use_path(packages.iter().copied(), cur, owner),
                name
            )
        } else {
            name.to_string()
        }
    }

    /* Module-level names of the view (or aliased declared type) `key`, as
    referenced from the current package. */
    pub fn nm(&self, key: &str) -> Rc<RNames> {
        let owner = self.pkg_of_view(key);
        let t = self.table(&owner);
        let names = t
            .views
            .get(key)
            .cloned()
            .unwrap_or_else(|| Rc::new(plain_names(key)));
        if self.names.current.as_deref().is_none_or(|c| c == owner) {
            return names;
        }
        if let Some(q) = self.names.qualified.borrow().get(key) {
            return q.clone();
        }
        let q = |n: &String| self.qualify(&owner, n);
        let qualified = Rc::new(RNames {
            ty: q(&names.ty),
            view: q(&names.view),
            mut_: q(&names.mut_),
            ext: q(&names.ext),
            layout: q(&names.layout),
            params: q(&names.params),
            builder: q(&names.builder),
            owned: q(&names.owned),
        });
        self.names
            .qualified
            .borrow_mut()
            .insert(key.to_string(), qualified.clone());
        qualified
    }

    /* Names of the IR helpers of declared type `type_name`, as referenced
    from the current package. */
    pub fn ir_names(&self, type_name: &str) -> Rc<IrNames> {
        let owner = self.pkg_key(type_name);
        let t = self.table(&owner);
        let names =
            t.ir.get(type_name)
                .cloned()
                .unwrap_or_else(|| Rc::new(plain_ir_names(type_name)));
        if self.names.current.as_deref().is_none_or(|c| c == owner) {
            return names;
        }
        Rc::new(IrNames {
            footprint_checked: self.qualify(&owner, &names.footprint_checked),
            footprint: self.qualify(&owner, &names.footprint),
            validate: self.qualify(&owner, &names.validate),
        })
    }

    /* Typed enum names of enum / size-discriminated slot `idx` of view `key`. */
    pub fn ref_names(&self, key: &str, idx: usize, slot_name: &str) -> Rc<RefNames> {
        let t = self.table(&self.pkg_of_view(key));
        t.refs
            .get(&(key.to_string(), idx))
            .cloned()
            .unwrap_or_else(|| {
                let base = ref_base(&self.nm(key).ty, slot_name);
                Rc::new(RefNames {
                    read: format!("{base}Ref"),
                    write: format!("{base}RefMut"),
                })
            })
    }
}
