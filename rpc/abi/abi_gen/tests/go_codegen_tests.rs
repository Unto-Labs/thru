/* Go code generation tests.
 *
 * Each test generates a Go module (go.mod, the tnabi runtime and one package
 * per ABI package), adds a `_test.go` file exercising the public API, and runs
 * `go vet` and `go test` on it (CGO_ENABLED=0). Skipped when `go` is missing
 * unless `ABI_REQUIRE_GO` is set. The behaviour checked mirrors the C and Rust
 * test lists: views and setters for every field kind, typed variant access,
 * tag constants and variant tables, params (FromBuffer, Keys, Get/Set,
 * payload sizes, Footprint), New/Init, builders and their checks, top-level
 * enums/unions/SDUs/arrays, imports across packages, `__buffer_size`, parent
 * scope references, nested references after variable data, zero-size
 * elements, unions spanning their largest variant and exact short-buffer
 * sizes. Expression semantics are covered by
 * `ts_codegen_tests::test_ts_every_expression_operator_matches_c_rust_and_go`
 * and agreement with Rust on arbitrary bytes by `differential_fuzz`. */

use abi_gen::abi::file::AbiFile;
use abi_gen::abi::resolved::{ResolvedType, TypeResolver};
use abi_gen::cmds::codegen::{self, Language};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn go_bin() -> Option<String> {
    let go = std::env::var("GO").unwrap_or_else(|_| "go".to_string());
    let ok = Command::new(&go)
        .arg("version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if ok {
        return Some(go);
    }
    if std::env::var_os("ABI_REQUIRE_GO").is_some() {
        panic!("ABI_REQUIRE_GO is set but `{go}` is not available");
    }
    eprintln!("skipping: `{go}` not installed (set ABI_REQUIRE_GO to require it)");
    None
}

