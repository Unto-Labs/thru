/* Exercise named arrays directly, without synthesizing a containing struct. */
use abi_gen::abi::file::AbiFile;
use abi_gen::abi::resolved::{ResolvedTypeKind, Size, TypeResolver};
use abi_gen::abi::types::TypeKind;
use anyhow::{bail, Result};
use std::{fs, path::Path};

pub struct ArrayLayout {
    package: String,
    count: u64,
    stride: u64,
    size: u64,
}

pub fn load(path: &Path, name: &str) -> Result<Option<ArrayLayout>> {
    let abi: AbiFile = serde_yaml::from_str(&fs::read_to_string(path)?)?;
    if !abi
        .types
        .iter()
        .any(|t| t.name == name && matches!(t.kind, TypeKind::Array(_)))
    {
        return Ok(None);
    }
    let mut resolver = TypeResolver::new();
    for typedef in &abi.types {
        resolver.add_typedef(typedef.clone());
    }
    resolver
        .resolve_all()
        .map_err(|e| anyhow::anyhow!("{e:?}"))?;
    let resolved = resolver.get_type_info(name).unwrap();
    let ResolvedTypeKind::Array { element_type, .. } = &resolved.kind else {
        unreachable!();
    };
    let (Size::Const(size), Size::Const(stride)) = (&resolved.size, &element_type.size) else {
        bail!("Top-level array compliance requires a fixed layout");
    };
    if *stride == 0 {
        bail!("Top-level array compliance requires nonzero element size");
    }
    Ok(Some(ArrayLayout {
        package: abi.package().to_string(),
        count: size / stride,
        stride: *stride,
        size: *size,
    }))
}

impl ArrayLayout {
    pub fn c(&self, name: &str, data: &[u8]) -> String {
        let package = self.package.replace('.', "/");
        let bytes = data
            .iter()
            .map(u8::to_string)
            .collect::<Vec<_>>()
            .join(", ");
        let Self {
            count,
            stride,
            size,
            ..
        } = self;
        format!(
            r#"#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "generated_code/{package}/types.h"

int main( void ) {{
    uint8_t const data[] = {{ {bytes} }};
    _Static_assert( sizeof({name}_t) == {size}, "array footprint" );
    _Static_assert( sizeof((({name}_t *)0)[0][0]) == {stride}, "element stride" );
    uint64_t consumed = 0;
    assert( {name}_validate_ir( sizeof(data), &consumed ) == 0 );
    assert( consumed == sizeof(data) );
    assert( {name}_footprint_ir() == sizeof(data) );
    if( sizeof(data) > 0 ) assert( {name}_validate_ir( sizeof(data) - 1, NULL ) != 0 );
    {name}_t original;
    {name}_t reencoded = {{0}};
    memcpy( &original, data, sizeof(original) );
    puts( "DECODE:ok\nVALIDATION:ok" );
    for( uint64_t i = 0; i < {count}; i++ ) {{
        assert( memcmp( &original[i], data + i * {stride}, {stride} ) == 0 );
        memcpy( &reencoded[i], &original[i], sizeof(original[i]) );
    }}
    assert( memcmp( &reencoded, data, sizeof(reencoded) ) == 0 );
    puts( "REENCODE:ok\nBINARY_MATCH:true" );
    return 0;
}}

#include "generated_code/{package}/functions.c"
"#
        )
    }

    pub fn rust(&self, name: &str, data: &[u8]) -> String {
        let package = self.package.replace('.', "::");
        let Self {
            count,
            stride,
            size,
            ..
        } = self;
        format!(
            r#"mod generated;
use generated::{package}::{{{name}, {name}Mut}};

fn main() {{
    let data: &[u8] = &{data:?};
    let original = {name}::from_slice(data).expect("decode array");
    assert_eq!(original.size(), {size});
    if !data.is_empty() {{ assert!({name}::from_slice(&data[..data.len()-1]).is_err()); }}
    println!("DECODE:ok\nVALIDATION:ok");
    let mut bytes = vec![0u8; {size}];
    let mut reencoded = {name}Mut::from_slice_mut(&mut bytes).expect("mutable array");
    for i in 0..{count} {{
        let range = i * {stride}..(i + 1) * {stride};
        let element = &original.as_bytes()[range.clone()];
        assert_eq!(element, &data[range.clone()]);
        reencoded.as_bytes_mut()[range].copy_from_slice(element);
    }}
    assert_eq!(reencoded.as_bytes(), data);
    println!("REENCODE:ok\nBINARY_MATCH:true");
}}
"#
        )
    }

    pub fn typescript(&self, name: &str, data: &[u8]) -> String {
        let package = self.package.replace('.', "/");
        let Self {
            count,
            stride,
            size,
            ..
        } = self;
        format!(
            r#"import assert from 'node:assert/strict';
import {{ {name} }} from './generated/{package}/types.js';

const data = new Uint8Array({data:?});
const original = {name}.from_array(data);
assert.ok(original);
assert.equal(original.length, {count});
if (data.length > 0) assert.equal({name}.from_array(data.subarray(0, data.length - 1)), null);
console.log('DECODE:ok\nVALIDATION:ok');
const bytes = new Uint8Array({size});
const reencoded = {name}.from_array(bytes);
assert.ok(reencoded);
for (let i = 0; i < {count}; i++) {{
    const element: Uint8Array = original.getElementBytes(i);
    assert.deepEqual(element, data.subarray(i * {stride}, (i + 1) * {stride}));
    reencoded.getElementBytes(i).set(element);
}}
assert.throws(() => original.getElementBytes({count}), RangeError);
assert.deepEqual(reencoded.asUint8Array(), data);
console.log('REENCODE:ok\nBINARY_MATCH:true');
"#
        )
    }
}
