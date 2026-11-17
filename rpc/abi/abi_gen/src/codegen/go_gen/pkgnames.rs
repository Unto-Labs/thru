/* Package-level Go names.

Every exported package-level identifier of a generated package (type names,
their `__Ext` / `Params` / `Builder` / `Ref` types, `Parse...` and the other
functions, tag constants, variant tables, IR helpers) is allocated in one
table per ABI package, so declared ABI types and generated helpers can never
collide (`foo` and `Foo`; a declared `MessageBuilder` and the builder of
`Message`). The table depends only on the package's types, so every package of
a run (and any tool deriving names, such as the compliance runner) computes
the same names. Rule, in this order, appending `_` to a name already taken:

1. the declared types of the package, sorted by ABI name (`Foo` before `foo`,
   so `foo` becomes `Foo_`);
2. their inline types (`T_field...`), in declaration order;
3. the helpers of each type (same type order): `T__Ext`, `TParams`,
   `TBuilder`, `NewTBuilder`, `ParseT`, `ValidateT`, `UncheckedT`, the
   `...With` forms, `NewT`, `InitT`, `FootprintT`, `TFootprint`,
   `TParamsKeys`, `TParamsFromBuffer`, `TParamsFromValues`, the IR helpers,
   then per enum/SDU field (or the type's own variants) `T<F>Ref`,
   `T<F>Variants`, `T<F>VariantByName`, `T<F>VariantByTag` and the tag
   constants `T<F>Tag<V>`.

So a declared type always keeps its name when it is free, and a helper that
would clash with one (or with an earlier helper) gets the `_` suffix. */

use super::emit::GoEmitter;
use super::names::{camel, type_name};
use crate::abi::resolved::ResolvedTypeKind;
use crate::codegen::rust_gen::emit::Shape;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

/* Package-level names of one type. */
#[derive(Clone, Debug, Default)]
pub struct VNames {
    pub ty: String,
    pub ext: String,
    pub params: String,
    pub builder: String,
    pub new_builder: String,
    pub parse: String,
    pub validate: String,
    pub unchecked: String,
    pub parse_with: String,
    pub validate_with: String,
    pub unchecked_with: String,
    pub new: String,
    pub init: String,
    pub footprint_fn: String,
    pub footprint_const: String,
    pub params_keys: String,
    pub params_from_buffer: String,
    pub params_from_values: String,
    pub fp_ir_checked: String,
    pub fp_ir: String,
    pub validate_ir: String,
}

/* Package-level names of one enum / SDU slot (or a union's own table). */
#[derive(Clone, Debug, Default)]
pub struct SlotNames {
    pub ref_ty: String,
    pub variants: String,
    pub by_name: String,
    pub by_tag: String,
    pub tags: Vec<String>,
}

#[derive(Default)]
pub struct PkgTable {
    types: HashMap<String, VNames>,
    /* (type name, slot index; usize::MAX for a union's table) */
    slots: HashMap<(String, usize), SlotNames>,
}

struct Alloc(HashSet<String>);

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

impl GoEmitter<'_, '_> {
    /* ABI package of a type (empty when the run did not say: one package). */
    pub(crate) fn pkg_key(&self, resolved_name: &str) -> String {
        let root = resolved_name.split("::").next().unwrap_or(resolved_name);
        self.pkg_of.get(root).cloned().unwrap_or_default()
    }

