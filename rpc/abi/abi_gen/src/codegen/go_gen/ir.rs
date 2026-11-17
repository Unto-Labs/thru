/* IR-derived free functions (port of `rust_gen/ir_footprint.rs` and
`rust_gen/ir_validate.rs`).

For a type `T` whose shared layout IR has no jagged array, whose nested calls
pass every parameter of the callee (the rule the C and Rust backends use) and
that calls no helper taking the buffer size (`calls_buffer_sized`: the bytes
left for a nested value are not an IR value; C passes the caller's buffer size
instead, Rust emits a call that does not compile) this emits:

  func TFootprintIRChecked(<params> uint64) (uint64, error)
  func TFootprintIR(<params> uint64) uint64          // tnabi.MaxU64 on error
  func TValidateIR(bufSz uint64, <params> uint64) (uint64, error)

with the Rust helpers' semantics, operator by operator: the footprint uses the
checked expression operators (division by zero is KindDivisionByZero, an
unmatched switch KindMissingSwitchCase), the validator its own guards
(division by zero and shifts of 64 or more are KindArithmeticOverflow, an
unmatched switch KindInvalidVariant) and reports KindBufferTooSmall when the
size exceeds `bufSz`. `__buffer_size` is `bufSz`. */

use super::code::Code;
use super::emit::GoEmitter;
use super::names::{GO_KEYWORDS, type_name};
use crate::codegen::rust_gen::ir_helpers::sanitize_param_name;
use crate::codegen::shared::builder::IrBuilder;
use crate::codegen::shared::ir::{BinaryOpNode, CallNestedNode, IrNode, TypeIr};
use std::collections::BTreeSet;
use std::fmt::Write;

/* Go identifier of an IR parameter. */
pub fn ir_param(name: &str) -> String {
    let mut n: String = sanitize_param_name(name)
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if n.is_empty() || n.starts_with(|c: char| c.is_ascii_digit()) {
        n.insert(0, 'p');
    }
    if GO_KEYWORDS.contains(&n.as_str())
        || matches!(n.as_str(), "bufSz" | "err" | "tnabi" | "uint64" | "len")
        || n.starts_with("tnabi")
        || n.starts_with("tnp_")
    {
        n.push('_');
    }
    n
}

pub fn has_buffer_size(node: &IrNode) -> bool {
    match node {
        IrNode::FieldRef(f) => f.parameter.is_none() && f.path == "__buffer_size",
        IrNode::AlignUp(n) => has_buffer_size(&n.node),
        IrNode::Switch(n) => {
            n.cases.iter().any(|c| has_buffer_size(&c.node))
                || n.default.as_deref().is_some_and(has_buffer_size)
        }
        IrNode::AddChecked(n)
        | IrNode::SubChecked(n)
        | IrNode::MulChecked(n)
        | IrNode::DivChecked(n)
        | IrNode::ModChecked(n)
        | IrNode::BitAnd(n)
        | IrNode::BitOr(n)
        | IrNode::BitXor(n)
        | IrNode::LeftShift(n)
        | IrNode::RightShift(n) => has_buffer_size(&n.left) || has_buffer_size(&n.right),
        IrNode::SumOverArray(n) => has_buffer_size(&n.count),
        IrNode::ZeroSize { .. } | IrNode::Const(_) | IrNode::CallNested(_) => false,
    }
}

