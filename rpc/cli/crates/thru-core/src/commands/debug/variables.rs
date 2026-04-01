//! DWARF variable resolution for transaction debug responses.
//!
//! Finds variables in scope at a given PC and resolves their values
//! from the register dump and stack windows.

use addr2line::gimli;
use gimli::UnwindSection as _;
use serde::Serialize;

type R<'a> = gimli::EndianSlice<'a, gimli::RunTimeEndian>;

const RISCV_ABI_NAMES: [&str; 32] = [
    "zero", "ra", "sp", "gp", "tp", "t0", "t1", "t2", "s0", "s1", "a0", "a1", "a2", "a3", "a4",
    "a5", "a6", "a7", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "t3", "t4",
    "t5", "t6",
];

#[derive(Serialize)]
pub struct VariableInfo {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub type_name: Option<String>,
    pub location: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
}

/// Stack window from a call frame: (base_virtual_addr, bytes).
pub type StackWindow<'a> = (u64, &'a [u8]);

/// Resolve variables in scope at `pc` using DWARF debug info.
pub fn resolve<'data>(
    dwarf: &gimli::Dwarf<R<'data>>,
    debug_frame: &gimli::DebugFrame<R<'data>>,
    pc: u64,
    registers: &[u64],
    stack_windows: &[StackWindow],
) -> Vec<VariableInfo> {
    resolve_inner(dwarf, debug_frame, pc, registers, stack_windows).unwrap_or_default()
}

fn resolve_inner<'data>(
    dwarf: &gimli::Dwarf<R<'data>>,
    debug_frame: &gimli::DebugFrame<R<'data>>,
    pc: u64,
    registers: &[u64],
    stack_windows: &[StackWindow],
) -> Option<Vec<VariableInfo>> {
    let mut units = dwarf.units();
    while let Ok(Some(header)) = units.next() {
        let Ok(unit) = dwarf.unit(header) else {
            continue;
        };

        if !unit_contains_pc(dwarf, &unit, pc).unwrap_or(false) {
            continue;
        }

        let frame_base = compute_frame_base(dwarf, debug_frame, &unit, pc, registers);
        let raw_vars = collect_variables(dwarf, &unit, pc)?;

        let mut result = Vec::new();
        for (name, type_offset, loc_attr) in &raw_vars {
            let type_name = type_offset.and_then(|off| resolve_type_name(dwarf, &unit, off));
            let info =
                evaluate_variable(dwarf, &unit, name, type_name, loc_attr, pc, frame_base, registers, stack_windows);
            result.push(info);
        }
        return Some(result);
    }
    None
}

// --- Find compilation unit for PC ---

fn unit_contains_pc<'data>(
    dwarf: &gimli::Dwarf<R<'data>>,
    unit: &gimli::Unit<R<'data>>,
    pc: u64,
) -> gimli::Result<bool> {
    let mut entries = unit.entries();
    if let Some((_, entry)) = entries.next_dfs()? {
        if let Ok(mut ranges) = dwarf.die_ranges(unit, entry) {
            while let Ok(Some(range)) = ranges.next() {
                if range.begin <= pc && pc < range.end {
                    return Ok(true);
                }
            }
        }
    }
    Ok(false)
}

// --- Collect variables in scope at PC ---

type RawVariable<'data> = (
    String,                              // name
    Option<gimli::UnitOffset>,           // DW_AT_type offset
    gimli::AttributeValue<R<'data>>,     // DW_AT_location
);