    fn table(&self, pkg: &str) -> Rc<PkgTable> {
        if let Some(t) = self.tables.borrow().get(pkg) {
            return t.clone();
        }
        let t = Rc::new(self.build_table(pkg));
        self.tables.borrow_mut().insert(pkg.to_string(), t.clone());
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
        let mut alloc = Alloc(HashSet::new());
        let mut table = PkgTable::default();
        /* Every type with names: (resolved name, has views). */
        let mut order: Vec<String> = Vec::new();
        /* 1. declared types */
        for name in &declared {
            let n = alloc.take(type_name(name));
            table.types.insert(
                name.clone(),
                VNames {
                    ty: n,
                    ..Default::default()
                },
            );
            order.push(name.clone());
        }
        /* 2. inline types */
        let mut all: Vec<String> = Vec::new();
        for name in &declared {
            all.push(name.clone());
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
            for cell in self.m.views_of_root(name) {
                let tn = cell.borrow().ty.name.clone();
                if table.types.contains_key(&tn) {
                    continue;
                }
                let n = alloc.take(type_name(&tn));
                table.types.insert(
                    tn.clone(),
                    VNames {
                        ty: n,
                        ..Default::default()
                    },
                );
                all.push(tn);
            }
        }
        /* 3. helpers */
        for name in &all {
            let n = table.types[name].ty.clone();
            let mut take = |p: &str, s: &str| alloc.take(format!("{p}{n}{s}"));
            let v = VNames {
                ty: n.clone(),
                ext: take("", "__Ext"),
                params: take("", "Params"),
                builder: take("", "Builder"),
                new_builder: take("New", "Builder"),
                parse: take("Parse", ""),
                validate: take("Validate", ""),
                unchecked: take("Unchecked", ""),
                parse_with: take("Parse", "With"),
                validate_with: take("Validate", "With"),
                unchecked_with: take("Unchecked", "With"),
                new: take("New", ""),
                init: take("Init", ""),
                footprint_fn: take("Footprint", ""),
                footprint_const: take("", "Footprint"),
                params_keys: take("", "ParamsKeys"),
                params_from_buffer: take("", "ParamsFromBuffer"),
                params_from_values: take("", "ParamsFromValues"),
                fp_ir_checked: take("", "FootprintIRChecked"),
                fp_ir: take("", "FootprintIR"),
                validate_ir: take("", "ValidateIR"),
            };
            table.types.insert(name.clone(), v);
            /* Variant metadata of the type's enum / SDU slots or union. */
            let Some(info) = self.info(name) else {
                continue;
            };
            if info.ty.name != *name {
                continue;
            }
            if matches!(info.ty.kind, ResolvedTypeKind::Union { .. }) {
                let s = SlotNames {
                    ref_ty: String::new(),
                    variants: alloc.take(format!("{n}Variants")),
                    by_name: alloc.take(format!("{n}VariantByName")),
                    by_tag: alloc.take(format!("{n}VariantByTag")),
                    tags: Vec::new(),
                };
                table.slots.insert((name.clone(), usize::MAX), s);
                continue;
            }
            for slot in self.r.slots(&info) {
                let (Shape::Enum { variants, .. } | Shape::Sdu { variants }) = &slot.shape else {
                    continue;
                };
                let p = format!("{n}{}", self.slot_base(&slot));
                let mut s = SlotNames {
                    ref_ty: alloc.take(format!("{p}Ref")),
                    variants: alloc.take(format!("{p}Variants")),
                    by_name: alloc.take(format!("{p}VariantByName")),
                    by_tag: alloc.take(format!("{p}VariantByTag")),
                    tags: Vec::new(),
                };
                for var in variants {
                    s.tags
                        .push(alloc.take(format!("{p}Tag{}", camel(&var.name))));
                }
                table.slots.insert((name.clone(), slot.idx), s);
            }
        }
        let _ = order;
        table
    }

    /* Package-level names of a type (by resolved name). */
    pub fn vnames_of(&self, resolved_name: &str) -> VNames {
        let t = self.table(&self.pkg_key(resolved_name));
        t.types.get(resolved_name).cloned().unwrap_or_else(|| {
            /* Not a type of a known package: the plain patterns. */
            let n = type_name(resolved_name);
            VNames {
                ext: format!("{n}__Ext"),
                params: format!("{n}Params"),
                builder: format!("{n}Builder"),
                new_builder: format!("New{n}Builder"),
                parse: format!("Parse{n}"),
                validate: format!("Validate{n}"),
                unchecked: format!("Unchecked{n}"),
                parse_with: format!("Parse{n}With"),
                validate_with: format!("Validate{n}With"),
                unchecked_with: format!("Unchecked{n}With"),
                new: format!("New{n}"),
                init: format!("Init{n}"),
                footprint_fn: format!("Footprint{n}"),
                footprint_const: format!("{n}Footprint"),
                params_keys: format!("{n}ParamsKeys"),
                params_from_buffer: format!("{n}ParamsFromBuffer"),
                params_from_values: format!("{n}ParamsFromValues"),
                fp_ir_checked: format!("{n}FootprintIRChecked"),
                fp_ir: format!("{n}FootprintIR"),
                validate_ir: format!("{n}ValidateIR"),
                ty: n,
            }
        })
    }

    /* Package-level names of enum / SDU slot `idx` of a type (`usize::MAX`:
    a union's own table). */
    pub fn slot_names(&self, resolved_name: &str, idx: usize) -> SlotNames {
        let t = self.table(&self.pkg_key(resolved_name));
        t.slots
            .get(&(resolved_name.to_string(), idx))
            .cloned()
            .unwrap_or_default()
    }
}
