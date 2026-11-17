/* C compliance runner.

Generates C for the case's ABI, then builds a test program that:
- validates the input (consumed == len, a truncated buffer is rejected),
- extracts params from the buffer and checks footprint_from_params == len,
- re-encodes the value into a fresh buffer sized by footprint_from_params
  using only the generated public API: field setters, nested views, enum
  variant views (`<S>_<f>_as_<V>`), select helpers, array element accessors
  (including jagged arrays), SDU variant views and union variant setters,
- requires a byte-identical result and that the copy validates.

The zero-filled pass writes nested struct / type-ref fields through their
whole-value setters instead: `<S>_set_<f>( d, value )` for a constant-size
field, and `<S>_set_<f>_bytes( d, src, n )` after the field is copied for a
variable-size one (a size other than the current one must be rejected).
Arrays with a count-writing setter are written again through
`<S>_set_<f>( d, src, n )` at the count in place, after checking that
another count is rejected.

The copy is walked from the resolved type tree; no field is skipped and no
buffer-wide memcpy is used. The copy runs twice: into a zeroed buffer and
into one prefilled with the complement of the input, so a field the copy
never writes cannot pass by coincidence (the complement pass is skipped
when a non-packed struct leaves padding no field setter covers). */

use anyhow::{Context, Result};
use std::collections::BTreeSet;
use std::fmt::Write as _;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::Instant;

use super::LanguageRunner;
use crate::{TestCaseData, TestError, TestResult, TestStages};

use abi_gen::abi::file::ImportResolver;
use abi_gen::cmds::common::{analyze_and_resolve_types, normalize_type_refs};
use abi_gen::codegen::c_gen::model::{
    prim_c_type, Field, Model, Node, NodeId, NodeKind, Slot, ValueSetter, Variant,
};

pub struct CRunner;

fn fail(
    test_name: &str,
    test_file: &str,
    start: Instant,
    stages: TestStages,
    stage: &str,
    message: &str,
    details: Option<String>,
) -> Result<TestResult> {
    Ok(TestResult {
        test_name: test_name.to_string(),
        test_file: test_file.to_string(),
        status: "fail".to_string(),
        duration_ms: start.elapsed().as_millis() as u64,
        stages: Some(stages),
        error: Some(TestError {
            stage: stage.to_string(),
            message: message.to_string(),
            details,
        }),
    })
}

impl LanguageRunner for CRunner {
    fn language_name(&self) -> &str {
        "c"
    }

    fn codegen_language_param(&self) -> &str {
        "c"
    }