fn collect_variables<'data>(
    dwarf: &gimli::Dwarf<R<'data>>,
    unit: &gimli::Unit<R<'data>>,
    pc: u64,
) -> Option<Vec<RawVariable<'data>>> {
    let mut result = Vec::new();
    let mut entries = unit.entries();

    // Track scope depth: positive depth means we're inside a scope that contains PC.
    // We use a stack to track whether each scope level contains the PC.
    let mut scope_stack: Vec<bool> = Vec::new();

    while let Ok(Some((delta_depth, entry))) = entries.next_dfs() {
        // Adjust scope stack for depth changes
        if delta_depth < 0 {
            let pop_count = (-delta_depth) as usize;
            for _ in 0..pop_count.min(scope_stack.len()) {
                scope_stack.pop();
            }
        }

        let tag = entry.tag();
        match tag {
            gimli::DW_TAG_subprogram
            | gimli::DW_TAG_inlined_subroutine
            | gimli::DW_TAG_lexical_block => {
                let contains = die_contains_pc(dwarf, unit, entry, pc).unwrap_or(false);
                scope_stack.push(contains);
            }
            gimli::DW_TAG_variable | gimli::DW_TAG_formal_parameter => {
                // Only collect if all containing scopes include the PC
                let in_scope = scope_stack.iter().all(|&c| c);
                if !in_scope {
                    continue;
                }

                let name = entry
                    .attr_value(gimli::DW_AT_name)
                    .ok()
                    .flatten()
                    .and_then(|v| dwarf.attr_string(unit, v).ok())
                    .map(|s| Some(s.to_string_lossy().into_owned()))
                    .flatten();

                let Some(name) = name else { continue };

                let type_offset = entry
                    .attr_value(gimli::DW_AT_type)
                    .ok()
                    .flatten()
                    .and_then(|v| match v {
                        gimli::AttributeValue::UnitRef(offset) => Some(offset),
                        _ => None,
                    });

                let loc_attr = entry.attr_value(gimli::DW_AT_location).ok().flatten();
                let Some(loc_attr) = loc_attr else {
                    // No location = optimized out
                    result.push((name, type_offset, make_empty_loc()));
                    continue;
                };

                result.push((name, type_offset, loc_attr));
            }
            _ => {
                // Non-scope DIEs: push a dummy scope entry if they have children
                // so the depth tracking stays correct
                if entry.has_children() {
                    scope_stack.push(inherit_scope_contains_pc(&scope_stack));
                }
            }
        }
    }

    Some(result)
}

fn inherit_scope_contains_pc(scope_stack: &[bool]) -> bool {
    scope_stack.last().copied().unwrap_or(true)
}

fn make_empty_loc<'data>() -> gimli::AttributeValue<R<'data>> {
    gimli::AttributeValue::Exprloc(gimli::Expression(gimli::EndianSlice::new(
        &[],
        gimli::RunTimeEndian::Little,
    )))
}

fn die_contains_pc<'data>(
    dwarf: &gimli::Dwarf<R<'data>>,
    unit: &gimli::Unit<R<'data>>,
    entry: &gimli::DebuggingInformationEntry<R<'data>>,
    pc: u64,
) -> gimli::Result<bool> {
    let mut ranges = dwarf.die_ranges(unit, entry)?;
    while let Some(range) = ranges.next()? {
        if range.begin <= pc && pc < range.end {
            return Ok(true);
        }
    }
    Ok(false)
}

// --- Frame base resolution ---

fn compute_frame_base<'data>(
    dwarf: &gimli::Dwarf<R<'data>>,
    debug_frame: &gimli::DebugFrame<R<'data>>,
    unit: &gimli::Unit<R<'data>>,
    pc: u64,
    registers: &[u64],
) -> Option<u64> {
    // Walk to find the subprogram containing PC
    let mut entries = unit.entries();
    while let Ok(Some((_, entry))) = entries.next_dfs() {
        if entry.tag() != gimli::DW_TAG_subprogram {
            continue;
        }
        if !die_contains_pc(dwarf, unit, entry, pc).unwrap_or(false) {
            continue;
        }

        let fb_attr = entry
            .attr_value(gimli::DW_AT_frame_base)
            .ok()
            .flatten()?;

        return eval_frame_base(dwarf, unit, debug_frame, &fb_attr, pc, registers);
    }
    None
}

