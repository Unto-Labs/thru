/* Well-known type handlers */

mod pubkey;
mod signature;
mod hash;
mod timestamp;
mod duration;
mod date;
mod datetime;
mod time_of_day;
mod decimal;
mod fixed_point;
mod fraction;
mod color;
mod latlng;
mod money;
mod quaternion;
mod interval;
mod day_of_week;
mod month;
mod calendar_period;
mod instruction_data;

pub use pubkey::PubkeyHandler;
pub use signature::SignatureHandler;
pub use hash::HashHandler;
pub use timestamp::TimestampHandler;
pub use duration::DurationHandler;
pub use date::DateHandler;
pub use datetime::DateTimeHandler;
pub use time_of_day::TimeOfDayHandler;
pub use decimal::DecimalHandler;
pub use fixed_point::FixedPointHandler;
pub use fraction::FractionHandler;
pub use color::ColorHandler;
pub use latlng::LatLngHandler;
pub use money::MoneyHandler;
pub use quaternion::QuaternionHandler;
pub use interval::IntervalHandler;
pub use day_of_week::DayOfWeekHandler;
pub use month::MonthHandler;
pub use calendar_period::CalendarPeriodHandler;
pub use instruction_data::InstructionDataHandler;

use crate::value::{PrimitiveValue, ReflectedValue, Value};

/* Helper to extract bytes from a struct with a single "bytes" field */
pub(crate) fn try_extract_bytes_field(
    fields: &[(String, ReflectedValue)],
    expected_len: usize,
) -> Option<Vec<u8>> {
    if fields.len() != 1 {
        return None;
    }
    let (name, value) = &fields[0];
    if name != "bytes" {
        return None;
    }
    if let Value::Array { elements } = value.get_value() {
        if elements.len() == expected_len && elements.iter().all(is_u8_element) {
            return Some(elements.iter().filter_map(extract_u8).collect());
        }
    }
    None
}

/* Helper to check if value is a u8 primitive */
fn is_u8_element(value: &ReflectedValue) -> bool {
    use crate::types::ReflectedTypeKind;
    use abi_gen::abi::types::{IntegralType, PrimitiveType};
    matches!(
        value.type_info.kind,
        ReflectedTypeKind::Primitive {
            prim_type: PrimitiveType::Integral(IntegralType::U8)
        }
    ) && matches!(value.get_value(), Value::Primitive(_))
}

/* Helper to extract u8 from reflected value */
fn extract_u8(value: &ReflectedValue) -> Option<u8> {
    match value.get_value() {
        Value::Primitive(PrimitiveValue::U8(v)) => Some(v.value),
        _ => None,
    }
}

/* Helper to extract a field value by name */
pub(crate) fn get_field<'a>(
    fields: &'a [(String, ReflectedValue)],
    name: &str,
) -> Option<&'a ReflectedValue> {
    fields.iter().find(|(n, _)| n == name).map(|(_, v)| v)
}

/* Helper to extract i64 from a primitive field */
pub(crate) fn extract_i64(value: &ReflectedValue) -> Option<i64> {
    match value.get_value() {
        Value::Primitive(PrimitiveValue::I64(v)) => Some(v.value),
        Value::Primitive(PrimitiveValue::U64(v)) => Some(v.value as i64),
        Value::Primitive(PrimitiveValue::I32(v)) => Some(v.value as i64),
        Value::Primitive(PrimitiveValue::U32(v)) => Some(v.value as i64),
        _ => None,
    }
}

/* Helper to extract i32 from a primitive field */
pub(crate) fn extract_i32(value: &ReflectedValue) -> Option<i32> {
    match value.get_value() {
        Value::Primitive(PrimitiveValue::I32(v)) => Some(v.value),
        Value::Primitive(PrimitiveValue::U32(v)) => Some(v.value as i32),
        Value::Primitive(PrimitiveValue::I16(v)) => Some(v.value as i32),
        Value::Primitive(PrimitiveValue::U16(v)) => Some(v.value as i32),
        Value::Primitive(PrimitiveValue::I8(v)) => Some(v.value as i32),
        Value::Primitive(PrimitiveValue::U8(v)) => Some(v.value as i32),
        _ => None,
    }
}

/* Helper to extract u8 from a primitive field */
pub(crate) fn extract_u8_field(value: &ReflectedValue) -> Option<u8> {
    match value.get_value() {
        Value::Primitive(PrimitiveValue::U8(v)) => Some(v.value),
        _ => None,
    }
}

/* Helper to extract u16 from a primitive field */
pub(crate) fn extract_u16(value: &ReflectedValue) -> Option<u16> {
    match value.get_value() {
        Value::Primitive(PrimitiveValue::U16(v)) => Some(v.value),
        Value::Primitive(PrimitiveValue::U8(v)) => Some(v.value as u16),
        _ => None,
    }
}

/* Helper to extract u64 from a primitive field */
pub(crate) fn extract_u64(value: &ReflectedValue) -> Option<u64> {
    match value.get_value() {
        Value::Primitive(PrimitiveValue::U64(v)) => Some(v.value),
        Value::Primitive(PrimitiveValue::U32(v)) => Some(v.value as u64),
        Value::Primitive(PrimitiveValue::U16(v)) => Some(v.value as u64),
        Value::Primitive(PrimitiveValue::U8(v)) => Some(v.value as u64),
        _ => None,
    }
}

/* Helper to extract f32 from a primitive field */
pub(crate) fn extract_f32(value: &ReflectedValue) -> Option<f32> {
    match value.get_value() {
        Value::Primitive(PrimitiveValue::F32(v)) => Some(v.value),
        Value::Primitive(PrimitiveValue::F16(v)) => Some(v.value as f32),
        _ => None,
    }
}

/* Helper to extract f64 from a primitive field */
pub(crate) fn extract_f64(value: &ReflectedValue) -> Option<f64> {
    match value.get_value() {
        Value::Primitive(PrimitiveValue::F64(v)) => Some(v.value),
        Value::Primitive(PrimitiveValue::F32(v)) => Some(v.value as f64),
        _ => None,
    }
}

/* Helper to extract bytes from an array field */
pub(crate) fn extract_bytes(value: &ReflectedValue) -> Option<Vec<u8>> {
    if let Value::Array { elements } = value.get_value() {
        let bytes: Vec<u8> = elements.iter().filter_map(extract_u8).collect();
        if bytes.len() == elements.len() {
            return Some(bytes);
        }
    }
    None
}