    fn run_test(
        &self,
        test_name: &str,
        test_file: &str,
        test_case: &TestCaseData,
        abi_file_path: &Path,
        binary_data: &[u8],
        verbose: bool,
        no_cleanup: bool,
        base_temp_dir: Option<&Path>,
    ) -> Result<TestResult> {
        let start = Instant::now();
        let temp_base = base_temp_dir
            .map(|p| p.to_path_buf())
            .unwrap_or_else(std::env::temp_dir);
        let temp_dir = temp_base.join(format!("abi_compliance_c_{}", test_name));
        if temp_dir.exists() {
            fs::remove_dir_all(&temp_dir)?;
        }
        let generated_code_dir = temp_dir.join("generated_code");
        fs::create_dir_all(&generated_code_dir)?;
        if verbose {
            println!("  Temp dir: {}", temp_dir.display());
        }

        let mut stages = TestStages {
            code_generation: "pending".to_string(),
            compilation: "pending".to_string(),
            decode: "pending".to_string(),
            validation: "pending".to_string(),
            reencode: "pending".to_string(),
            binary_match: false,
        };

        /* Stage 1: generate C */
        if let Err(e) = abi_gen::cmds::codegen::run(
            vec![abi_file_path.to_path_buf()],
            Vec::new(),
            abi_gen::cmds::codegen::Language::C,
            generated_code_dir.clone(),
            false,
        ) {
            return fail(
                test_name,
                test_file,
                start,
                stages,
                "code_generation",
                "Code generation failed",
                Some(format!("{e:#}")),
            );
        }
        stages.code_generation = "ok".to_string();

        /* Stage 2: build the round-trip program */
        let program = match build_program(abi_file_path, &test_case.type_name, binary_data) {
            Ok(p) => p,
            Err(e) => {
                return fail(
                    test_name,
                    test_file,
                    start,
                    stages,
                    "code_generation",
                    "Failed to build the C test program",
                    Some(format!("{e:#}")),
                )
            }
        };
        let test_path = temp_dir.join("test.c");
        fs::write(&test_path, program)?;
        let cc = std::env::var("CC").unwrap_or_else(|_| "cc".to_string());
        let output = Command::new(&cc)
            .args(["-std=c11", "-Wall", "-Werror", "-o"])
            .arg(temp_dir.join("test"))
            .arg(&test_path)
            .current_dir(&temp_dir)
            .output()
            .context("running the C compiler")?;
        if !output.status.success() {
            return fail(
                test_name,
                test_file,
                start,
                stages,
                "compilation",
                "Test compilation failed",
                Some(String::from_utf8_lossy(&output.stderr).to_string()),
            );
        }
        stages.compilation = "ok".to_string();

        /* Stages 3-5: run */
        let output = Command::new(temp_dir.join("test"))
            .output()
            .context("running the C test program")?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        for line in stdout.lines() {
            if let Some(v) = line.strip_prefix("DECODE:") {
                stages.decode = v.to_string();
            } else if let Some(v) = line.strip_prefix("VALIDATION:") {
                stages.validation = v.to_string();
            } else if let Some(v) = line.strip_prefix("REENCODE:") {
                stages.reencode = v.to_string();
            } else if let Some(v) = line.strip_prefix("BINARY_MATCH:") {
                stages.binary_match = v == "true";
            }
        }
        if !output.status.success() {
            return fail(
                test_name,
                test_file,
                start,
                stages,
                "decode",
                "Test execution failed",
                Some(format!(
                    "stdout:\n{}\nstderr:\n{}",
                    stdout,
                    String::from_utf8_lossy(&output.stderr)
                )),
            );
        }

        if !no_cleanup {
            let _ = fs::remove_dir_all(&temp_dir);
        } else if verbose {
            println!("  Temporary directory preserved at: {}", temp_dir.display());
        }

        let pass = stages.code_generation == "ok"
            && stages.compilation == "ok"
            && stages.decode == "ok"
            && stages.validation == "ok"
            && stages.reencode == "ok"
            && stages.binary_match;
        Ok(TestResult {
            test_name: test_name.to_string(),
            test_file: test_file.to_string(),
            status: if pass { "pass" } else { "fail" }.to_string(),
            duration_ms: start.elapsed().as_millis() as u64,
            stages: Some(stages),
            error: None,
        })
    }
}

