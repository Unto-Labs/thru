/* Reflected values - contains parsed data along with type information */

use crate::types::ReflectedType;
use serde::{Deserialize, Serialize};

/* A reflected value contains both type information and the parsed value */
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReflectedValue {
    /* Type information */
    pub type_info: ReflectedType,

    /* The parsed value */
    pub value: Value,
}

/* Enum representing all possible parsed values */
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Value {
    /* Primitive values */
    Primitive(PrimitiveValue),

    /* Struct values - map of field name to value */
    Struct {
        fields: Vec<(String, ReflectedValue)>,
    },

    /* Union value - contains the active variant name and its value */
    Union {
        variant_name: String,
        variant_value: Box<ReflectedValue>,
    },

    /* Enum value - contains the active variant name, tag value, and variant value */
    Enum {
        variant_name: String,
        tag_value: u64,
        variant_value: Box<ReflectedValue>,
    },

    /* Array value - contains element type and array of values */
    Array {
        elements: Vec<ReflectedValue>,
    },

    /* Size-discriminated union value */
    SizeDiscriminatedUnion {
        variant_name: String,
        variant_value: Box<ReflectedValue>,
    },

    /* Type reference value - points to another type */
    TypeRef {
        target_name: String,
        value: Box<ReflectedValue>,
    },
}