fn eval_frame_base<'data>(
    dwarf: &gimli::Dwarf<R<'data>>,
    unit: &gimli::Unit<R<'data>>,
    debug_frame: &gimli::DebugFrame<R<'data>>,
    attr: &gimli::AttributeValue<R<'data>>,
    pc: u64,
    registers: &[u64],
) -> Option<u64> {
    let expr = match attr {
        gimli::AttributeValue::Exprloc(expr) => expr.clone(),
        gimli::AttributeValue::LocationListsRef(offset) => {
            let mut locs = dwarf
                .locations(unit, *offset)
                .ok()?;
            let mut found_expr = None;
            while let Ok(Some(entry)) = locs.next() {
                { let gimli::LocationListEntry { range, data, .. } = entry;
                    if range.begin <= pc && pc < range.end {
                        found_expr = Some(data);
                        break;
                    }
                }
            }
            found_expr?
        }
        _ => return None,
    };

    let mut ops = expr.operations(unit.encoding());
    match ops.next() {
        Ok(Some(gimli::Operation::Register { register })) => {
            registers.get(register.0 as usize).copied()
        }
        Ok(Some(gimli::Operation::RegisterOffset { register, offset, .. })) => {
            let base = registers.get(register.0 as usize).copied()?;
            Some((base as i64 + offset) as u64)
        }
        Ok(Some(gimli::Operation::CallFrameCFA)) => compute_cfa(debug_frame, pc, registers),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::inherit_scope_contains_pc;

    #[test]
    fn root_scope_defaults_to_in_scope() {
        assert!(inherit_scope_contains_pc(&[]));
    }

    #[test]
    fn inherited_scope_tracks_parent_scope_value() {
        assert!(inherit_scope_contains_pc(&[true]));
        assert!(!inherit_scope_contains_pc(&[false]));
    }
}

fn compute_cfa<'data>(
    debug_frame: &gimli::DebugFrame<R<'data>>,
    pc: u64,
    registers: &[u64],
) -> Option<u64> {
    let mut ctx = gimli::UnwindContext::new();
    let bases = gimli::BaseAddresses::default();

    let fde = debug_frame
        .fde_for_address(&bases, pc, gimli::DebugFrame::cie_from_offset)
        .ok()?;

    let row = fde.unwind_info_for_address(debug_frame, &bases, &mut ctx, pc).ok()?;

    match row.cfa() {
        gimli::CfaRule::RegisterAndOffset { register, offset } => {
            let reg_val = registers.get(register.0 as usize).copied()?;
            Some((reg_val as i64 + offset) as u64)
        }
        _ => None,
    }
}

// --- Evaluate variable location ---

fn evaluate_variable<'data>(
    dwarf: &gimli::Dwarf<R<'data>>,
    unit: &gimli::Unit<R<'data>>,
    name: &str,
    type_name: Option<String>,
    loc_attr: &gimli::AttributeValue<R<'data>>,
    pc: u64,
    frame_base: Option<u64>,
    registers: &[u64],
    stack_windows: &[StackWindow],
) -> VariableInfo {
    let expr = match loc_attr {
        gimli::AttributeValue::Exprloc(expr) if expr.0.is_empty() => {
            return VariableInfo {
                name: name.to_string(),
                type_name,
                location: "optimized out".to_string(),
                value: None,
            };
        }
        gimli::AttributeValue::Exprloc(expr) => Some(expr.clone()),
        gimli::AttributeValue::LocationListsRef(offset) => {
            find_loc_entry(dwarf, unit, *offset, pc)
        }
        _ => None,
    };

    let Some(expr) = expr else {
        return VariableInfo {
            name: name.to_string(),
            type_name,
            location: "optimized out (no location at this PC)".to_string(),
            value: None,
        };
    };

    eval_expr(name, type_name, &expr, unit.encoding(), frame_base, registers, stack_windows)
}

