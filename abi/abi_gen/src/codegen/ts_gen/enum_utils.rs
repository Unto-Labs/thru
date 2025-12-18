use super::helpers::{escape_ts_keyword, struct_field_const_offset};
use super::ir_helpers::sanitize_param_name;
use crate::abi::expr::ExprKind;
use crate::abi::resolved::{ResolvedEnumVariant, ResolvedField, ResolvedType, ResolvedTypeKind};

#[derive(Clone)]
pub struct EnumFieldInfo<'a> {
    pub enum_field: &'a ResolvedField,
    pub tag_field: Option<&'a ResolvedField>,
    pub variants: &'a [ResolvedEnumVariant],
    pub enum_ts_name: String,
    pub tag_ts_name: String,
    pub descriptor_prop: String,
    pub payload_offset: Option<u64>,
    pub tag_offset: Option<u64>,
    pub is_tail: bool,
    pub tag_expression: Option<ExprKind>,
    pub tag_parameter: Option<String>,
    pub tag_param_ts_name: Option<String>,
}

pub fn enum_field_info<'a>(resolved_type: &'a ResolvedType) -> Option<EnumFieldInfo<'a>> {
    let fields = match &resolved_type.kind {
        ResolvedTypeKind::Struct { fields, .. } => fields,
        _ => return None,
    };
    let enum_field = fields
        .iter()
        .find(|field| matches!(field.field_type.kind, ResolvedTypeKind::Enum { .. }))?;
    build_enum_field_info(resolved_type, fields, enum_field)
}

pub fn enum_field_info_by_name<'a>(
    resolved_type: &'a ResolvedType,
    field_name: &str,
) -> Option<EnumFieldInfo<'a>> {
    let fields = match &resolved_type.kind {
        ResolvedTypeKind::Struct { fields, .. } => fields,
        _ => return None,
    };
    let enum_field = fields.iter().find(|field| {
        field.name == field_name && matches!(field.field_type.kind, ResolvedTypeKind::Enum { .. })
    })?;
    build_enum_field_info(resolved_type, fields, enum_field)
}

pub fn enum_field_infos<'a>(resolved_type: &'a ResolvedType) -> Vec<EnumFieldInfo<'a>> {
    let fields = match &resolved_type.kind {
        ResolvedTypeKind::Struct { fields, .. } => fields,
        _ => return Vec::new(),
    };
    fields
        .iter()
        .filter_map(|field| {
            if matches!(field.field_type.kind, ResolvedTypeKind::Enum { .. }) {
                build_enum_field_info(resolved_type, fields, field)
            } else {
                None
            }
        })
        .collect()
}

fn build_enum_field_info<'a>(
    struct_type: &'a ResolvedType,
    fields: &'a [ResolvedField],
    enum_field: &'a ResolvedField,
) -> Option<EnumFieldInfo<'a>> {
    let (variants, tag_data) = match &enum_field.field_type.kind {
        ResolvedTypeKind::Enum {
            variants,
            tag_expression,
            ..
        } => {
            if let Some(tag_name) = extract_field_name(tag_expression) {
                (variants, EnumTagSource::Field(tag_name.to_string()))
            } else {
                (variants, EnumTagSource::Computed(tag_expression.clone()))
            }
        }
        _ => return None,
    };

    let (tag_field_opt, tag_ts_name, tag_offset, tag_expression, tag_parameter) = match tag_data {
        EnumTagSource::Field(name) => {
            let tag_field = fields.iter().find(|field| field.name == name)?;
            let offset = tag_field
                .offset
                .or_else(|| struct_field_const_offset(struct_type, &tag_field.name));
            (
                Some(tag_field),
                escape_ts_keyword(&tag_field.name),
                offset,
                None,
                None,
            )
        }
        EnumTagSource::Computed(expr) => (
            None,
            escape_ts_keyword(&format!("{}_computed_tag", enum_field.name)),
            None,
            Some(expr.clone()),
            Some(format!("{}.computed_tag", enum_field.field_type.name)),
        ),
    };

    let payload_offset = enum_field
        .offset
        .or_else(|| struct_field_const_offset(struct_type, &enum_field.name));
    let is_tail = fields
        .iter()
        .enumerate()
        .find(|(_, field)| std::ptr::eq(*field, enum_field))
        .map(|(idx, _)| idx + 1 == fields.len())
        .unwrap_or(false);
    let tag_param_ts_name = tag_parameter.as_ref().map(|name| sanitize_param_name(name));

    Some(EnumFieldInfo {
        enum_field,
        tag_field: tag_field_opt,
        variants,
        enum_ts_name: escape_ts_keyword(&enum_field.name),
        tag_ts_name,
        descriptor_prop: format!("{}VariantDescriptors", escape_ts_keyword(&enum_field.name)),
        payload_offset,
        tag_offset,
        is_tail,
        tag_expression,
        tag_parameter,
        tag_param_ts_name,
    })
}

enum EnumTagSource {
    Field(String),
    Computed(ExprKind),
}

fn extract_field_name(expr: &ExprKind) -> Option<&str> {
    match expr {
        ExprKind::FieldRef(field_ref) if field_ref.path.len() == 1 => {
            field_ref.path.first().map(|s| s.as_str())
        }
        _ => None,
    }
}