fn manifest() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn fresh(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("abi_go_{}_{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

/* Generate Go for `files` (relative to the crate) into a fresh module. */
fn generate(name: &str, files: &[&str], includes: &[&str]) -> PathBuf {
    let dir = fresh(name);
    codegen::run(
        files.iter().map(|f| manifest().join(f)).collect(),
        includes.iter().map(|f| manifest().join(f)).collect(),
        Language::Go,
        dir.clone(),
        false,
    )
    .expect("Go codegen");
    dir
}

/* Generate Go for inline ABI sources. */
fn generate_inline(name: &str, abis: &[(&str, &str)]) -> PathBuf {
    let dir = fresh(name);
    let abi_dir = dir.join("abis");
    fs::create_dir_all(&abi_dir).unwrap();
    let mut files = Vec::new();
    for (file, content) in abis {
        fs::write(abi_dir.join(file), content).unwrap();
        files.push(abi_dir.join(file));
    }
    let out = dir.join("gen");
    codegen::run(files, Vec::new(), Language::Go, out.clone(), false).expect("Go codegen");
    out
}

/* Generate Go for a fixture the analyzer rejects (its alignment check), the
way the Rust and C tests of these fixtures do. */
fn generate_direct(name: &str, file: &str) -> PathBuf {
    let dir = fresh(name);
    let abi: AbiFile =
        serde_yml::from_str(&fs::read_to_string(manifest().join(file)).unwrap()).unwrap();
    let mut resolver = TypeResolver::new();
    for t in abi.get_types() {
        resolver.add_typedef(t.clone());
    }
    resolver.resolve_all().expect("resolve");
    let types: Vec<&ResolvedType> = resolver
        .resolution_order
        .iter()
        .filter_map(|n| resolver.get_type_info(n))
        .collect();
    let pkg = abi.package().to_string();
    abi_gen::codegen::go::write_root(&dir, abi_gen::codegen::go::DEFAULT_MODULE).unwrap();
    let pdir = dir.join(abi_gen::codegen::go::package_dir(&pkg));
    fs::create_dir_all(&pdir).unwrap();
    fs::write(
        pdir.join("types.go"),
        abi_gen::codegen::go::emit_package(
            &resolver,
            &pkg,
            &types,
            &HashMap::new(),
            abi_gen::codegen::go::DEFAULT_MODULE,
        ),
    )
    .unwrap();
    dir
}

/* Add `body` (Go test functions) as a test of package `pkg` (ABI package
name) and run `go vet` + `go test` over the module. `imports` are extra
`alias "path"` lines (paths relative to the module). */
fn go_test(go: &str, module: &Path, pkg: &str, imports: &[(&str, &str)], body: &str) {
    go_test_in(go, module, pkg, &pkg.replace('.', "/"), imports, body);
}

/* `go_test` for a package generated into directory `rel` of the module. */
fn go_test_in(go: &str, module: &Path, pkg: &str, rel: &str, imports: &[(&str, &str)], body: &str) {
    let rel = rel.to_string();
    let name = abi_gen::codegen::go_gen::names::package_name(pkg);
    let m = abi_gen::codegen::go::DEFAULT_MODULE;
    let mut src = format!(
        "package {name}_test\n\nimport (\n\t\"bytes\"\n\t\"errors\"\n\t\"testing\"\n\n\tP \"{m}/{rel}\"\n\t\"{m}/tnabi\"\n"
    );
    for (alias, path) in imports {
        src.push_str(&format!("\t{alias} \"{m}/{path}\"\n"));
    }
    src.push_str(")\n\nvar _ = bytes.Equal\nvar _ = errors.Is\n\n");
    src.push_str(
        "func kind(err error) tnabi.ErrorKind { return tnabi.KindOf(err) }\n\n\
         func must[T any](v T, err error) T {\n\tif err != nil {\n\t\tpanic(err)\n\t}\n\treturn v\n}\n\n\
         func le(v uint64, n int) []byte {\n\tb := make([]byte, n)\n\tfor i := range b {\n\t\tb[i] = byte(v >> (8 * uint(i)))\n\t}\n\treturn b\n}\n\n",
    );
    src.push_str(body);
    fs::write(module.join(&rel).join("api_test.go"), src).unwrap();
    for args in [&["vet", "./..."][..], &["test", "-count=1", "./..."][..]] {
        let out = Command::new(go)
            .args(args)
            .current_dir(module)
            .env("CGO_ENABLED", "0")
            .output()
            .expect("run go");
        assert!(
            out.status.success(),
            "go {} failed:\n{}{}",
            args[0],
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
    }
    let _ = fs::remove_dir_all(module);
}

#[test]
fn test_go_primitives_and_nested_structs() {
    let Some(go) = go_bin() else { return };
    let dir = generate(
        "prims",
        &["tests/compliance_tests/abi_definitions/primitives.abi.yaml"],
        &[],
    );
    go_test(
        &go,
        &dir,
        "compliance.primitives",
        &[],
        r#"
func TestPrimitives(t *testing.T) {
	b := must(P.NewAllPrimitivesBuilder().SetU8Val(0xab).SetU16Val(0xbeef).SetU32Val(0xdeadbeef).
		SetU64Val(1<<63|5).SetI8Val(-2).SetI16Val(-300).SetI32Val(-70000).SetI64Val(-1<<40).
		SetF32Val(1.5).SetF64Val(-2.25).Build())
	if len(b) != P.AllPrimitivesFootprint || b[0] != 0xab || b[1] != 0xef || b[2] != 0xbe {
		t.Fatalf("layout %x", b)
	}
	v := must(P.ParseAllPrimitives(b))
	if v.U8Val() != 0xab || v.U16Val() != 0xbeef || v.U32Val() != 0xdeadbeef || v.U64Val() != 1<<63|5 {
		t.Fatal("unsigned getters")
	}
	if v.I8Val() != -2 || v.I16Val() != -300 || v.I32Val() != -70000 || v.I64Val() != -1<<40 {
		t.Fatal("signed getters")
	}
	if v.F32Val() != 1.5 || v.F64Val() != -2.25 || v.Size() != len(b) {
		t.Fatal("float getters")
	}
	/* Views alias their bytes: setters write through. */
	if err := v.SetI8Val(-128); err != nil || v.I8Val() != -128 {
		t.Fatal("set i8")
	}
	if n, err := v.Check(); err != nil || n != len(b) {
		t.Fatal("check")
	}
	/* A short buffer reports the exact size. */
	_, err := P.ValidateAllPrimitives(b[:5])
	if need, ok := tnabi.RequiredSize(err); !ok || need != uint64(len(b)) || !errors.Is(err, tnabi.ErrBufferTooSmall) {
		t.Fatalf("short: %v", err)
	}
	var e *tnabi.AbiError
	if !errors.As(err, &e) || e.Have != 5 || e.KindName() != "BufferTooSmall" {
		t.Fatalf("typed error: %#v", e)
	}
	/* The zero view never panics. */
	var z P.AllPrimitives
	if z.U64Val() != 0 || z.SetU8Val(1) == nil || z.Size() != len(b) {
		t.Fatal("zero view")
	}
}
"#,
    );
    let dir = generate(
        "structs",
        &["tests/compliance_tests/abi_definitions/structs.abi.yaml"],
        &[],
    );
    go_test(
        &go,
        &dir,
        "compliance.structs",
        &[],
        r#"
func TestNestedStructs(t *testing.T) {
	tl := must(P.NewPoint2DBuilder().SetX(-1).SetY(2).Build())
	br := must(P.NewPoint2DBuilder().SetX(3).SetY(-4).Build())
	b := must(P.NewRectangleBuilder().SetTopLeft(tl).SetBottomRight(br).SetColor(7).Build())
	r := must(P.ParseRectangle(b))
	if r.TopLeft().X() != -1 || r.BottomRight().Y() != -4 || r.Color() != 7 {
		t.Fatal("getters")
	}
	if err := r.TopLeft().SetX(5); err != nil || r.TopLeft().X() != 5 || b[0] != 5 {
		t.Fatal("nested setter writes through")
	}
	if err := r.SetBottomRight(tl); err != nil || r.BottomRight().X() != -1 {
		t.Fatal("whole-value setter")
	}
	if kind(r.SetTopLeft([]byte{1})) != tnabi.KindLengthMismatch {
		t.Fatal("wrong size rejected")
	}
	if kind(P.NewRectangleBuilder().SetTopLeft([]byte{1}).Err()) != tnabi.KindLengthMismatch {
		t.Fatal("builder rejects a wrong-size nested value")
	}
	s := must(P.NewSimpleStructBuilder().SetId(9).SetFlags(1).SetValue(0x0203).Finish())
	if s.Id() != 9 || s.Value() != 0x0203 || len(s.Bytes()) != P.SimpleStructFootprint {
		t.Fatal("finish")
	}
}
"#,
    );
}

#[test]
fn test_go_arrays_and_jagged_builders() {
    let Some(go) = go_bin() else { return };
    let dir = generate(
        "jagged",
        &["tests/compliance_tests/abi_definitions/jagged_arrays.abi.yaml"],
        &[],
    );
    go_test(
        &go,
        &dir,
        "compliance.jagged_arrays",
        &[],
        r#"
func TestArrays(t *testing.T) {
	r := must(P.NewVarRecordBuilder().SetData([]uint8{7, 8, 9}).Build())
	if !bytes.Equal(r, []byte{3, 7, 8, 9}) {
		t.Fatalf("count derived from the array: %x", r)
	}
	v := must(P.ParseVarRecord(r))
	if v.DataLen() != 3 || !bytes.Equal(v.Data(), []byte{7, 8, 9}) {
		t.Fatal("byte array")
	}
	if x, ok := v.DataAt(2); !ok || x != 9 {
		t.Fatal("at")
	}
	if _, ok := v.DataAt(3); ok {
		t.Fatal("at out of range")
	}
	if kind(v.SetDataAt(3, 1)) != tnabi.KindOutOfBounds || kind(v.SetData([]uint8{1})) != tnabi.KindLengthMismatch {
		t.Fatal("setter range checks")
	}
	if err := v.SetData([]uint8{1, 2, 3}); err != nil || !bytes.Equal(r, []byte{3, 1, 2, 3}) {
		t.Fatal("set all")
	}
	/* A new from typed params. */
	buf := bytes.Repeat([]byte{0xff}, 8)
	if n, err := P.NewVarRecord(buf, 2); err != nil || n != 3 || !bytes.Equal(buf[:3], []byte{2, 0, 0}) {
		t.Fatalf("new: %d %v %x", n, err, buf)
	}
}

func TestJagged(t *testing.T) {
	b := must(P.NewJaggedRecordsBuilder().PushRecords([]byte{0}).PushRecords([]byte{1, 42}).Build())
	if !bytes.Equal(b, []byte{2, 0, 0, 0, 0, 1, 42}) {
		t.Fatalf("pushed: %x", b)
	}
	set := must(P.NewJaggedRecordsBuilder().SetRecords([][]byte{{0}, {1, 42}}).Build())
	if !bytes.Equal(set, b) {
		t.Fatal("set")
	}
	v := must(P.ParseJaggedRecords(b))
	if e, ok := v.RecordsAt(1); !ok || e.Len() != 1 || !bytes.Equal(e.Data(), []byte{42}) {
		t.Fatal("jagged element")
	}
	if _, ok := v.RecordsAt(2); ok {
		t.Fatal("element out of range")
	}
	/* Each element keeps its boundary. */
	if kind(P.NewJaggedRecordsBuilder().PushRecords([]byte{0, 1}).PushRecords([]byte{42}).Err()) != 0 {
		t.Fatal("push itself cannot know")
	}
	if _, err := P.NewJaggedRecordsBuilder().PushRecords([]byte{0, 1}).PushRecords([]byte{42}).Build(); kind(err) != tnabi.KindLengthMismatch {
		t.Fatalf("boundaries: %v", err)
	}
	if _, err := P.NewJaggedRecordsBuilder().SetRecords([][]byte{{0, 1}, {42}}).BuildInto(make([]byte, 16)); kind(err) != tnabi.KindLengthMismatch {
		t.Fatalf("boundaries into: %v", err)
	}
	if _, err := P.NewJaggedRecordsBuilder().PushRecords([]byte{2, 7}).PushRecords([]byte{8, 1, 5}).Build(); err == nil {
		t.Fatal("elements must validate on their own")
	}
	/* Exact required size: every count lies inside the bytes present. */
	_, err := P.ValidateJaggedRecords(b[:6])
	if need, ok := tnabi.RequiredSize(err); !ok || need != 7 {
		t.Fatalf("short: %v", err)
	}
	p := must(P.JaggedRecordsParamsFromBuffer(b))
	if fp := must(P.FootprintJaggedRecords(&p)); fp != 7 || p.RecordsPayloadSize != 3 || p.Count != 2 {
		t.Fatalf("params %+v %d", p, fp)
	}
	into := bytes.Repeat([]byte{0xa5}, 9)
	if n, err := P.NewJaggedRecordsBuilder().SetRecords([][]byte{{0}, {1, 42}}).BuildInto(into); err != nil || n != 7 || into[7] != 0xa5 {
		t.Fatal("build into")
	}
	if _, err := P.NewJaggedRecordsBuilder().PushRecords([]byte{0}).BuildInto(make([]byte, 2)); kind(err) != tnabi.KindBufferTooSmall {
		t.Fatal("build into a short target")
	}
}
"#,
    );
}

#[test]
fn test_go_enums_tags_and_variant_tables() {
    let Some(go) = go_bin() else { return };
    let dir = generate(
        "enums",
        &["tests/compliance_tests/abi_definitions/enums.abi.yaml"],
        &[],
    );
    go_test(
        &go,
        &dir,
        "compliance.enums",
        &[],
        r#"
func TestEnum(t *testing.T) {
	val := must(P.NewSimpleEnum_body_ValueBuilder().SetData(0x01020304).Build())
	b := must(P.NewSimpleEnumBuilder().SetBodyValue(val).Build())
	if !bytes.Equal(b, []byte{1, 4, 3, 2, 1}) {
		t.Fatalf("tag derived from the variant: %x", b)
	}
	v := must(P.ParseSimpleEnum(b))
	if v.Tag() != 1 || v.BodyTag() != P.SimpleEnumBodyTagValue {
		t.Fatal("tag")
	}
	r := v.Body()
	if !r.Known || r.Tag != 1 || r.Value.Data() != 0x01020304 {
		t.Fatal("typed variant")
	}
	if x, ok := v.BodyAsValue(); !ok || x.Data() != 0x01020304 {
		t.Fatal("as active")
	}
	if _, ok := v.BodyAsPair(); ok {
		t.Fatal("as inactive")
	}
	if err := r.Value.SetData(7); err != nil || b[1] != 7 || !bytes.Equal(v.BodyBody(), []byte{7, 0, 0, 0}) {
		t.Fatal("typed variant writes through")
	}
	if len(P.SimpleEnumBodyVariants) != 4 {
		t.Fatal("table")
	}
	if i, ok := P.SimpleEnumBodyVariantByName("Pair"); !ok || i.Tag != P.SimpleEnumBodyTagPair || i.PayloadSize != 4 || i.PayloadType != "SimpleEnum::body::Pair" {
		t.Fatalf("by name %+v", i)
	}
	if i, ok := P.SimpleEnumBodyVariantByTag(3); !ok || i.Name != "Bytes" {
		t.Fatal("by tag")
	}
	if _, ok := P.SimpleEnumBodyVariantByName("nope"); ok {
		t.Fatal("unknown name")
	}
	/* Select by name / tag. */
	by := must(P.NewSimpleEnumBuilder().SetBodyVariantByName("Value", val).Build())
	tag := must(P.NewSimpleEnumBuilder().SetBodyVariant(1, val).Build())
	if !bytes.Equal(by, tag) || by[0] != 1 {
		t.Fatal("select")
	}
	if kind(P.NewSimpleEnumBuilder().SetBodyVariantByName("nope", val).Err()) != tnabi.KindInvalidVariant ||
		kind(P.NewSimpleEnumBuilder().SetBodyVariant(9, val).Err()) != tnabi.KindInvalidVariant ||
		kind(P.NewSimpleEnumBuilder().SetBodyValue([]byte{1}).Err()) != tnabi.KindLengthMismatch {
		t.Fatal("rejected selections")
	}
	if _, err := P.ValidateSimpleEnum([]byte{9}); kind(err) != tnabi.KindInvalidVariant {
		t.Fatal("unknown tag")
	}
	/* Params: the tag; Init writes it. */
	p := must(P.SimpleEnumParamsFromBuffer(b))
	if p.Tag != 1 || must(p.Footprint()) != 5 {
		t.Fatal("params")
	}
	buf := make([]byte, 5)
	if n := must(P.InitSimpleEnum(buf, &p)); n != 5 || buf[0] != 1 {
		t.Fatal("init writes the tag")
	}
}
"#,
    );
    let dir = generate(
        "wide",
        &["tests/compliance_tests/abi_definitions/wide_tag_enums.abi.yaml"],
        &[],
    );
    go_test(
        &go,
        &dir,
        "compliance.wide_tag_enums",
        &[],
        r#"
func TestWideTags(t *testing.T) {
	b := must(P.NewU32TagEnumBuilder().SetBodyHigh(le(5, 8)).Build())
	if !bytes.Equal(b[:4], []byte{0, 0, 1, 0}) {
		t.Fatalf("u32 tag: %x", b)
	}
	v := must(P.ParseU32TagEnum(b))
	if v.BodyTag() != 65536 || v.Body().High.Value() != 5 {
		t.Fatal("full-width tag")
	}
	/* Tags compare at full width: 0x00020000 is not Zero (0). */
	if _, err := P.ValidateU32TagEnum([]byte{0, 0, 2, 0}); kind(err) != tnabi.KindInvalidVariant {
		t.Fatal("full-width compare")
	}
	w := must(P.ParseU16TagEnum([]byte{2, 1, 9, 0, 0, 0}))
	if w.BodyTag() != 258 || w.Body().Big.Value() != 9 {
		t.Fatal("u16 tag")
	}
}
"#,
    );
    let dir = generate("tail", &["tests/compliance_data/tail_enum.abi.yaml"], &[]);
    go_test(
        &go,
        &dir,
        "compliance.tail_enum",
        &[],
        r#"
func TestPayloadSizeParam(t *testing.T) {
	dyn := must(P.NewTailEnumDynamicPayloadBuilder().SetBytes([]uint8{1, 2, 3}).Build())
	b := must(P.NewTailEnumPayloadBuilder().SetPayloadDynamic(dyn).Build())
	p := must(P.TailEnumPayloadParamsFromBuffer(b))
	if p.Tag != 1 || p.PayloadPayloadSize != 4 || must(P.FootprintTailEnumPayload(&p)) != 5 {
		t.Fatalf("payload size %+v", p)
	}
	if v, ok := p.Get("payload.payload_size"); !ok || v != 4 {
		t.Fatal("ABI path key")
	}
	buf := make([]byte, 5)
	if n := must(P.InitTailEnumPayload(buf, &p)); n != 5 || buf[0] != 1 {
		t.Fatal("init")
	}
	v := must(P.ParseTailEnumPayload(b))
	if d, ok := v.PayloadAsDynamic(); !ok || !bytes.Equal(d.Bytes_(), []byte{1, 2, 3}) {
		t.Fatal("named payload view")
	}
}
"#,
    );
}

#[test]
fn test_go_sdu_unions_and_variable_unions() {
    let Some(go) = go_bin() else { return };
    let dir = generate(
        "sdu",
        &["tests/compliance_tests/abi_definitions/size_discriminated_unions.abi.yaml"],
        &[],
    );
    go_test(
        &go,
        &dir,
        "compliance.size_discriminated_unions",
        &[],
        r#"
func TestSdu(t *testing.T) {
	b := must(P.NewMessageWithSDUBuilder().SetHeader(1).SetDataMedium(le(0x0000000200000001, 8)).Build())
	v := must(P.ParseMessageWithSDU(b))
	if len(b) != 9 || v.DataTag() != P.MessageWithSDUDataTagMedium || v.Data().Medium.Value2() != 2 {
		t.Fatal("sdu")
	}
	if x, ok := v.DataAsMedium(); !ok || x.Value1() != 1 {
		t.Fatal("as")
	}
	p := must(P.MessageWithSDUParamsFromBuffer(b))
	if p.DataVariant != 1 || must(P.FootprintMessageWithSDU(&P.MessageWithSDUParams{DataVariant: 2})) != 17 {
		t.Fatal("params")
	}
	if _, err := P.ValidateMessageWithSDU(b[:6]); kind(err) != tnabi.KindInvalidSize {
		t.Fatal("no variant of that size")
	}
	if i, ok := P.MessageWithSDUDataVariantByName("large"); !ok || i.Tag != 2 || i.PayloadSize != 16 {
		t.Fatal("table")
	}
	if kind(P.NewMessageWithSDUBuilder().SetDataSmall([]byte{1}).Err()) != tnabi.KindLengthMismatch {
		t.Fatal("size checked")
	}
}
"#,
    );
    let dir = generate(
        "varunion",
        &["tests/compliance_data/variable_union.abi.yaml"],
        &[],
    );
    go_test(
        &go,
        &dir,
        "compliance.variable_union",
        &[],
        r#"
func TestVariableUnion(t *testing.T) {
	/* The union spans its largest variant: fixed is 4 bytes, sized 1 + len. */
	if n := must(P.ValidateVarUnion([]byte{2, 9, 9, 0})); n != 4 {
		t.Fatal("fixed is largest")
	}
	if n := must(P.ValidateVarUnion([]byte{5, 1, 2, 3, 4, 5, 0})); n != 6 {
		t.Fatal("sized is largest")
	}
	/* Every variant must validate: sized needs 10 bytes here. */
	_, err := P.ValidateVarUnion([]byte{9, 0, 0, 0})
	if need, ok := tnabi.RequiredSize(err); !ok || need != 10 {
		t.Fatalf("every variant validated: %v", err)
	}
	u := must(P.ParseVarUnion([]byte{2, 9, 9, 0}))
	if u.Fixed() != 0x00090902 || u.Sized().Len() != 2 || !bytes.Equal(u.Sized().Data(), []byte{9, 9}) {
		t.Fatal("variants share bytes")
	}
	p := must(u.DynamicParams())
	if p.PayloadSize != 4 || must(P.FootprintVarUnion(&P.VarUnionParams{PayloadSize: 6})) != 6 {
		t.Fatal("payload size param")
	}
	if len(P.VarUnionVariants) != 2 || P.VarUnionVariants[1].PayloadSize != tnabi.VariableSize {
		t.Fatal("table")
	}
}
"#,
    );
    let dir = generate(
        "unionval",
        &["tests/compliance_data/nested_union_validation.abi.yaml"],
        &[],
    );
    go_test(
        &go,
        &dir,
        "test.nested_union_validation",
        &[],
        r#"
func TestUnionVariantsValidate(t *testing.T) {
	if n := must(P.ValidateChoice([]byte{1, 0, 0, 0, 0})); n != 5 {
		t.Fatal("valid")
	}
	/* raw accepts any bytes, but tagged has no variant 7. */
	if _, err := P.ValidateChoice([]byte{7, 0, 0, 0, 0}); kind(err) != tnabi.KindInvalidVariant {
		t.Fatal("every variant validated")
	}
	if _, err := P.ValidateHolder(append([]byte{0, 7, 0, 0, 0, 0}, 2, 0, 0, 0)); kind(err) != tnabi.KindInvalidVariant {
		t.Fatal("embedding types validate it too")
	}
	c := must(P.ParseInlineChoice([]byte{3, 0x34, 0x12, 0}))
	if c.Tagged().BodyTag() != P.InlineChoice_taggedBodyTagHi {
		t.Fatal("inline union variant")
	}
	if x, ok := c.Tagged().BodyAsHi(); !ok || x != 0x1234 {
		t.Fatal("prim payload")
	}
	if err := c.Tagged().SetBodyAsHi(5); err != nil || c.Word() != 0x00000503 {
		t.Fatal("prim payload setter")
	}
	if kind(c.Tagged().SetBodyAsLo(1)) != tnabi.KindInvalidVariant {
		t.Fatal("inactive payload setter")
	}
}
"#,
    );
}

const TOP_LEVEL_ABI: &str = r#"
abi:
  package: "test.top_level"
  abi-version: 1
  package-version: "1.0.0"
  description: "Top-level enum, union, size-discriminated union and arrays"

types:
  - name: "TopEnum"
    kind:
      enum:
        packed: true
        tag-ref:
          field-ref:
            path: ["kind"]
        variants:
          - name: "A"
            tag-value: 0
            variant-type:
              primitive: u8
          - name: "B"
            tag-value: 7
            variant-type:
              struct:
                packed: true
                fields:
                  - name: "x"
                    field-type:
                      primitive: u16
  - name: "Holder"
    kind:
      struct:
        packed: true
        fields:
          - name: "kind"
            field-type:
              primitive: u8
          - name: "value"
            field-type:
              type-ref:
                name: "TopEnum"
  - name: "TopSdu"
    kind:
      size-discriminated-union:
        packed: true
        variants:
          - name: "small"
            expected-size: 1
            variant-type:
              primitive: u8
          - name: "big"
            expected-size: 4
            variant-type:
              struct:
                packed: true
                fields:
                  - name: "lo"
                    field-type:
                      primitive: u16
                  - name: "hi"
                    field-type:
                      primitive: u16
  - name: "TopUnion"
    kind:
      union:
        packed: true
        variants:
          - name: "word"
            variant-type:
              primitive: u32
          - name: "bytes"
            variant-type:
              array:
                size:
                  literal:
                    u32: 4
                element-type:
                  primitive: u8
  - name: "Words"
    kind:
      array:
        size:
          literal:
            u32: 3
        element-type:
          primitive: u8
  - name: "Pairs"
    kind:
      array:
        size:
          literal:
            u32: 2
        element-type:
          type-ref:
            name: "TopUnion"
  - name: "Quad"
    kind:
      struct:
        packed: true
        fields:
          - name: "v"
            field-type:
              primitive: u64
  - name: "Quads"
    kind:
      array:
        size:
          literal:
            u32: 3
        element-type:
          type-ref:
            name: "Quad"
  - name: "Triple"
    kind:
      struct:
        packed: true
        fields:
          - name: "a"
            field-type:
              primitive: u8
          - name: "b"
            field-type:
              primitive: u16
  - name: "Triples"
    kind:
      array:
        size:
          literal:
            u32: 3
        element-type:
          type-ref:
            name: "Triple"
"#;

#[test]
fn test_go_top_level_enum_union_sdu_and_arrays() {
    let Some(go) = go_bin() else { return };
    let dir = generate_inline("top", &[("top.abi.yaml", TOP_LEVEL_ABI)]);
    go_test(
        &go,
        &dir,
        "test.top_level",
        &[],
        r#"
func TestTopLevel(t *testing.T) {
	if P.TopEnumTagA != 0 || P.TopEnumTagB != 7 || len(P.TopEnumVariants) != 2 || P.TopEnumVariants[0] != (tnabi.VariantInfo{Name: "A", Tag: 0, PayloadSize: 1, PayloadType: "u8"}) {
		t.Fatal("enum metadata")
	}
	/* A top-level enum takes its tag from outside. */
	b := []byte{0x34, 0x12}
	e := must(P.ParseTopEnumWith(b, P.TopEnum__Ext{Kind: 7}))
	if e.Tag() != 7 || e.Size() != 2 || e.Variant().B.X() != 0x1234 {
		t.Fatal("top-level enum")
	}
	if _, ok := e.AsA(); ok {
		t.Fatal("inactive")
	}
	if _, err := P.ValidateTopEnumWith(b, P.TopEnum__Ext{Kind: 3}); kind(err) != tnabi.KindInvalidVariant {
		t.Fatal("bad outside tag")
	}
	h := must(P.ParseHolder([]byte{7, 0x34, 0x12}))
	if x, ok := h.Value().AsB(); !ok || x.X() != 0x1234 {
		t.Fatal("embedded enum")
	}
	p := P.TopEnumParamsFromValues(7)
	if dp := must(e.DynamicParams()); dp != p || must(p.Footprint()) != 2 || len(p.Keys()) != 1 {
		t.Fatal("enum params")
	}
	if !p.Set("kind", 0) || must(p.Footprint()) != 1 || p.Set("nope", 1) {
		t.Fatal("params set")
	}
	p.Kind = 3
	if _, err := p.Footprint(); kind(err) != tnabi.KindInvalidVariant {
		t.Fatal("bad tag footprint")
	}
	eb := P.NewTopEnumBuilder().SetB([]byte{0x34, 0x12})
	if dp := must(eb.DynamicParams()); dp.Kind != P.TopEnumTagB {
		t.Fatal("enum builder reports the tag")
	}
	if _, err := P.NewTopEnumBuilder().Build(); kind(err) != tnabi.KindInvalidVariant {
		t.Fatal("nothing selected")
	}
	enumBytes := must(P.NewTopEnumBuilder().SetVariantByName("B", []byte{0x34, 0x12}).Build())
	hb := must(P.NewHolderBuilder().SetKind(7).SetValue(enumBytes).Build())
	if !bytes.Equal(hb, []byte{7, 0x34, 0x12}) {
		t.Fatal("holder")
	}

	/* Top-level SDU: the buffer size selects the variant. */
	s := must(P.ParseTopSdu([]byte{1, 2, 3, 4}))
	if s.Tag() != P.TopSduTagBig || s.Variant().Big.Hi() != 0x0403 {
		t.Fatal("sdu")
	}
	if x, ok := must(P.ParseTopSdu([]byte{9})).AsSmall(); !ok || x != 9 {
		t.Fatal("small")
	}
	for _, n := range []int{0, 3, 5} {
		if _, err := P.ValidateTopSdu(make([]byte, n)); kind(err) != tnabi.KindInvalidSize {
			t.Fatalf("size %d", n)
		}
	}
	sp := must(P.TopSduParamsFromBuffer([]byte{1, 2, 3, 4}))
	if sp.Variant != 1 || must(sp.Footprint()) != 4 {
		t.Fatal("sdu params")
	}
	buf := bytes.Repeat([]byte{0xff}, 4)
	if n := must(P.NewTopSdu(buf, 1)); n != 4 || !bytes.Equal(buf, make([]byte, 4)) {
		t.Fatal("new sdu")
	}
	if _, err := P.NewTopSdu(buf[:2], 1); kind(err) != tnabi.KindBufferTooSmall {
		t.Fatal("short new")
	}
	sb := must(P.NewTopSduBuilder().SetVariantByName("small", []byte{9}).Build())
	if !bytes.Equal(sb, []byte{9}) || kind(P.NewTopSduBuilder().SetVariantByName("huge", nil).Err()) != tnabi.KindInvalidVariant {
		t.Fatal("sdu builder")
	}
	if _, err := P.NewTopSduBuilder().Build(); kind(err) != tnabi.KindInvalidSize {
		t.Fatal("empty sdu builder")
	}

	/* Top-level union. */
	u := must(P.ParseTopUnion([]byte{0x0d, 0x0c, 0x0b, 0x0a}))
	if u.Word() != 0x0a0b0c0d || !bytes.Equal(u.Bytes_(), []byte{0x0d, 0x0c, 0x0b, 0x0a}) {
		t.Fatal("union")
	}
	if i, ok := P.TopUnionVariantByName("bytes"); !ok || i.Tag != 1 || i.PayloadSize != 4 {
		t.Fatal("union table")
	}
	ub := must(P.NewTopUnionBuilder().SetBytes([]byte{1, 0, 0, 0}).Build())
	if !bytes.Equal(ub, []byte{1, 0, 0, 0}) || kind(P.NewTopUnionBuilder().SetBytes(make([]byte, 5)).Err()) != tnabi.KindLengthMismatch {
		t.Fatal("union builder")
	}

	/* Top-level arrays. */
	w := must(P.ParseWords([]byte{1, 2, 3}))
	if w.Len() != 3 {
		t.Fatal("len")
	}
	if x, ok := w.At(2); !ok || x != 3 {
		t.Fatal("at")
	}
	if err := w.SetAll([]uint8{4, 5, 6}); err != nil || !bytes.Equal(w.ElementsBytes(), []byte{4, 5, 6}) {
		t.Fatal("set all")
	}
	if kind(w.SetAt(3, 1)) != tnabi.KindOutOfBounds {
		t.Fatal("set at out of range")
	}
	wb := must(P.NewWordsBuilder().SetAt(1, 9).Build())
	if !bytes.Equal(wb, []byte{0, 9, 0}) || kind(P.NewWordsBuilder().SetAt(3, 1).Err()) != tnabi.KindOutOfBounds {
		t.Fatal("array builder")
	}
	pairs := must(P.ParsePairs(make([]byte, 8)))
	el, _ := pairs.At(1)
	if err := el.SetWord(0x01020304); err != nil || pairs.Bytes()[4] != 4 {
		t.Fatal("array of views")
	}

	/* An index whose byte offset overflows u64 is out of bounds, not a
	silent no-op or a panic. */
	huge := uint64(1)<<61 - 1
	eight := []byte{7, 0, 0, 0, 0, 0, 0, 0}
	if q := must(P.NewQuadsBuilder().SetAt(2, eight).Build()); len(q) != 24 || q[16] != 7 {
		t.Fatal("quads builder")
	}
	if kind(P.NewQuadsBuilder().SetAt(huge, eight).Err()) != tnabi.KindOutOfBounds {
		t.Fatal("quads huge index")
	}
	if _, err := P.NewQuadsBuilder().SetAt(3, eight).Build(); kind(err) != tnabi.KindOutOfBounds {
		t.Fatal("quads index 3")
	}
	if kind(P.NewWordsBuilder().SetAt(^uint64(0), 1).Err()) != tnabi.KindOutOfBounds {
		t.Fatal("words max index")
	}
	if kind(P.NewTriplesBuilder().SetAt(huge/3*2, []byte{1, 2, 3}).Err()) != tnabi.KindOutOfBounds {
		t.Fatal("triples huge index")
	}
	if tb := must(P.NewTriplesBuilder().SetAt(2, []byte{1, 2, 3}).Build()); tb[6] != 1 || tb[8] != 3 {
		t.Fatal("triples builder")
	}
}
"#,
    );
}

#[test]
fn test_go_params_init_and_short_buffers() {
    let Some(go) = go_bin() else { return };
    let dir = generate(
        "refs",
        &["tests/compliance_tests/abi_definitions/nested_refs.abi.yaml"],
        &[],
    );
    go_test(
        &go,
        &dir,
        "compliance.nested_refs",
        &[],
        r#"
func TestParamsAndInit(t *testing.T) {
	/* Proof: computed tag from hdr.type_slot, popcount-sized arrays. */
	slot := uint64(1) << 62
	buf := bytes.Repeat([]byte{0xa5}, 64)
	n := must(P.NewProof(buf, slot, 0x03, 0x01))
	/* updating: leaf u32 + 3 siblings. */
	if n != 10+4+12 || buf[7] != 0x40 || buf[8] != 3 || buf[9] != 1 || buf[n] != 0xa5 {
		t.Fatalf("new: %d %x", n, buf[:n+1])
	}
	v := must(P.ParseProof(buf[:n]))
	if v.BodyTag() != P.ProofBodyTagUpdating || v.Body().Updating.SiblingsLen() != 3 {
		t.Fatal("init selected the variant")
	}
	p := must(v.DynamicParams())
	if p.HdrTypeSlot != slot || p.HdrBitset0 != 3 || p.HdrBitset1 != 1 || must(P.FootprintProof(&p)) != uint64(n) {
		t.Fatalf("params %+v", p)
	}
	keys := p.Keys()
	if len(keys) != 3 || keys[1].Path != "hdr.bitset.0" || keys[1].Field != "HdrBitset0" {
		t.Fatalf("keys %+v", keys)
	}
	var q P.ProofParams
	for _, k := range keys {
		x, _ := p.Get(k.Field)
		if !q.Set(k.Path, x) {
			t.Fatal("set by path")
		}
	}
	if q != p {
		t.Fatal("rebuilt from keys")
	}
	if _, ok := p.Get("nope"); ok {
		t.Fatal("unknown key")
	}
	/* Init lays the value out from params only. */
	buf2 := make([]byte, n)
	if m := must(P.InitProof(buf2, &p)); m != n || !bytes.Equal(buf2[:10], buf[:10]) {
		t.Fatal("init from params")
	}
	if _, err := P.InitProof(buf2[:5], &p); kind(err) != tnabi.KindBufferTooSmall {
		t.Fatal("init short")
	}
}

func TestShortBuffers(t *testing.T) {
	b := must(P.NewTxBuilder().SetHdr([]byte{1, 2, 3, 0}).SetKeys([]uint32{1, 2, 3}).SetData([]uint8{7, 8, 9}).Build())
	if len(b) != 19 {
		t.Fatalf("tx %x", b)
	}
	tx := must(P.ParseTx(b))
	if tx.Hdr().RwCnt() != 1 || tx.KeysLen() != 3 || !bytes.Equal(tx.Data(), []byte{7, 8, 9}) {
		t.Fatal("tx getters")
	}
	/* Every count lies inside the bytes present: the exact size. */
	_, err := P.ValidateTx(b[:10])
	var e *tnabi.AbiError
	if !errors.As(err, &e) || e.Kind != tnabi.KindBufferTooSmall || e.Needed != 19 || e.Have != 10 {
		t.Fatalf("exact: %#v", e)
	}
	/* data_sz itself is cut off: a lower bound. */
	_, err = P.ValidateTx(b[:2])
	if need, ok := tnabi.RequiredSize(err); !ok || need != 4 {
		t.Fatalf("lower bound: %v", err)
	}
	/* Counts that disagree with the data are caught. */
	if _, err := P.NewTxBuilder().SetHdr([]byte{1, 0, 0, 0}).SetKeys([]uint32{1, 2}).Build(); kind(err) != tnabi.KindLengthMismatch {
		t.Fatalf("count mismatch: %v", err)
	}
}
"#,
    );
}

#[test]
fn test_go_builders_check_shared_counts_and_zero_size_elements() {
    let Some(go) = go_bin() else { return };
    let dir = generate_direct("shared", "tests/compliance_data/shared_count.abi.yaml");
    go_test(
        &go,
        &dir,
        "compliance.shared_count",
        &[],
        r#"
func TestSharedCounts(t *testing.T) {
	ok := must(P.NewSharedCountBuilder().SetA([]uint8{1, 2}).SetB([]uint8{3, 4}).Build())
	if !bytes.Equal(ok, []byte{2, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 0, 0, 0, 0}) {
		t.Fatalf("shared: %x", ok)
	}
	for _, c := range [][2][]uint8{{{1}, {2, 3, 4}}, {{1, 2, 3}, {4}}} {
		if _, err := P.NewSharedCountBuilder().SetA(c[0]).SetB(c[1]).Build(); kind(err) != tnabi.KindLengthMismatch {
			t.Fatalf("mismatch %v", c)
		}
		if _, err := P.NewSharedCountBuilder().SetA(c[0]).SetB(c[1]).BuildInto(make([]byte, 16)); kind(err) != tnabi.KindLengthMismatch {
			t.Fatalf("mismatch into %v", c)
		}
	}
	if _, err := P.NewSharedCountBuilder().SetB([]uint8{2, 3, 4}).Build(); kind(err) != tnabi.KindLengthMismatch {
		t.Fatal("an array left out has no elements")
	}
	z := must(P.NewSharedEmptyCountBuilder().PushA(nil).PushA(nil).PushB(nil).PushB(nil).Build())
	if !bytes.Equal(z, []byte{0, 2}) {
		t.Fatalf("zero-byte elements count: %x", z)
	}
	if _, err := P.NewSharedEmptyCountBuilder().PushA(nil).PushB(nil).PushB(nil).Build(); kind(err) != tnabi.KindLengthMismatch {
		t.Fatal("zero-byte elements count too")
	}
}
"#,
    );
    let dir = generate(
        "zero",
        &["tests/compliance_data/zero_size_elements.abi.yaml"],
        &[],
    );
    go_test(
        &go,
        &dir,
        "compliance.zero_size_elements",
        &[],
        r#"
func TestZeroSizeElements(t *testing.T) {
	/* 2^64-1 zero-byte elements are validated once, not 2^64 times. */
	huge := append([]byte{0}, bytes.Repeat([]byte{0xff}, 8)...)
	for _, f := range []func([]byte) (int, error){P.ValidateEmptyEnumList, P.ValidateJaggedEmptyList, P.ValidateStrideEmptyList} {
		if n := must(f(huge)); n != 9 {
			t.Fatal("huge count")
		}
	}
	v := must(P.ParseJaggedEmptyList(huge))
	if v.ItemsLen() != tnabi.MaxU64 {
		t.Fatal("len")
	}
	if e, ok := v.ItemsAt(tnabi.MaxU64 - 1); !ok || e.Tag() != 0 || e.Size() != 0 {
		t.Fatal("last element")
	}
	p := must(P.JaggedEmptyListParamsFromBuffer(huge))
	if must(P.FootprintJaggedEmptyList(&p)) != 9 {
		t.Fatal("footprint")
	}
	if _, err := P.ValidateJaggedEmptyList(append([]byte{1}, bytes.Repeat([]byte{0xff}, 8)...)); kind(err) != tnabi.KindBufferTooSmall {
		t.Fatal("non-empty elements need bytes")
	}
}
"#,
    );
}

#[test]
fn test_go_buffer_size_scope_refs_and_imports() {
    let Some(go) = go_bin() else { return };
    let dir = generate(
        "bufsize",
        &["tests/compliance_tests/abi_definitions/buffer_sized.abi.yaml"],
        &[],
    );
    go_test(
        &go,
        &dir,
        "compliance.buffer_sized",
        &[],
        r#"
func TestBufferSize(t *testing.T) {
	b := make([]byte, 28)
	b[4] = 9
	v := must(P.ParseBufferSizedEntries(b))
	if v.EntriesLen() != 3 || v.Size() != 28 {
		t.Fatal("entries from the buffer size")
	}
	if n := must(P.ValidateBufferSizedEntries(make([]byte, 26))); n != 20 {
		t.Fatal("whole entries only")
	}
	p := must(v.DynamicParams())
	if p.BufferSize != 28 || must(P.FootprintBufferSizedEntries(&p)) != 28 {
		t.Fatal("buffer size param")
	}
	buf := bytes.Repeat([]byte{0xa5}, 40)
	if n := must(P.InitBufferSizedEntries(buf, &p)); n != 28 || buf[28] != 0xa5 {
		t.Fatal("init lays out over the param size")
	}
	if n := must(P.NewBufferSizedEntries(buf)); n != 36 {
		t.Fatal("new uses the whole buffer")
	}
}
"#,
    );
    let dir = generate(
        "scope",
        &["tests/compliance_data/parent_scope_refs.abi.yaml"],
        &[],
    );
    go_test(
        &go,
        &dir,
        "compliance.parent_scope_refs",
        &[],
        r#"
func TestParentScopeRefs(t *testing.T) {
	v := must(P.ParseScopedCount([]byte{2, 1, 0xa, 0xb, 0xc}))
	c := v.Child()
	if !bytes.Equal(c.OuterSized(), []byte{0xa, 0xb}) || !bytes.Equal(c.OwnSized(), []byte{0xc}) {
		t.Fatal("`..` refers to the outer count")
	}
	p := must(v.DynamicParams())
	if p.Count != 2 || p.ChildPayloadSize != 4 || must(p.Footprint()) != 5 {
		t.Fatalf("params %+v", p)
	}
	d := must(P.ParseScopedDeep([]byte{2, 0, 0, 7, 8}))
	if d.Size() != 5 {
		t.Fatal("two levels up")
	}
}
"#,
    );
    let dir = generate(
        "after",
        &["tests/compliance_data/nested_ref_after_variable.abi.yaml"],
        &[],
    );
    go_test(
        &go,
        &dir,
        "compliance.nested_ref_after_variable",
        &[],
        r#"
func TestNestedRefAfterVariableData(t *testing.T) {
	v := must(P.ParseRefOuter([]byte{9, 2, 0xa, 0xb, 1, 0x34, 0x12, 7}))
	if v.Child().Count() != 1 || v.ItemsLen() != 1 || v.Tail() != 7 {
		t.Fatal("child.count after child.bytes")
	}
	if x, _ := v.ItemsAt(0); x != 0x1234 {
		t.Fatal("item")
	}
	child := must(P.NewChildBuilder().SetBytes([]uint8{1}).SetCount(2).Build())
	b := must(P.NewInlineOuterBuilder().SetChild(child).SetItems([]uint16{5, 6}).SetTail(3).Build())
	if n := must(P.ValidateInlineOuter(b)); n != len(b) || len(b) != 3+4+1 {
		t.Fatalf("inline: %x", b)
	}
}
"#,
    );
    let dir = generate(
        "imports",
        &["tests/cross_package/count_user.abi.yaml"],
        &["tests/cross_package"],
    );
    go_test(
        &go,
        &dir,
        "compliance.cross_package.user",
        &[("C", "compliance/cross_package/child")],
        r#"
func TestImports(t *testing.T) {
	child := must(C.NewCountChildBuilder().SetBytes([]uint8{1, 2}).SetCount(2).Build())
	b := must(P.NewImportedCountBuilder().SetChild(child).SetItems([]uint16{5, 6}).SetTail(9).Build())
	v := must(P.ParseImportedCount(b))
	var c C.CountChild = v.Child()
	if c.Count() != 2 || v.ItemsLen() != 2 || v.Tail() != 9 {
		t.Fatal("imported child")
	}
	if x, _ := v.ItemsAt(1); x != 6 {
		t.Fatal("items sized by the imported field")
	}
	_, err := P.ValidateImportedCount(b[:len(b)-1])
	if need, ok := tnabi.RequiredSize(err); !ok || need != uint64(len(b)) {
		t.Fatal("exact size through the import")
	}
}
"#,
    );
}

/* The CLI's `--go-module` sets the module path written to go.mod and used by
every import; the output is gofmt-clean. */
#[test]
fn test_go_module_option_and_gofmt() {
    let Some(go) = go_bin() else { return };
    let dir = fresh("cli");
    let out = Command::new(env!("CARGO_BIN_EXE_abi-gen"))
        .args([
            "codegen",
            "-l",
            "go",
            "--go-module",
            "example.com/gen/abi",
            "-f",
        ])
        .arg(manifest().join("tests/cross_package/count_user.abi.yaml"))
        .arg("-i")
        .arg(manifest().join("tests/cross_package"))
        .arg("-o")
        .arg(&dir)
        .output()
        .expect("abi-gen");
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let gomod = fs::read_to_string(dir.join("go.mod")).unwrap();
    assert!(gomod.starts_with("module example.com/gen/abi\n"), "{gomod}");
    let user = fs::read_to_string(dir.join("compliance/cross_package/user/types.go")).unwrap();
    assert!(user.contains("tnabi \"example.com/gen/abi/tnabi\""));
    assert!(user.contains("\"example.com/gen/abi/compliance/cross_package/child\""));
    assert!(user.contains("package user\n"));
    let vet = Command::new(&go)
        .args(["vet", "./..."])
        .current_dir(&dir)
        .env("CGO_ENABLED", "0")
        .output()
        .unwrap();
    assert!(
        vet.status.success(),
        "{}",
        String::from_utf8_lossy(&vet.stderr)
    );
    let gofmt = Path::new(&go).with_file_name("gofmt");
    let gofmt = if gofmt.exists() {
        gofmt
    } else {
        PathBuf::from("gofmt")
    };
    if let Ok(o) = Command::new(gofmt)
        .args(["-l", "."])
        .current_dir(&dir)
        .output()
    {
        assert!(
            o.stdout.is_empty(),
            "not gofmt-clean: {}",
            String::from_utf8_lossy(&o.stdout)
        );
    }
    let _ = fs::remove_dir_all(&dir);
}

/* Declared names that clash with each other (`foo` / `Foo`) and with the
helpers generated for other types (`MessageBuilder`, `MessageParams`,
`ParseMessage`, `KindBodyRef`, `KindBodyTagA`, `KindBodyVariants`,
`Thing__Ext`): one package-level table allocates them all, the
declared types keep their names and the helpers that would clash get a `_`
suffix (`docs/go-codegen.md`). The package must vet and build, and every
declared type must be the ABI type of that name. */
#[test]
fn test_go_package_names_never_clash() {
    let Some(go) = go_bin() else { return };
    let dir = generate("clashes", &["tests/go_fixtures/name_clashes.abi.yaml"], &[]);
    go_test(
        &go,
        &dir,
        "test.name_clashes",
        &[],
        r#"
func TestNames(t *testing.T) {
	/* `Foo` sorts before `foo`, which becomes `Foo_`. */
	if must(P.ValidateFoo([]byte{1})) != 1 || must(P.ValidateFoo_([]byte{1, 2})) != 2 {
		t.Fatal("Foo / foo")
	}
	/* Declared types keep their names; Message's helpers that clash take
	the suffix (`MessageBuilder_`, `MessageParams_`, `ParseMessage_`). */
	var mb *P.MessageBuilder_ = P.NewMessageBuilder()
	if must(mb.SetData([]uint8{7}).Build())[0] != 1 {
		t.Fatal("Message builder")
	}
	if b := must(P.NewMessageBuilderBuilder().SetY(3).Build()); len(b) != 1 || b[0] != 3 {
		t.Fatal("declared MessageBuilder")
	}
	var p P.MessageParams_ = must(P.MessageParamsFromBuffer([]byte{2, 0, 0}))
	if must(P.FootprintMessage(&p)) != 3 {
		t.Fatal("Message params")
	}
	var mp P.MessageParams = must(P.ParseMessageParams([]byte{5}))
	var pm P.ParseMessage = must(P.ParseParseMessage([]byte{6}))
	if mp.Z() != 5 || pm.W() != 6 || must(P.ParseMessage_([]byte{0})).N() != 0 {
		t.Fatal("declared MessageParams / ParseMessage")
	}
	/* Enum helpers. */
	k := must(P.ParseKind([]byte{1, 2, 0}))
	var r P.KindBodyRef_ = k.Body()
	if r.Tag != P.KindBodyTagB || P.KindBodyTagA_ != 0 || len(P.KindBodyVariants_) != 2 {
		t.Fatal("enum helpers")
	}
	if must(P.ParseKindBodyRef([]byte{1})).R() != 1 || must(P.ParseKindBodyTagA([]byte{2})).T() != 2 || must(P.ParseKindBodyVariants([]byte{3})).V() != 3 {
		t.Fatal("declared enum-helper names")
	}
	/* Context types. */
	var _ P.Thing__Ext_ = must(P.ParseThing([]byte{1})).Context()
	if must(P.ParseThing__Ext([]byte{4})).E() != 4 {
		t.Fatal("declared Thing__Ext")
	}
}
"#,
    );
}

const DYN_TAIL_ABI: &str = r#"
abi:
  package: "test.dyn_tail"
  abi-version: 1
  package-version: "1.0.0"
  description: "Fields whose offsets depend on an earlier count"
types:
  - name: "Pt"
    kind:
      struct:
        packed: true
        fields:
          - name: "x"
            field-type:
              primitive: u8
  - name: "Pt2"
    kind:
      struct:
        packed: true
        fields:
          - name: "m"
            field-type:
              primitive: u8
          - name: "xs"
            field-type:
              array:
                size:
                  field-ref:
                    path: ["m"]
                element-type:
                  primitive: u8
  - name: "DynTail"
    kind:
      struct:
        packed: true
        fields:
          - name: "n"
            field-type:
              primitive: u8
          - name: "data"
            field-type:
              array:
                size:
                  field-ref:
                    path: ["n"]
                element-type:
                  primitive: u8
          - name: "tail"
            field-type:
              primitive: u8
          - name: "tag"
            field-type:
              primitive: u8
          - name: "body"
            field-type:
              enum:
                packed: true
                tag-ref:
                  field-ref:
                    path: ["tag"]
                variants:
                  - name: "A"
                    tag-value: 0
                    variant-type:
                      primitive: u8
                  - name: "B"
                    tag-value: 1
                    variant-type:
                      primitive: u16
          - name: "pts"
            field-type:
              array:
                size:
                  literal:
                    u32: 2
                element-type:
                  type-ref:
                    name: "Pt"
          - name: "inner"
            field-type:
              type-ref:
                name: "Pt2"
"#;

/* A setter whose field offset depends on the bytes must not write when the
bytes no longer lay out: after `SetN(255)` on a 9-byte `DynTail`, `tail`,
`data`, `body`, `pts` and `inner` cannot be located, so every setter returns
the layout error and leaves the bytes as they are (it used to write at
offset 0, over `n`). Getters read zeros. */
#[test]
fn test_go_setters_propagate_layout_errors() {
    let Some(go) = go_bin() else { return };
    let dir = generate_inline("dyntail", &[("dyn.abi.yaml", DYN_TAIL_ABI)]);
    go_test(
        &go,
        &dir,
        "test.dyn_tail",
        &[],
        r#"
func TestSettersPropagateLayoutErrors(t *testing.T) {
	b := []byte{1, 42, 9, 0, 5, 1, 2, 1, 3}
	v := must(P.ParseDynTail(b))
	if v.Tail() != 9 || v.Inner().Xs()[0] != 3 {
		t.Fatal("getters")
	}
	if err := v.SetN(255); err != nil {
		t.Fatal(err)
	}
	want := []byte{255, 42, 9, 0, 5, 1, 2, 1, 3}
	pt := must(P.ParsePt([]byte{7}))
	short := func(what string, err error) {
		t.Helper()
		if kind(err) != tnabi.KindBufferTooSmall {
			t.Fatalf("%s: %v", what, err)
		}
		if !bytes.Equal(b, want) {
			t.Fatalf("%s wrote %x", what, b)
		}
	}
	short("SetTail", v.SetTail(7))
	short("SetTag", v.SetTag(1))
	short("SetDataAt", v.SetDataAt(0, 1))
	short("SetData", v.SetData([]uint8{1}))
	short("SetBodyAsA", v.SetBodyAsA(1))
	short("SetBodyBody", v.SetBodyBody([]byte{1}))
	short("SetPtsAt", v.SetPtsAt(0, pt))
	short("SetInner", v.SetInner([]byte{0}))
	/* Getters read zeros. */
	if v.Tail() != 0 || v.Tag() != 0 || v.DataBytes() != nil || v.BodyBody() != nil || v.Body().Known || v.Inner().M() != 0 {
		t.Fatal("getters on a broken layout")
	}
	if x, ok := v.PtsAt(0); ok || x.X() != 0 {
		t.Fatal("element getter on a broken layout")
	}
	if _, err := v.Check(); kind(err) != tnabi.KindBufferTooSmall {
		t.Fatal("check")
	}
	/* Restoring the count makes everything work again. */
	if err := v.SetN(1); err != nil || v.SetTail(8) != nil || b[2] != 8 {
		t.Fatal("restored")
	}
}
"#,
    );
}

/* An inline struct reading `__buffer_size` sees the bytes left for it, in
the walker and in the IR helpers: their `bufSz` is the root's, less the bytes
before the inline struct. */
#[test]
fn test_go_inline_struct_reads_its_own_buffer_size() {
    let Some(go) = go_bin() else { return };
    let dir = generate(
        "inlinebufsz",
        &["tests/go_fixtures/inline_buffer_sized.abi.yaml"],
        &[],
    );
    go_test(
        &go,
        &dir,
        "test.inline_buffer_sized",
        &[],
        r#"
func TestInlineBufferSize(t *testing.T) {
	// n, then inner: m = 1, head = [aa], tail = [bb].
	b := []byte{9, 1, 0xaa, 0xbb}
	if must(P.ValidateOuter(b)) != 4 {
		t.Fatal("walker")
	}
	if must(P.OuterValidateIR(4, 1, 0, 0)) != 4 || P.OuterFootprintIR(4, 1, 0, 0) != 4 {
		t.Fatal("IR helpers")
	}
}
"#,
    );
}

/* Two inline structs each holding a named variable-size child: each child's
count is its own IR input, so the helpers size children with different
counts. */
#[test]
fn test_go_inline_children_keep_separate_ir_inputs() {
    let Some(go) = go_bin() else { return };
    let dir = generate(
        "inlinechild",
        &["tests/go_fixtures/inline_child_inputs.abi.yaml"],
        &[],
    );
    go_test(
        &go,
        &dir,
        "test.inline_child_inputs",
        &[],
        r#"
func TestInlineChildInputs(t *testing.T) {
	// left: n = 1, [aa]; right: n = 2, [bb cc].
	if must(P.ValidateOuter([]byte{1, 0xaa, 2, 0xbb, 0xcc})) != 5 {
		t.Fatal("walker")
	}
	if must(P.OuterValidateIR(5, 1, 2)) != 5 || P.OuterFootprintIR(1, 2) != 5 || P.OuterFootprintIR(2, 0) != 4 {
		t.Fatal("IR helpers")
	}
}
"#,
    );
}

/* Computed enum tags and payload sizes in inline structs (and an enum in a
packed struct, not rounded up to its alignment): the walker sizes them from
the bytes, the IR helpers from the tag and payload the caller gives. */
#[test]
fn test_go_inline_struct_computed_tags_and_payloads() {
    let Some(go) = go_bin() else { return };
    let dir = generate(
        "inlinectag",
        &["tests/go_fixtures/inline_computed_tag.abi.yaml"],
        &[],
    );
    go_test(
        &go,
        &dir,
        "test.inline_computed_tag",
        &[],
        r#"
func TestInlineComputedTags(t *testing.T) {
	if must(P.ValidateOuter([]byte{0, 7})) != 2 || must(P.ValidateOuter([]byte{1, 8, 7})) != 3 {
		t.Fatal("Outer walker")
	}
	if must(P.ValidateFlat([]byte{0, 7})) != 2 || must(P.ValidateSized([]byte{9, 1, 2})) != 3 {
		t.Fatal("Flat / Sized walker")
	}
	if must(P.OuterValidateIR(2, 0, 0, 0)) != 2 || must(P.OuterValidateIR(3, 1, 1, 1)) != 3 {
		t.Fatal("Outer validate IR")
	}
	if P.OuterFootprintIR(0, 0, 0) != 2 || P.FlatFootprintIR(0, 0, 0) != 2 || P.FlatFootprintIR(1, 1, 1) != 3 {
		t.Fatal("footprint IR")
	}
	if must(P.SizedValidateIR(3, 2, 2)) != 3 || P.SizedFootprintIR(2, 2) != 3 {
		t.Fatal("Sized IR")
	}
}
"#,
    );
}

/* A type holding one sized by `__buffer_size` (`SizedHolder { tag: u8, body:
BufferSizedEntries }`): the callee's IR helpers take the buffer size, which
the holder's IR cannot give it (the bytes left for `body` are not an IR
value), so the holder gets no IR helpers while the callee keeps them. The
package must vet and build (it used to call the callee without `bufSz`). */
#[test]
fn test_go_ir_helpers_skip_nested_buffer_size() {
    let Some(go) = go_bin() else { return };
    let dir = generate(
        "bufholder",
        &["tests/go_fixtures/buffer_sized_holder.abi.yaml"],
        &[],
    );
    let src = fs::read_to_string(dir.join("test/buffer_sized_holder/types.go")).unwrap();
    assert!(
        !src.contains("func SizedHolderFootprintIR"),
        "holder IR helpers emitted"
    );
    go_test(
        &go,
        &dir,
        "test.buffer_sized_holder",
        &[],
        r#"
func TestBufferSizedIR(t *testing.T) {
	if must(P.BufferSizedEntriesValidateIR(20)) != 20 || P.BufferSizedEntriesFootprintIR(28) != 28 {
		t.Fatal("callee IR helpers")
	}
	b := make([]byte, 13)
	if must(P.ValidateSizedHolder(b)) != 13 || must(P.ParseSizedHolder(b)).Body().EntriesLen() != 1 {
		t.Fatal("holder walker")
	}
}
"#,
    );
}

/* A declared `A_b` next to `A { b: inline struct }` (inline type `A::b`):
 * each keeps its own view and layout; the inline one is `A_b_`. */
#[test]
fn test_go_declared_type_named_like_inline_view() {
    let Some(go) = go_bin() else { return };
    let dir = generate(
        "inlineclash",
        &["tests/go_fixtures/inline_view_clash.abi.yaml"],
        &[],
    );
    go_test(
        &go,
        &dir,
        "test.inline_view_clash",
        &[],
        r#"
func TestInlineViewClash(t *testing.T) {
	d := must(P.ParseA_b([]byte{1, 0, 0, 0, 0, 0, 0, 0, 2}))
	if d.X() != 1 || d.Y() != 2 || d.Size() != 9 {
		t.Fatal("declared A_b")
	}
	a := must(P.ParseA([]byte{9, 3, 4, 0, 7}))
	var b P.A_b_ = a.B()
	if a.N() != 9 || b.P() != 3 || b.Q() != 4 || a.Tail() != 7 || a.Size() != 5 || b.Size() != 3 {
		t.Fatal("inline A::b")
	}
	if _, err := P.ParseA_b([]byte{9, 3, 4, 0, 7}); err == nil {
		t.Fatal("A_b accepted 5 bytes")
	}
}
"#,
    );
}

/* Go spells every imported item through its package (`D.A_b`), so items of
 * the importer named like them (its inline `A::b`, `MsgBuilder`, `FOO`'s IR
 * helpers) cannot shadow them. */
#[test]
fn test_go_imported_items_are_not_shadowed() {
    let Some(go) = go_bin() else { return };
    let dir = generate(
        "importshadow",
        &["tests/cross_package/shadow_user.abi.yaml"],
        &["tests/cross_package"],
    );
    go_test(
        &go,
        &dir,
        "test.cross_package.shadow_user",
        &[("D", "test/cross_package/shadow_dep")],
        r#"
func TestImportShadowing(t *testing.T) {
	b := []byte{1, 0, 0, 0, 0, 0, 0, 0, 2, 0x34, 0x12, 2, 7, 8}
	h := must(P.ParseHolder(b))
	var ab D.A_b = h.Ab()
	var mb D.MsgBuilder = h.Mb()
	if ab.X() != 1 || ab.Y() != 2 || mb.Z() != 0x1234 || h.Foo().DataLen() != 2 {
		t.Fatal("imported fields")
	}
	if P.HolderFootprintIR(2) != 14 || P.FOOFootprintIR() != 4 || D.FooFootprintIR(2) != 3 {
		t.Fatal("IR helpers")
	}
	a := must(P.ParseA([]byte{9, 3, 4, 0}))
	if a.B().Q() != 4 || a.B().Size() != 3 {
		t.Fatal("local inline A::b")
	}
}
"#,
    );
}

/* ABI packages whose plain Go import names (`a.b_c` and `a_b.c`: both
`tnp_a_b_c`) or directories (`cases.Foo` and `cases.foo` on a
case-insensitive file system) would clash: an importer gets one alias per
package and every package its own directory (`cases/foo_`, the later in
sorted order taking the suffix). */
#[test]
fn test_go_import_names_and_directories_are_distinct() {
    let Some(go) = go_bin() else { return };
    let dir = generate(
        "pkgclash",
        &["tests/package_fixtures/user.abi.yaml"],
        &["tests/package_fixtures"],
    );
    for d in ["a/b_c", "a_b/c", "cases/Foo", "cases/foo_", "pkguser"] {
        assert!(
            dir.join(d).join("types.go").exists(),
            "missing {d}/types.go"
        );
    }
    let user = fs::read_to_string(dir.join("pkguser/types.go")).unwrap();
    assert!(user.contains("tnp_a_b_c \"abigen/a/b_c\""), "{user}");
    assert!(user.contains("tnp_a_b_c_ \"abigen/a_b/c\""), "{user}");
    go_test(
        &go,
        &dir,
        "pkguser",
        &[("U", "cases/Foo"), ("L", "cases/foo_")],
        r#"
func TestDistinctImports(t *testing.T) {
	b := must(P.NewBothBuilder().SetX([]byte{1}).SetY([]byte{2}).SetUpper([]byte{3}).SetLower([]byte{4}).Build())
	v := must(P.ParseBoth(b))
	var u U.Upper = v.Upper()
	var l L.Lower = v.Lower()
	if v.X().V() != 1 || v.Y().V() != 2 || u.V() != 3 || l.V() != 4 {
		t.Fatal("fields of four imported packages")
	}
}
"#,
    );
}

/* An ABI package named `tnabi` cannot share the runtime's directory: it is
generated into `tnabi_/` (package `tnabi_`), and the runtime stays alone in
`tnabi/`. */
#[test]
fn test_go_package_named_like_the_runtime() {
    let Some(go) = go_bin() else { return };
    let dir = generate(
        "tnabipkg",
        &["tests/go_fixtures/tnabi_package.abi.yaml"],
        &[],
    );
    let runtime: Vec<String> = fs::read_dir(dir.join("tnabi"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
        .collect();
    assert_eq!(runtime, vec!["runtime.go".to_string()]);
    go_test_in(
        &go,
        &dir,
        "tnabi",
        "tnabi_",
        &[],
        r#"
func TestRuntimeNamedPackage(t *testing.T) {
	if must(P.ParseRuntimeNamed([]byte{1, 2})).V() != 0x0201 {
		t.Fatal("package tnabi_")
	}
}
"#,
    );
}