fn find_loc_entry<'data>(
    dwarf: &gimli::Dwarf<R<'data>>,
    unit: &gimli::Unit<R<'data>>,
    offset: gimli::LocationListsOffset,
    pc: u64,
) -> Option<gimli::Expression<R<'data>>> {
    let mut locs = dwarf.locations(unit, offset).ok()?;
    while let Ok(Some(entry)) = locs.next() {
        { let gimli::LocationListEntry { range, data, .. } = entry;
            if range.begin <= pc && pc < range.end {
                return Some(data);
            }
        }
    }
    None
}

fn eval_expr<'data>(
    name: &str,
    type_name: Option<String>,
    expr: &gimli::Expression<R<'data>>,
    encoding: gimli::Encoding,
    frame_base: Option<u64>,
    registers: &[u64],
    stack_windows: &[StackWindow],
) -> VariableInfo {
    let mut ops = expr.operations(encoding);

    // Collect first two operations (enough to detect common patterns)
    let op1 = ops.next().ok().flatten();
    let op2 = ops.next().ok().flatten();

    match (&op1, &op2) {
        // DW_OP_regN — variable IS in register N
        (Some(gimli::Operation::Register { register }), _) => {
            let idx = register.0 as usize;
            let reg_name = RISCV_ABI_NAMES.get(idx).unwrap_or(&"??");
            let value = registers.get(idx).map(|v| format!("0x{v:016X}"));
            VariableInfo {
                name: name.to_string(),
                type_name,
                location: format!("{reg_name} (x{idx})"),
                value,
            }
        }

        // DW_OP_fbreg <offset> — variable at frame_base + offset
        (Some(gimli::Operation::FrameOffset { offset }), None | Some(gimli::Operation::Piece { .. })) => {
            let offset = *offset;
            match frame_base {
                Some(fb) => {
                    let addr = (fb as i64 + offset) as u64;
                    let value = read_stack_u64(addr, stack_windows);
                    VariableInfo {
                        name: name.to_string(),
                        type_name,
                        location: format!("[CFA{:+}] (0x{addr:X})", offset),
                        value,
                    }
                }
                None => VariableInfo {
                    name: name.to_string(),
                    type_name,
                    location: format!("[frame_base{:+}] (frame base unknown)", offset),
                    value: None,
                },
            }
        }

        // DW_OP_bregN <offset> — value at register + offset
        (Some(gimli::Operation::RegisterOffset { register, offset, .. }), second) => {
            let idx = register.0 as usize;
            let offset = *offset;
            let reg_name = RISCV_ABI_NAMES.get(idx).unwrap_or(&"??");
            let base = registers.get(idx).copied();

            let is_stack_value = matches!(second, Some(gimli::Operation::StackValue));

            match (base, is_stack_value) {
                (Some(rv), true) => {
                    // DW_OP_bregN + DW_OP_stack_value: the computed value IS the variable
                    let val = (rv as i64 + offset) as u64;
                    VariableInfo {
                        name: name.to_string(),
                        type_name,
                        location: format!("{reg_name}{:+} (computed)", offset),
                        value: Some(format!("0x{val:016X}")),
                    }
                }
                (Some(rv), false) => {
                    // DW_OP_bregN: value at address register + offset
                    let addr = (rv as i64 + offset) as u64;
                    let value = read_stack_u64(addr, stack_windows);
                    VariableInfo {
                        name: name.to_string(),
                        type_name,
                        location: format!("[{reg_name}{:+}] (0x{addr:X})", offset),
                        value,
                    }
                }
                (None, _) => VariableInfo {
                    name: name.to_string(),
                    type_name,
                    location: format!("[{reg_name}{:+}] (register unavailable)", offset),
                    value: None,
                },
            }
        }

        _ => VariableInfo {
            name: name.to_string(),
            type_name,
            location: "complex expression".to_string(),
            value: None,
        },
    }
}