/* Resolve the ABI exactly as `abi codegen` does and emit the test program. */
fn build_program(abi_path: &Path, type_name: &str, data: &[u8]) -> Result<String> {
    let mut imports = ImportResolver::new(Vec::new());
    imports.load_file_with_imports(abi_path, false)?;
    let mut typedefs = imports.get_all_types().to_vec();
    normalize_type_refs(&mut typedefs, &imports)?;
    let resolver = analyze_and_resolve_types(&typedefs, false)?;
    let package = imports
        .get_package_for_type(type_name)
        .with_context(|| format!("no package for {type_name}"))?;

    let mut model = Model::new(&resolver);
    let root = model.named(type_name);
    let mut gen = CopyGen {
        m: &model,
        protos: String::new(),
        defs: String::new(),
        done: BTreeSet::new(),
    };
    gen.copy_fn(root);
    let root_node = model.node(model.resolve_alias(root));
    let root_c = &model.node(root).c_name;
    let pn = root_node.needs_params();
    let complement = !gen.has_padding(root, &mut BTreeSet::new());

    let pkg_dir = package.replace('.', "/");
    let bytes = if data.is_empty() {
        "0".to_string()
    } else {
        data.iter()
            .map(|b| format!("0x{b:02x}"))
            .collect::<Vec<_>>()
            .join(", ")
    };
    let mut p = String::new();
    writeln!(
        p,
        r#"#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "generated_code/{pkg_dir}/types.h"
#include "generated_code/{pkg_dir}/functions.c"

#define TN_FAIL( ... ) do {{ fprintf( stderr, __VA_ARGS__ ); fprintf( stderr, " (line %d)\n", __LINE__ ); return 1; }} while( 0 )
#define TN_CHECK( c ) do {{ if( !( c ) ) TN_FAIL( "check failed: %s", #c ); }} while( 0 )
#define TN_RC( e ) do {{ int tn_rc_ = ( e ); if( tn_rc_ ) {{ fprintf( stderr, "%s returned %d (line %d)\n", #e, tn_rc_, __LINE__ ); return 1; }} }} while( 0 )

static uint8_t const tn_data[] = {{ {bytes} }};
static uint64_t const tn_len = {len}UL;

/* Write nested values through the whole-value setters (zero-filled pass). */
static int tn_whole;
"#,
        len = data.len()
    )?;
    p.push_str(&gen.protos);
    p.push('\n');
    p.push_str(&gen.defs);

    let params_arg = if pn { ", &params" } else { "" };
    writeln!(
        p,
        r#"/* Copy of the members the key table marks as inputs (zero elsewhere). */
static void tn_inputs( {root_c}_params_t const * all, {root_c}_params_t * out ) {{
  memset( out, 0, sizeof *out );
  for( uint64_t i=0UL; i<{root_c}_PARAM_KEY_CNT; i++ ) {{
    if( {root_c}_param_keys[i].input ) memcpy( (uint8_t *)out+{root_c}_param_keys[i].offset, (uint8_t const *)all+{root_c}_param_keys[i].offset, 8UL );
  }}
}}

/* Re-encode into a buffer prefilled with zeros (fill 0) or the complement of
   the input (fill 1), or prefilled with the complement and then set up by
   <T>_init from the input params (init). `whole` selects the whole-value
   setters for nested values. */
static int tn_reencode( uint8_t fill, int init, int whole ) {{
  {root_c}_params_t params;
  tn_whole = whole;
  memset( &params, 0, sizeof params );
  TN_RC( {root_c}_params_from_buffer( tn_data, tn_len, &params ) );
  uint64_t fp = 0UL;
  TN_RC( {root_c}_footprint_from_params( &params, &fp ) );
  TN_CHECK( fp==tn_len );
  {root_c}_t const * src = {root_c}_from_slice( tn_data, tn_len );
  TN_CHECK( src!=NULL );
  uint8_t * dst = malloc( fp ? fp : 1UL );
  TN_CHECK( dst!=NULL );
  for( uint64_t i=0UL; i<fp; i++ ) dst[i] = fill ? (uint8_t)~tn_data[i] : (uint8_t)0;
  if( init ) {{
    {root_c}_params_t inputs;
    uint64_t isz = 0UL;
    tn_inputs( &params, &inputs );
    if( fp ) TN_CHECK( {root_c}_init( dst, fp-1UL, &inputs, &isz )==TN_ABI_ERR_SHORT_BUFFER && isz==fp );
    TN_RC( {root_c}_init( dst, fp, &inputs, &isz ) );
    TN_CHECK( isz==fp );
  }}
  if( tn_copy_{root_c}( src, &params, ({root_c}_t *)dst, &params ) ) {{ free( dst ); TN_FAIL( "copy failed (fill %u)", fill ); }}
  for( uint64_t i=0UL; i<fp; i++ ) {{
    if( dst[i]!=tn_data[i] ) {{
      fprintf( stderr, "byte %lu differs: got %02x want %02x (fill %u)\n", (unsigned long)i, dst[i], tn_data[i], fill );
      printf( "BINARY_MATCH:false\n" );
      free( dst );
      return 1;
    }}
  }}
  uint64_t consumed = 0UL;
  int rc = {root_c}_validate( dst, fp, &consumed );
  free( dst );
  TN_CHECK( rc==0 && consumed==fp );
  return 0;
}}

int main( void ) {{
  uint64_t consumed = 0UL;
  int rc = {root_c}_validate( tn_data, tn_len, &consumed );
  if( rc ) {{ printf( "VALIDATION:error\n" ); TN_FAIL( "validate returned %d", rc ); }}
  TN_CHECK( consumed==tn_len );
  {root_c}_t const * src = {root_c}_from_slice( tn_data, tn_len );
  if( !src ) {{ printf( "DECODE:error\n" ); TN_FAIL( "from_slice failed" ); }}
  printf( "DECODE:ok\n" );
  {root_c}_params_t params;
  memset( &params, 0, sizeof params );
  TN_RC( {root_c}_params_from_buffer( tn_data, tn_len, &params ) );
  TN_CHECK( {root_c}_size( src{params_arg} )==tn_len );
  {{
    /* The members the key table marks as inputs are enough to size the value. */
    {root_c}_params_t inputs;
    uint64_t fp = 0UL;
    TN_CHECK( {root_c}_param_keys[{root_c}_PARAM_KEY_CNT].member==NULL );
    for( uint64_t i=0UL; i<{root_c}_PARAM_KEY_CNT; i++ ) TN_CHECK( {root_c}_param_keys[i].offset+8UL<=sizeof inputs );
    tn_inputs( &params, &inputs );
    TN_RC( {root_c}_footprint_from_params( &inputs, &fp ) );
    TN_CHECK( fp==tn_len );
  }}
  TN_CHECK( {root_c}_validate( tn_data, tn_len, NULL )==TN_ABI_OK );
  TN_CHECK( {root_c}_from_slice( NULL, tn_len )==NULL );"#
    )?;
    if !root_node.len_dep {
        /* A truncated buffer is rejected; the required size it reports is
        either unknown (0) or the real size (always known for fixed sizes). */
        let fixed = if root_node.const_size.is_some() {
            " TN_CHECK( need==tn_len );"
        } else {
            ""
        };
        writeln!(
            p,
            "  if( tn_len ) {{ uint64_t need = 1UL; TN_CHECK( {root_c}_validate( tn_data, tn_len-1UL, &need )!=TN_ABI_OK ); TN_CHECK( need==0UL || need==tn_len );{fixed} }}"
        )?;
    }
    writeln!(
        p,
        r#"  printf( "VALIDATION:ok\n" );
  if( tn_reencode( 0, 0, 1 ) ) {{ printf( "REENCODE:error\n" ); return 1; }}
  if( tn_reencode( 1, 1, 0 ) ) {{ printf( "REENCODE:error\n" ); return 1; }}"#
    )?;
    if complement {
        writeln!(
            p,
            "  if( tn_reencode( 1, 0, 0 ) ) {{ printf( \"REENCODE:error\\n\" ); return 1; }}"
        )?;
    }
    writeln!(
        p,
        "  printf( \"REENCODE:ok\\nBINARY_MATCH:true\\n\" );\n  return 0;\n}}"
    )?;
    Ok(p)
}

struct CopyGen<'m, 'a> {
    m: &'m Model<'a>,
    protos: String,
    defs: String,
    done: BTreeSet<NodeId>,
}

/* `, x` when node `n`'s API takes params. */
fn pa(n: &Node, x: &str) -> String {
    if n.needs_params() {
        format!(", {x}")
    } else {
        String::new()
    }
}

impl<'m, 'a> CopyGen<'m, 'a> {
    fn r(&self, id: NodeId) -> &'m Node {
        self.m.node(self.m.resolve_alias(id))
    }

    /* Whether any struct reachable from `id` is non-packed (may hold padding). */
    fn has_padding(&self, id: NodeId, seen: &mut BTreeSet<NodeId>) -> bool {
        let id = self.m.resolve_alias(id);
        if !seen.insert(id) {
            return false;
        }
        let n = self.m.node(id);
        let slots: Vec<Slot> = match &n.kind {
            NodeKind::Struct { fields, packed } => {
                if !packed {
                    return true;
                }
                fields.iter().map(|f| f.slot.clone()).collect()
            }
            NodeKind::Union { variants } => variants.iter().map(|f| f.slot.clone()).collect(),
            NodeKind::Enum { variants, .. } | NodeKind::Sdu { variants } => {
                variants.iter().map(|v| v.slot.clone()).collect()
            }
            NodeKind::Array { elem, .. } => vec![elem.clone()],
            NodeKind::Prim(_) | NodeKind::Alias { .. } => Vec::new(),
        };
        slots.iter().any(|s| match s {
            Slot::Node(c) => self.has_padding(*c, seen),
            Slot::Prim(_) => false,
        })
    }

    /* Ensures `tn_copy_<X>` exists; returns the C name of X. */
    fn copy_fn(&mut self, id: NodeId) -> String {
        let id = self.m.resolve_alias(id);
        let n = self.m.node(id);
        let c = n.c_name.clone();
        if !self.done.insert(id) {
            return c;
        }
        let sig = format!(
            "static int tn_copy_{c}( {c}_t const * s, {c}_params_t const * sp, {c}_t * d, {c}_params_t const * dp )"
        );
        writeln!(self.protos, "{sig};").unwrap();
        let mut b = String::from("  int rc = 0;\n  (void)sp; (void)dp; (void)rc;\n");
        match &n.kind {
            NodeKind::Prim(_) => {
                writeln!(b, "  TN_RC( {c}_set( d, {c}_get( s ) ) );").unwrap();
            }
            NodeKind::Struct { fields, .. } => {
                for f in fields {
                    self.copy_field(n, f, &mut b);
                }
            }
            NodeKind::Union { variants } => {
                writeln!(b, "  TN_CHECK( {c}_VARIANT_CNT=={}UL );", variants.len()).unwrap();
                for (idx, f) in variants.iter().enumerate() {
                    writeln!(
                        b,
                        "  TN_CHECK( {c}_variant_by_name( \"{}\" )==&{c}_variants[{idx}] );",
                        f.name
                    )
                    .unwrap();
                }
                /* Write the widest variant, then check every variant reads back equal. */
                let widest = variants
                    .iter()
                    .max_by_key(|f| {
                        (
                            self.m.slot_size(&f.slot).unwrap_or(0),
                            std::cmp::Reverse(f.ident.clone()),
                        )
                    })
                    .cloned();
                if let Some(w) = widest {
                    self.copy_field(n, &w, &mut b);
                }
                for f in variants {
                    if let Slot::Prim(p) = &f.slot {
                        let t = prim_c_type(p);
                        writeln!(
                            b,
                            "  {{ {t} a = {c}_get_{i}( s{sp} ), z = {c}_get_{i}( d{dp} ); TN_CHECK( memcmp( &a, &z, sizeof a )==0 ); }}",
                            i = f.ident,
                            sp = pa(n, "sp"),
                            dp = pa(n, "dp")
                        )
                        .unwrap();
                    }
                }
            }
            NodeKind::Array { elem, .. } => {
                let (sp, dp) = (pa(n, "sp"), pa(n, "dp"));
                writeln!(
                    b,
                    "  uint64_t cnt = {c}_len( s{sp} );\n  TN_CHECK( cnt=={c}_len( d{dp} ) );\n  for( uint64_t i=0UL; i<cnt; i++ ) {{"
                )
                .unwrap();
                match elem {
                    Slot::Prim(_) => writeln!(
                        b,
                        "    TN_RC( {c}_set_at( d{dp}, i, {c}_get_at( s{sp}, i ) ) );"
                    )
                    .unwrap(),
                    Slot::Node(e) => {
                        let en = self.r(*e);
                        let ec = self.copy_fn(*e);
                        writeln!(
                            b,
                            "    {ec}_params_t es, ed;\n    memset( &es, 0, sizeof es ); memset( &ed, 0, sizeof ed );\n    {ec}_t const * ep = {c}_at( s{sp}, i{eo} );\n    {ec}_t * eq = {c}_at_mut( d{dp}, i{eq} );\n    TN_CHECK( ep && eq );\n    TN_RC( tn_copy_{ec}( ep, &es, eq, &ed ) );",
                            eo = pa(en, "&es"),
                            eq = pa(en, "&ed")
                        )
                        .unwrap();
                    }
                }
                b.push_str("  }\n");
            }
            NodeKind::Enum { variants, .. } => {
                /* A standalone enum (not a struct field): node-level API. */
                let (sp, dp) = (pa(n, "sp"), pa(n, "dp"));
                writeln!(
                    b,
                    "  uint64_t tag = {c}_get_tag( s{sp} );\n  TN_CHECK( tag=={c}_get_tag( d{dp} ) );"
                )
                .unwrap();
                self.copy_variants(
                    n,
                    variants,
                    &format!("{c}_as_"),
                    "s",
                    "d",
                    &sp,
                    &dp,
                    false,
                    &mut b,
                );
            }
            NodeKind::Sdu { variants } => {
                let (sp, dp) = (pa(n, "sp"), pa(n, "dp"));
                writeln!(
                    b,
                    "  int var = {c}_get_variant( s{sp} );\n  TN_CHECK( var>=0 && var=={c}_get_variant( d{dp} ) );"
                )
                .unwrap();
                self.copy_variants(
                    n,
                    variants,
                    &format!("{c}_as_"),
                    "s",
                    "d",
                    &sp,
                    &dp,
                    true,
                    &mut b,
                );
            }
            NodeKind::Alias { .. } => unreachable!(),
        }
        b.push_str("  return 0;\n");
        writeln!(self.defs, "{sig} {{\n{b}}}\n").unwrap();
        c
    }

    /* Copy one struct field (or union variant) through the struct-level API. */
    fn copy_field(&mut self, s: &Node, f: &Field, b: &mut String) {
        let c = &s.c_name;
        let i = &f.ident;
        let (sp, dp) = (pa(s, "sp"), pa(s, "dp"));
        writeln!(b, "  /* {} */", f.name).unwrap();
        match &f.slot {
            Slot::Prim(_) => {
                writeln!(b, "  TN_RC( {c}_set_{i}( d{dp}, {c}_get_{i}( s{sp} ) ) );").unwrap();
            }
            Slot::Node(child) => {
                let ch = self.r(*child);
                let cc = ch.c_name.clone();
                match &ch.kind {
                    NodeKind::Enum { tag, variants } if ch.is_field_slot => {
                        writeln!(
                            b,
                            "  {{\n    uint64_t tag = {c}_get_{i}_tag( s{sp} );\n    TN_CHECK( tag!=UINT64_MAX && tag=={c}_get_{i}_tag( d{dp} ) );"
                        )
                        .unwrap();
                        let select = s.plain_ref(tag).is_some();
                        let prefix = format!("{c}_{i}_as_");
                        let mut inner = String::new();
                        self.copy_variants(
                            ch, variants, &prefix, "s", "d", &sp, &dp, false, &mut inner,
                        );
                        if select {
                            /* Re-select the (already written) variant through the
                            select helpers, by constant and by name. */
                            for v in variants {
                                writeln!(
                                    b,
                                    "    if( tag=={cc}_TAG_{vi} ) {{ TN_RC( {c}_{i}_select_{vi}( d{dp} ) ); TN_RC( {c}_{i}_select_by_name( d{dp}, \"{vn}\" ) ); }}",
                                    vi = v.ident,
                                    vn = v.name
                                )
                                .unwrap();
                            }
                        }
                        b.push_str(&indent(&inner));
                        b.push_str("  }\n");
                    }
                    NodeKind::Sdu { variants } if ch.is_field_slot => {
                        writeln!(
                            b,
                            "  {{\n    int var = {c}_get_{i}_variant( s{sp} );\n    TN_CHECK( var>=0 && var=={c}_get_{i}_variant( d{dp} ) );"
                        )
                        .unwrap();
                        let mut inner = String::new();
                        self.copy_variants(
                            ch,
                            variants,
                            &format!("{c}_{i}_as_"),
                            "s",
                            "d",
                            &sp,
                            &dp,
                            true,
                            &mut inner,
                        );
                        b.push_str(&indent(&inner));
                        b.push_str("  }\n");
                    }
                    _ => {
                        let cc = self.copy_fn(*child);
                        /* Arrays with a setter are written again through it
                        at the count already in place (a wrong byte shows up
                        in the comparison); any other count is refused. */
                        let fam = if self.m.fam_count(s, &f.slot).is_some() {
                            format!("\n    {{\n      uint64_t n = {c}_get_{i}_len( s{sp} );\n      int rc = {c}_set_{i}( d{dp}, cp, n+1UL );\n      TN_CHECK( rc==TN_ABI_ERR_BAD_SIZE || rc==TN_ABI_ERR_OVERFLOW );\n      if( n ) TN_CHECK( {c}_set_{i}( d{dp}, cp, n-1UL )==TN_ABI_ERR_BAD_SIZE );\n      TN_RC( {c}_set_{i}( d{dp}, cp, n ) );\n    }}")
                        } else {
                            String::new()
                        };
                        /* Whole-value setters (zero-filled pass only, so the
                        other passes still prove every member is written). */
                        let (copy, whole) = match self.m.value_setter(&f.slot) {
                            Some(ValueSetter::Copy(_)) => (
                                format!("if( tn_whole ) TN_RC( {c}_set_{i}( d{dp}, cp ) );\n    else TN_RC( tn_copy_{cc}( cp, &cs, cq, &cd ) );"),
                                String::new(),
                            ),
                            Some(ValueSetter::Bytes) => (
                                format!("TN_RC( tn_copy_{cc}( cp, &cs, cq, &cd ) );"),
                                format!(
                                    "\n    if( tn_whole ) {{\n      uint64_t n = {cc}_size( cp{cs} );\n      TN_CHECK( n!=UINT64_MAX );\n      TN_CHECK( {c}_set_{i}_bytes( d{dp}, (uint8_t const *)cp, n+1UL )==TN_ABI_ERR_BAD_SIZE );\n      TN_RC( {c}_set_{i}_bytes( d{dp}, (uint8_t const *)cp, n ) );\n    }}",
                                    cs = pa(ch, "&cs")
                                ),
                            ),
                            None => (format!("TN_RC( tn_copy_{cc}( cp, &cs, cq, &cd ) );"), String::new()),
                        };
                        writeln!(
                            b,
                            "  {{\n    {cc}_params_t cs, cd;\n    memset( &cs, 0, sizeof cs ); memset( &cd, 0, sizeof cd );\n    {cc}_t const * cp = {c}_get_{i}( s{sp}{co} );\n    {cc}_t * cq = {c}_get_{i}_mut( d{dp}{cq} );\n    TN_CHECK( cp && cq );\n    {copy}{fam}{whole}\n  }}",
                            co = pa(ch, "&cs"),
                            cq = pa(ch, "&cd")
                        )
                        .unwrap();
                    }
                }
            }
        }
    }

    /* Branch on the active variant (`tag` / `var`) and copy its payload via
    `<prefix><V>` / `<prefix><V>_mut` views. */
    #[allow(clippy::too_many_arguments)]
    fn copy_variants(
        &mut self,
        e: &Node,
        variants: &[Variant],
        prefix: &str,
        s: &str,
        d: &str,
        sp: &str,
        dp: &str,
        sdu: bool,
        b: &mut String,
    ) {
        let ec = &e.c_name;
        for (idx, v) in variants.iter().enumerate() {
            let cond = if sdu {
                format!("var=={ec}_TAG_{}", v.ident)
            } else {
                format!("tag=={ec}_TAG_{}", v.ident)
            };
            let kw = if idx == 0 { "if" } else { "} else if" };
            writeln!(b, "  {kw}( {cond} ) {{").unwrap();
            let Slot::Node(vid) = v.slot else {
                continue;
            };
            let vn = self.r(vid);
            let vc = self.copy_fn(vid);
            let vi = &v.ident;
            /* The descriptor table agrees with the active variant. */
            let active = if sdu { "(uint64_t)var" } else { "tag" };
            writeln!(
                b,
                "    TN_CHECK( {ec}_variant_by_name( \"{name}\" )==&{ec}_variants[{idx}] && {ec}_variants[{idx}].tag=={active} );",
                name = v.name
            )
            .unwrap();
            /* Every other variant view must report inactive. */
            for o in variants.iter().filter(|o| o.ident != v.ident) {
                if let Slot::Node(oid) = o.slot {
                    writeln!(
                        b,
                        "    TN_CHECK( {prefix}{oi}( {s}{sp}{on} )==NULL );",
                        oi = o.ident,
                        on = pa(self.r(oid), "NULL")
                    )
                    .unwrap();
                }
            }
            writeln!(
                b,
                "    {vc}_params_t vs, vd;\n    memset( &vs, 0, sizeof vs ); memset( &vd, 0, sizeof vd );\n    {vc}_t const * vp = {prefix}{vi}( {s}{sp}{vo} );\n    {vc}_t * vq = {prefix}{vi}_mut( {d}{dp}{vq} );\n    TN_CHECK( vp && vq );\n    if( {ec}_variants[{idx}].payload_size!=UINT64_MAX ) TN_CHECK( {vc}_size( vp{vs} )=={ec}_variants[{idx}].payload_size );\n    TN_RC( tn_copy_{vc}( vp, &vs, vq, &vd ) );",
                vo = pa(vn, "&vs"),
                vq = pa(vn, "&vd"),
                vs = pa(vn, "&vs")
            )
            .unwrap();
        }
        if variants.is_empty() {
            b.push_str("  TN_FAIL( \"no variants\" );\n");
        } else {
            b.push_str("  } else {\n    TN_FAIL( \"unknown variant\" );\n  }\n");
        }
    }
}

fn indent(s: &str) -> String {
    s.lines().map(|l| format!("  {l}\n")).collect()
}
