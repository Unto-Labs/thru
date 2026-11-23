use crate::expr::ExprKind;
use crate::synthetic::{FieldDisplay, StructDisplay, SyntheticField, SyntheticType};
use serde_derive::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub enum IntegralType {
    U8,
    U16,
    U32,
    U64,
    I8,
    I16,
    I32,
    I64,
    Char,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub enum FloatingPointType {
    F16,
    F32,
    F64,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub enum ValueFormat {
    Text,
    Json,
    Hex,
    Base64,
    Base64url,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
#[serde(untagged)]
#[serde(expecting = "expected integral or floating point type")]
pub enum PrimitiveType {
    Integral(IntegralType),
    FloatingPoint(FloatingPointType),
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct ContainerAttributes {
    #[serde(default)]
    pub packed: bool,
    #[serde(default)]
    pub aligned: u64,
    #[serde(default)]
    pub comment: Option<String>,
}

impl Default for ContainerAttributes {
    fn default() -> Self {
        Self {
            packed: false,
            aligned: 0,
            comment: None,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct EnumVariant {
    pub name: String,
    /// The tag as an unsigned 64-bit value. A negative literal (`tag-value:
    /// -101`) is accepted and stored as its 64-bit two's complement, so a
    /// program that reverts with a negative code can list it as written.
    #[serde(deserialize_with = "deserialize_tag_value")]
    pub tag_value: u64,
    /// One-sentence meaning of the variant, shown to people next to the name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    /// Omitting the payload type is shorthand for a zero-byte empty struct.
    #[serde(default = "empty_enum_variant_type")]
    pub variant_type: TypeKind,
}

fn deserialize_tag_value<'de, D>(deserializer: D) -> Result<u64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    struct TagValueVisitor;

    impl serde::de::Visitor<'_> for TagValueVisitor {
        type Value = u64;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("an integer between -(2^63) and 2^64-1")
        }

        fn visit_u64<E: serde::de::Error>(self, value: u64) -> Result<u64, E> {
            Ok(value)
        }

        fn visit_i64<E: serde::de::Error>(self, value: i64) -> Result<u64, E> {
            Ok(value as u64)
        }
    }

    deserializer.deserialize_any(TagValueVisitor)
}

fn empty_enum_variant_type() -> TypeKind {
    TypeKind::Struct(StructType {
        container_attributes: ContainerAttributes::default(),
        fields: Vec::new(),
        display: StructDisplay::default(),
    })
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct EnumType {
    #[serde(flatten)]
    pub container_attributes: ContainerAttributes,
    pub tag_ref: ExprKind,
    pub variants: Vec<EnumVariant>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct ArrayType {
    #[serde(flatten)]
    pub container_attributes: ContainerAttributes,
    pub size: ExprKind,
    pub element_type: Box<TypeKind>,
    /// When true, allows variable-size elements (jagged array). Each element must be
    /// self-describing (have a footprint function). Element access becomes O(n).
    #[serde(default)]
    pub jagged: bool,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct TypeRefType {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package: Option<String>,
    pub comment: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct UnionVariant {
    pub name: String,
    pub variant_type: TypeKind,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct UnionType {
    #[serde(flatten)]
    pub container_attributes: ContainerAttributes,
    pub variants: Vec<UnionVariant>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct SizeDiscriminatedVariant {
    pub name: String,
    pub expected_size: u64,
    pub variant_type: TypeKind,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct SizeDiscriminatedUnionType {
    #[serde(flatten)]
    pub container_attributes: ContainerAttributes,
    pub variants: Vec<SizeDiscriminatedVariant>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct StructField {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<ValueFormat>,
    pub field_type: TypeKind,
}

/// A struct's wire fields, plus display metadata that never affects layout.
///
/// In YAML, synthetic fields and per-field `display-name` / `user-display`
/// keys sit in the one ordered `fields` list. On load they are split out:
/// `fields` keeps only wire fields, so layout and codegen never see them.
#[derive(Debug, PartialEq, Eq, Clone)]
pub struct StructType {
    pub container_attributes: ContainerAttributes,
    pub fields: Vec<StructField>,
    pub display: StructDisplay,
}

/// One entry of a YAML `fields` list: a wire field or a synthetic field.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
struct FieldEntry {
    name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    format: Option<ValueFormat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    user_display: Option<bool>,
    #[serde(default, rename = "type", skip_serializing_if = "Option::is_none")]
    marker: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    return_type: Option<SyntheticType>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    expression: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    field_type: Option<TypeKind>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
struct StructTypeSchema {
    #[serde(flatten)]
    container_attributes: ContainerAttributes,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    display_name: Option<String>,
    fields: Vec<FieldEntry>,
}

impl serde::Serialize for StructType {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut entries = Vec::with_capacity(self.fields.len() + self.display.synthetic.len());
        let mut synthetic = self.display.synthetic.iter().peekable();
        for position in 0..=self.fields.len() {
            while let Some(field) = synthetic.next_if(|field| field.position <= position) {
                entries.push(FieldEntry {
                    name: field.name.clone(),
                    format: None,
                    display_name: field.display_name.clone(),
                    user_display: field.user_display,
                    marker: Some(SYNTHETIC_MARKER.to_string()),
                    return_type: Some(field.return_type.clone()),
                    expression: Some(field.expression.clone()),
                    field_type: None,
                });
            }
            if let Some(field) = self.fields.get(position) {
                let label = self.display.field_labels.get(&field.name);
                entries.push(FieldEntry {
                    name: field.name.clone(),
                    format: field.format.clone(),
                    display_name: label.and_then(|label| label.display_name.clone()),
                    user_display: label.and_then(|label| label.user_display),
                    marker: None,
                    return_type: None,
                    expression: None,
                    field_type: Some(field.field_type.clone()),
                });
            }
        }
        StructTypeSchema {
            container_attributes: self.container_attributes.clone(),
            display_name: self.display.display_name.clone(),
            fields: entries,
        }
        .serialize(serializer)
    }
}

impl<'de> serde::Deserialize<'de> for StructType {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        use serde::de::Error;
        let schema = StructTypeSchema::deserialize(deserializer)?;
        let mut fields = Vec::with_capacity(schema.fields.len());
        let mut display = StructDisplay {
            display_name: schema.display_name,
            ..StructDisplay::default()
        };
        for entry in schema.fields {
            let is_synthetic = match entry.marker.as_deref() {
                None => false,
                Some(SYNTHETIC_MARKER) => true,
                Some(other) => {
                    return Err(D::Error::custom(format!(
                        "field '{}': unknown field type '{other}'",
                        entry.name
                    )))
                }
            };
            if is_synthetic {
                let (Some(return_type), Some(expression), None, None) = (
                    entry.return_type,
                    entry.expression,
                    &entry.field_type,
                    &entry.format,
                ) else {
                    return Err(D::Error::custom(format!(
                        "synthetic field '{}' needs return-type and expression, and no field-type or format",
                        entry.name
                    )));
                };
                display.synthetic.push(SyntheticField {
                    name: entry.name,
                    return_type,
                    expression,
                    display_name: entry.display_name,
                    user_display: entry.user_display,
                    position: fields.len(),
                });
                continue;
            }
            let Some(field_type) = entry.field_type else {
                return Err(D::Error::custom(format!(
                    "field '{}' needs field-type (or type: synthetic)",
                    entry.name
                )));
            };
            if entry.return_type.is_some() || entry.expression.is_some() {
                return Err(D::Error::custom(format!(
                    "field '{}': return-type and expression need type: synthetic",
                    entry.name
                )));
            }
            if entry.display_name.is_some() || entry.user_display.is_some() {
                display.field_labels.insert(
                    entry.name.clone(),
                    FieldDisplay {
                        display_name: entry.display_name,
                        user_display: entry.user_display,
                    },
                );
            }
            fields.push(StructField {
                name: entry.name,
                format: entry.format,
                field_type,
            });
        }
        Ok(StructType {
            container_attributes: schema.container_attributes,
            fields,
            display,
        })
    }
}

const SYNTHETIC_MARKER: &str = "synthetic";

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub enum TypeKind {
    Struct(StructType),
    Union(UnionType),
    Enum(EnumType),
    Array(ArrayType),
    SizeDiscriminatedUnion(SizeDiscriminatedUnionType),
    Primitive(PrimitiveType),
    TypeRef(TypeRefType),
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct TypeDef {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<ValueFormat>,
    #[serde(with = "serde_yml::with::singleton_map_recursive")]
    pub kind: TypeKind,
}