/* Primitive value representation */
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PrimitiveValue {
    U8(PrimitiveValueU8),
    U16(PrimitiveValueU16),
    U32(PrimitiveValueU32),
    U64(PrimitiveValueU64),
    I8(PrimitiveValueI8),
    I16(PrimitiveValueI16),
    I32(PrimitiveValueI32),
    I64(PrimitiveValueI64),
    F16(PrimitiveValueF16),
    F32(PrimitiveValueF32),
    F64(PrimitiveValueF64),
    Char(PrimitiveValueChar),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct PrimitiveValueU8 {
    #[serde(rename = "type")]
    pub type_name: String,
    pub value: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct PrimitiveValueU16 {
    #[serde(rename = "type")]
    pub type_name: String,
    pub value: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct PrimitiveValueU32 {
    #[serde(rename = "type")]
    pub type_name: String,
    pub value: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct PrimitiveValueU64 {
    #[serde(rename = "type")]
    pub type_name: String,
    pub value: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct PrimitiveValueI8 {
    #[serde(rename = "type")]
    pub type_name: String,
    pub value: i8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct PrimitiveValueI16 {
    #[serde(rename = "type")]
    pub type_name: String,
    pub value: i16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct PrimitiveValueI32 {
    #[serde(rename = "type")]
    pub type_name: String,
    pub value: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct PrimitiveValueI64 {
    #[serde(rename = "type")]
    pub type_name: String,
    pub value: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct PrimitiveValueF16 {
    #[serde(rename = "type")]
    pub type_name: String,
    pub value: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct PrimitiveValueF32 {
    #[serde(rename = "type")]
    pub type_name: String,
    pub value: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct PrimitiveValueF64 {
    #[serde(rename = "type")]
    pub type_name: String,
    pub value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct PrimitiveValueChar {
    #[serde(rename = "type")]
    pub type_name: String,
    /* Store as u8 since ABI char represents raw bytes (0-255), not Unicode code points */
    pub value: u8,
}

impl ReflectedValue {
    /* Create a new reflected value */
    pub fn new(type_info: ReflectedType, value: Value) -> Self {
        Self { type_info, value }
    }

    /* Get the type name */
    pub fn type_name(&self) -> &str {
        &self.type_info.name
    }

    /* Get the value */
    pub fn get_value(&self) -> &Value {
        &self.value
    }

    /* Get a struct field by name */
    pub fn get_struct_field(&self, field_name: &str) -> Option<&ReflectedValue> {
        if let Value::Struct { fields } = &self.value {
            fields
                .iter()
                .find(|(name, _)| name == field_name)
                .map(|(_, value)| value)
        } else {
            None
        }
    }

    /* Get array element by index */
    pub fn get_array_element(&self, index: usize) -> Option<&ReflectedValue> {
        if let Value::Array { elements } = &self.value {
            elements.get(index)
        } else {
            None
        }
    }

    /* Get array length */
    pub fn get_array_length(&self) -> Option<usize> {
        if let Value::Array { elements } = &self.value {
            Some(elements.len())
        } else {
            None
        }
    }

    /* Extract just the value chain (without type information) */
    pub fn extract_value(&self) -> ValueOnly {
        ValueOnly::from_reflected_value(self)
    }
}

/* Value-only representation - just the data without type metadata */
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ValueOnly {
    Primitive(PrimitiveValue),
    Struct(std::collections::HashMap<String, ValueOnly>),
    Union {
        variant: String,
        value: Box<ValueOnly>,
    },
    Enum {
        variant: String,
        value: Box<ValueOnly>,
    },
    Array(Vec<ValueOnly>),
    SizeDiscriminatedUnion {
        variant: String,
        value: Box<ValueOnly>,
    },
    TypeRef {
        target: String,
        value: Box<ValueOnly>,
    },
}

impl ValueOnly {
    /* Convert a ReflectedValue to ValueOnly (extract just the values) */
    pub fn from_reflected_value(reflected: &ReflectedValue) -> Self {
        match &reflected.value {
            Value::Primitive(p) => ValueOnly::Primitive(p.clone()),
            Value::Struct { fields } => {
                let mut map = std::collections::HashMap::new();
                for (name, field_value) in fields {
                    map.insert(name.clone(), ValueOnly::from_reflected_value(field_value));
                }
                ValueOnly::Struct(map)
            }
            Value::Union {
                variant_name,
                variant_value,
            } => ValueOnly::Union {
                variant: variant_name.clone(),
                value: Box::new(ValueOnly::from_reflected_value(variant_value)),
            },
            Value::Enum {
                variant_name,
                variant_value,
                ..
            } => ValueOnly::Enum {
                variant: variant_name.clone(),
                value: Box::new(ValueOnly::from_reflected_value(variant_value)),
            },
            Value::Array { elements } => ValueOnly::Array(
                elements
                    .iter()
                    .map(ValueOnly::from_reflected_value)
                    .collect(),
            ),
            Value::SizeDiscriminatedUnion {
                variant_name,
                variant_value,
            } => ValueOnly::SizeDiscriminatedUnion {
                variant: variant_name.clone(),
                value: Box::new(ValueOnly::from_reflected_value(variant_value)),
            },
            Value::TypeRef { target_name, value } => ValueOnly::TypeRef {
                target: target_name.clone(),
                value: Box::new(ValueOnly::from_reflected_value(value)),
            },
        }
    }
}

impl PrimitiveValue {
    /* Convert to u64 if possible */
    pub fn to_u64(&self) -> Option<u64> {
        match self {
            PrimitiveValue::U8(v) => Some(v.value as u64),
            PrimitiveValue::U16(v) => Some(v.value as u64),
            PrimitiveValue::U32(v) => Some(v.value as u64),
            PrimitiveValue::U64(v) => Some(v.value),
            PrimitiveValue::I8(v) if v.value >= 0 => Some(v.value as u64),
            PrimitiveValue::I16(v) if v.value >= 0 => Some(v.value as u64),
            PrimitiveValue::I32(v) if v.value >= 0 => Some(v.value as u64),
            PrimitiveValue::I64(v) if v.value >= 0 => Some(v.value as u64),
            PrimitiveValue::Char(v) => Some(v.value as u64),
            _ => None,
        }
    }

    /* Convert to i64 if possible */
    pub fn to_i64(&self) -> Option<i64> {
        match self {
            PrimitiveValue::U8(v) => Some(v.value as i64),
            PrimitiveValue::U16(v) => Some(v.value as i64),
            PrimitiveValue::U32(v) => Some(v.value as i64),
            PrimitiveValue::U64(v) if v.value <= i64::MAX as u64 => Some(v.value as i64),
            PrimitiveValue::I8(v) => Some(v.value as i64),
            PrimitiveValue::I16(v) => Some(v.value as i64),
            PrimitiveValue::I32(v) => Some(v.value as i64),
            PrimitiveValue::I64(v) => Some(v.value),
            PrimitiveValue::Char(v) => Some(v.value as i64),
            _ => None,
        }
    }

    /* Convert to f64 if possible */
    pub fn to_f64(&self) -> Option<f64> {
        match self {
            PrimitiveValue::F32(v) => Some(v.value as f64),
            PrimitiveValue::F64(v) => Some(v.value),
            _ => None,
        }
    }
}