/* The `CallNested` nodes of `node`. */
pub fn nested_calls(node: &IrNode) -> Vec<&CallNestedNode> {
    fn walk<'n>(node: &'n IrNode, out: &mut Vec<&'n CallNestedNode>) {
        match node {
            IrNode::CallNested(c) => out.push(c),
            IrNode::AlignUp(n) => walk(&n.node, out),
            IrNode::Switch(n) => {
                for c in &n.cases {
                    walk(&c.node, out);
                }
                if let Some(d) = &n.default {
                    walk(d, out);
                }
            }
            IrNode::AddChecked(n)
            | IrNode::SubChecked(n)
            | IrNode::MulChecked(n)
            | IrNode::DivChecked(n)
            | IrNode::ModChecked(n)
            | IrNode::BitAnd(n)
            | IrNode::BitOr(n)
            | IrNode::BitXor(n)
            | IrNode::LeftShift(n)
            | IrNode::RightShift(n) => {
                walk(&n.left, out);
                walk(&n.right, out);
            }
            IrNode::SumOverArray(n) => walk(&n.count, out),
            IrNode::ZeroSize { .. } | IrNode::Const(_) | IrNode::FieldRef(_) => {}
        }
    }
    let mut out = Vec::new();
    walk(node, &mut out);
    out
}

/* Does `ir` call (directly or through other calls) a helper that takes the
buffer size? Its caller cannot supply it: the bytes left for a nested value
are not an IR value. */
pub fn calls_buffer_sized(builder: &IrBuilder<'_>, ir: &TypeIr, depth: usize) -> bool {
    if depth > 64 {
        return true;
    }
    nested_calls(&ir.root)
        .into_iter()
        .any(|call| match builder.build_type_name(&call.type_name) {
            Ok(callee) => {
                has_buffer_size(&callee.root) || calls_buffer_sized(builder, &callee, depth + 1)
            }
            Err(_) => true,
        })
}