/// Read a u64 from stack windows if the address falls within one.
fn read_stack_u64(addr: u64, stack_windows: &[StackWindow]) -> Option<String> {
    for &(base, data) in stack_windows {
        let end = base + data.len() as u64;
        if addr >= base && addr + 8 <= end {
            let off = (addr - base) as usize;
            let bytes: [u8; 8] = data[off..off + 8].try_into().ok()?;
            let val = u64::from_le_bytes(bytes);
            return Some(format!("0x{val:016X}"));
        }
    }
    None
}

// --- Type name resolution ---

fn resolve_type_name<'data>(
    dwarf: &gimli::Dwarf<R<'data>>,
    unit: &gimli::Unit<R<'data>>,
    offset: gimli::UnitOffset,
) -> Option<String> {
    resolve_type_inner(dwarf, unit, offset, 0)
}

fn resolve_type_inner<'data>(
    dwarf: &gimli::Dwarf<R<'data>>,
    unit: &gimli::Unit<R<'data>>,
    offset: gimli::UnitOffset,
    depth: usize,
) -> Option<String> {
    if depth > 10 {
        return Some("...".to_string());
    }

    let entry = unit.entry(offset).ok()?;
    let tag = entry.tag();

    match tag {
        gimli::DW_TAG_base_type | gimli::DW_TAG_structure_type | gimli::DW_TAG_union_type | gimli::DW_TAG_enumeration_type => {
            let name = entry
                .attr_value(gimli::DW_AT_name)
                .ok()
                .flatten()
                .and_then(|v| dwarf.attr_string(unit, v).ok())
                .and_then(|s| Some(s.to_string_lossy().into_owned()));
            name.or_else(|| {
                let prefix = match tag {
                    gimli::DW_TAG_structure_type => "struct",
                    gimli::DW_TAG_union_type => "union",
                    gimli::DW_TAG_enumeration_type => "enum",
                    _ => "?",
                };
                Some(format!("{prefix} <anon>"))
            })
        }
        gimli::DW_TAG_typedef => {
            entry
                .attr_value(gimli::DW_AT_name)
                .ok()
                .flatten()
                .and_then(|v| dwarf.attr_string(unit, v).ok())
                .and_then(|s| Some(s.to_string_lossy().into_owned()))
        }
        gimli::DW_TAG_pointer_type => {
            let inner = entry
                .attr_value(gimli::DW_AT_type)
                .ok()
                .flatten()
                .and_then(|v| match v {
                    gimli::AttributeValue::UnitRef(off) => {
                        resolve_type_inner(dwarf, unit, off, depth + 1)
                    }
                    _ => None,
                })
                .unwrap_or("void".to_string());
            Some(format!("{inner} *"))
        }
        gimli::DW_TAG_const_type => {
            let inner = entry
                .attr_value(gimli::DW_AT_type)
                .ok()
                .flatten()
                .and_then(|v| match v {
                    gimli::AttributeValue::UnitRef(off) => {
                        resolve_type_inner(dwarf, unit, off, depth + 1)
                    }
                    _ => None,
                })
                .unwrap_or("void".to_string());
            Some(format!("const {inner}"))
        }
        gimli::DW_TAG_volatile_type => {
            let inner = entry
                .attr_value(gimli::DW_AT_type)
                .ok()
                .flatten()
                .and_then(|v| match v {
                    gimli::AttributeValue::UnitRef(off) => {
                        resolve_type_inner(dwarf, unit, off, depth + 1)
                    }
                    _ => None,
                })
                .unwrap_or("void".to_string());
            Some(format!("volatile {inner}"))
        }
        gimli::DW_TAG_array_type => {
            let inner = entry
                .attr_value(gimli::DW_AT_type)
                .ok()
                .flatten()
                .and_then(|v| match v {
                    gimli::AttributeValue::UnitRef(off) => {
                        resolve_type_inner(dwarf, unit, off, depth + 1)
                    }
                    _ => None,
                })
                .unwrap_or("?".to_string());
            Some(format!("{inner}[]"))
        }
        _ => None,
    }
}