fn has_jagged(node: &IrNode) -> bool {
    match node {
        IrNode::SumOverArray(_) => true,
        IrNode::AlignUp(n) => has_jagged(&n.node),
        IrNode::Switch(n) => {
            n.cases.iter().any(|c| has_jagged(&c.node))
                || n.default.as_deref().is_some_and(has_jagged)
        }
        IrNode::AddChecked(n)
        | IrNode::SubChecked(n)
        | IrNode::MulChecked(n)
        | IrNode::DivChecked(n)
        | IrNode::ModChecked(n)
        | IrNode::BitAnd(n)
        | IrNode::BitOr(n)
        | IrNode::BitXor(n)
        | IrNode::LeftShift(n)
        | IrNode::RightShift(n) => has_jagged(&n.left) || has_jagged(&n.right),
        IrNode::ZeroSize { .. }
        | IrNode::Const(_)
        | IrNode::FieldRef(_)
        | IrNode::CallNested(_) => false,
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Flavor {
    Footprint,
    Validate,
}

impl<'m, 'a> GoEmitter<'m, 'a> {
    /* `TFootprintIRChecked` of an IR type, qualified when it lives in
    another package. */
    fn ir_fn(&self, ir_type: &str) -> String {
        match self.m.resolver.types.get(ir_type) {
            Some(t) => self.qname(t, |v| &v.fp_ir_checked),
            None => self.vnames_of(ir_type).fp_ir_checked,
        }
    }

    /* `TFootprintIRChecked`, `TFootprintIR` and `TValidateIR` for `ir`, or
    `None` when the IR has a jagged array (no free function can size it). */
    pub fn emit_ir_fns(&self, ir: &TypeIr) -> Option<String> {
        if has_jagged(&ir.root) {
            return None;
        }
        let names = self.vnames_of(&ir.type_name);
        let (fpc, fpi, vir) = (names.fp_ir_checked, names.fp_ir, names.validate_ir);
        let params: Vec<String> = ir.parameters.iter().map(|p| ir_param(&p.name)).collect();
        let buf = has_buffer_size(&ir.root);
        let mut sig: Vec<String> = Vec::new();
        let mut args: Vec<String> = Vec::new();
        if buf {
            sig.push("bufSz".into());
            args.push("bufSz".into());
        }
        let mut seen = BTreeSet::new();
        for p in &params {
            if seen.insert(p.clone()) {
                sig.push(p.clone());
                args.push(p.clone());
            }
        }
        let typed = |names: &[String]| -> String {
            if names.is_empty() {
                String::new()
            } else {
                format!("{} uint64", names.join(", "))
            }
        };
        let mut out = String::new();

        let mut c = Code::new(1, "return 0, ");
        let v = self.ir_node(&mut c, &ir.root, Flavor::Footprint);
        let _ = writeln!(
            out,
            "// {fpc} is the IR footprint of `{}` (checked arithmetic).",
            ir.type_name
        );
        let _ = writeln!(out, "func {fpc}({}) (uint64, error) {{", typed(&sig));
        out.push_str(&c.s);
        let _ = writeln!(out, "\treturn {v}, nil");
        let _ = writeln!(out, "}}\n");
        let _ = writeln!(
            out,
            "// {fpi} is {fpc}, or tnabi.MaxU64 when the parameters"
        );
        let _ = writeln!(out, "// overflow or select no variant.");
        let _ = writeln!(out, "func {fpi}({}) uint64 {{", typed(&sig));
        let _ = writeln!(out, "\tsz, err := {fpc}({})", args.join(", "));
        let _ = writeln!(
            out,
            "\tif err != nil {{\n\t\treturn tnabi.MaxU64\n\t}}\n\treturn sz"
        );
        let _ = writeln!(out, "}}\n");

        let mut vsig = vec!["bufSz".to_string()];
        vsig.extend(sig.iter().filter(|s| *s != "bufSz").cloned());
        let mut c = Code::new(1, "return 0, ");
        let v = self.ir_node(&mut c, &ir.root, Flavor::Validate);
        let _ = writeln!(
            out,
            "// {vir} checks that a `{}` described by the parameters fits in bufSz",
            ir.type_name
        );
        let _ = writeln!(out, "// bytes and returns its size.");
        let _ = writeln!(out, "func {vir}({}) (uint64, error) {{", typed(&vsig));
        out.push_str(&c.s);
        let _ = writeln!(
            out,
            "\tif {v} > bufSz {{\n\t\treturn 0, tnabi.Short({v}, bufSz)\n\t}}"
        );
        let _ = writeln!(out, "\treturn {v}, nil");
        let _ = writeln!(out, "}}\n");
        Some(out)
    }

    fn ir_node(&self, c: &mut Code, node: &IrNode, fl: Flavor) -> String {
        match node {
            IrNode::Const(k) => format!("uint64({})", k.value),
            IrNode::ZeroSize { .. } => "uint64(0)".to_string(),
            IrNode::FieldRef(f) => {
                if f.parameter.is_none() && f.path == "__buffer_size" {
                    "bufSz".to_string()
                } else {
                    ir_param(f.parameter.as_deref().unwrap_or(&f.path))
                }
            }
            IrNode::AddChecked(b) => self.ir_call(c, b, "tnabi.Add", fl),
            IrNode::SubChecked(b) => self.ir_call(c, b, "tnabi.ESub", fl),
            IrNode::MulChecked(b) => self.ir_call(c, b, "tnabi.Mul", fl),
            IrNode::DivChecked(b) => match fl {
                Flavor::Footprint => self.ir_call(c, b, "tnabi.EDiv", fl),
                Flavor::Validate => self.ir_guarded(c, b, "/", true, fl),
            },
            IrNode::ModChecked(b) => match fl {
                Flavor::Footprint => self.ir_call(c, b, "tnabi.EMod", fl),
                Flavor::Validate => self.ir_guarded(c, b, "%", true, fl),
            },
            IrNode::BitAnd(b) => self.ir_guarded(c, b, "&", false, fl),
            IrNode::BitOr(b) => self.ir_guarded(c, b, "|", false, fl),
            IrNode::BitXor(b) => self.ir_guarded(c, b, "^", false, fl),
            IrNode::LeftShift(b) => match fl {
                Flavor::Footprint => self.ir_call(c, b, "tnabi.EShl", fl),
                Flavor::Validate => self.ir_shift(c, b, "<<", fl),
            },
            IrNode::RightShift(b) => match fl {
                Flavor::Footprint => {
                    let l = self.ir_node(c, &b.left, fl);
                    let r = self.ir_node(c, &b.right, fl);
                    format!("tnabi.EShr({l}, {r})")
                }
                Flavor::Validate => self.ir_shift(c, b, ">>", fl),
            },
            IrNode::AlignUp(a) => {
                let inner = self.ir_node(c, &a.node, fl);
                let align = a.alignment.max(1);
                if align <= 1 {
                    inner
                } else {
                    c.val(&format!("tnabi.Align({inner}, {align})"))
                }
            }
            IrNode::CallNested(call) => {
                let args: Vec<String> = call.arguments.iter().map(|a| ir_param(&a.value)).collect();
                c.val(&format!(
                    "{}({})",
                    self.ir_fn(&call.type_name),
                    args.join(", ")
                ))
            }
            IrNode::Switch(sw) => {
                let t = c.t();
                c.l(&format!("var {t} uint64"));
                c.open(&format!("switch {} {{", ir_param(&sw.tag)));
                let mut seen = BTreeSet::new();
                for case in &sw.cases {
                    if !seen.insert(case.tag_value) {
                        continue;
                    }
                    c.case_(&format!("case {}:", case.tag_value));
                    let v = self.ir_node(c, &case.node, fl);
                    c.l(&format!("{t} = {v}"));
                }
                c.case_("default:");
                match &sw.default {
                    Some(d) => {
                        let v = self.ir_node(c, d, fl);
                        c.l(&format!("{t} = {v}"));
                    }
                    None => c.bail(match fl {
                        Flavor::Footprint => "tnabi.ErrMissingSwitchCase",
                        Flavor::Validate => "tnabi.ErrInvalidVariant",
                    }),
                }
                c.close();
                t
            }
            /* Rejected by `emit_ir_fns`. */
            IrNode::SumOverArray(_) => c.val("tnabi.Fail(tnabi.ErrUnsupported)"),
        }
    }

    fn ir_call(&self, c: &mut Code, b: &BinaryOpNode, f: &str, fl: Flavor) -> String {
        let l = self.ir_node(c, &b.left, fl);
        let r = self.ir_node(c, &b.right, fl);
        c.val(&format!("{f}({l}, {r})"))
    }

    /* `l op r`, with a zero divisor rejected when `div` (the validator's
    division and modulo). */
    fn ir_guarded(
        &self,
        c: &mut Code,
        b: &BinaryOpNode,
        op: &str,
        div: bool,
        fl: Flavor,
    ) -> String {
        let l = self.ir_node(c, &b.left, fl);
        let r = self.ir_node(c, &b.right, fl);
        if div {
            /* Operands in variables: a constant zero divisor must not be a
            compile-time division by zero. */
            let (lv, rv) = (c.t(), c.t());
            c.l(&format!("{lv}, {rv} := {l}, {r}"));
            c.open(&format!("if {rv} == 0 {{"));
            c.bail("tnabi.ErrArithmeticOverflow");
            c.close();
            let t = c.t();
            c.l(&format!("{t} := {lv} {op} {rv}"));
            t
        } else {
            format!("({l} {op} {r})")
        }
    }

    /* The validator's shifts: 64 or more is an overflow; bits shifted out
    are dropped (as in the Rust helper). */
    fn ir_shift(&self, c: &mut Code, b: &BinaryOpNode, op: &str, fl: Flavor) -> String {
        let l = self.ir_node(c, &b.left, fl);
        let r = self.ir_node(c, &b.right, fl);
        let (lv, rv) = (c.t(), c.t());
        c.l(&format!("{lv}, {rv} := {l}, {r}"));
        c.open(&format!("if {rv} >= 64 {{"));
        c.bail("tnabi.ErrArithmeticOverflow");
        c.close();
        let t = c.t();
        c.l(&format!("{t} := {lv} {op} {rv}"));
        t
    }
}
