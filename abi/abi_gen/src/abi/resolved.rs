use crate::abi::expr::{ConstantExpression, ExprKind, LiteralExpr};
use crate::abi::types::{FloatingPointType, IntegralType, PrimitiveType, TypeDef, TypeKind};
use std::collections::{BTreeMap, HashMap, HashSet};

type FieldRefMap = HashMap<String, HashMap<String, PrimitiveType>>;
type ContextStack = Vec<*const ResolvedType>;

struct ContextGuard {
    stack: *mut ContextStack,
}

impl ContextGuard {
    fn new(stack: &mut ContextStack, ty: &ResolvedType) -> Self {
        stack.push(ty as *const ResolvedType);
        Self {
            stack: stack as *mut ContextStack,
        }
    }
}

impl Drop for ContextGuard {
    fn drop(&mut self) {
        unsafe {
            (*self.stack).pop();
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum ConstantStatus {
    Constant,
    NonConstant(HashMap<String, PrimitiveType>), // Map of field path -> primitive type
}

#[derive(Debug, Clone, PartialEq)]
pub enum Size {
    Const(u64),
    Variable(HashMap<String, HashMap<String, PrimitiveType>>), // Map of field/variant name -> (field-ref path -> primitive type)
}

#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedType {
    pub name: String,
    pub size: Size,
    pub alignment: u64,
    pub comment: Option<String>,
    pub dynamic_params: BTreeMap<String, BTreeMap<String, PrimitiveType>>,
    pub kind: ResolvedTypeKind,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ResolvedTypeKind {
    Primitive {
        prim_type: PrimitiveType,
    },
    Struct {
        fields: Vec<ResolvedField>,
        packed: bool,
        custom_alignment: Option<u64>,
    },
    Union {
        variants: Vec<ResolvedField>,
    },
    Enum {
        tag_expression: ExprKind,
        tag_constant_status: ConstantStatus,
        variants: Vec<ResolvedEnumVariant>,
    },
    Array {
        element_type: Box<ResolvedType>,
        size_expression: ExprKind,
        size_constant_status: ConstantStatus,
        /// When true, elements have variable size (jagged array). Requires O(n) iteration for access.
        jagged: bool,
    },
    SizeDiscriminatedUnion {
        variants: Vec<ResolvedSizeDiscriminatedVariant>,
    },
    TypeRef {
        target_name: String,
        resolved: bool,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedField {
    pub name: String,
    pub field_type: ResolvedType,
    pub offset: Option<u64>, // None if offset cannot be determined due to non-constant sizes
}

#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedEnumVariant {
    pub name: String,
    pub tag_value: u64,
    pub variant_type: ResolvedType,
    pub requires_payload_size: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedSizeDiscriminatedVariant {
    pub name: String,
    pub expected_size: u64,
    pub variant_type: ResolvedType,
}

struct FieldOrderTracker<'a> {
    struct_name: &'a str,
    field_positions: &'a HashMap<String, usize>,
    current_field_index: usize,
    current_field_name: &'a str,
}

impl<'a> FieldOrderTracker<'a> {
    fn base_field<'b>(&self, path: &'b str) -> Option<&'b str> {
        if path.starts_with("..") || path.contains("../") {
            return None;
        }
        let first_segment = path
            .split('.')
            .next()
            .map(|seg| seg.trim_start_matches("../"))
            .unwrap_or("");
        if first_segment.is_empty() {
            return None;
        }
        if self.field_positions.contains_key(first_segment) {
            Some(first_segment)
        } else {
            None
        }
    }

    fn validate_reference(&self, path: &str) -> Result<(), ResolutionError> {
        if let Some(base) = self.base_field(path) {
            if let Some(&idx) = self.field_positions.get(base) {
                if idx >= self.current_field_index {
                    return Err(ResolutionError::ForwardFieldReference {
                        type_name: self.struct_name.to_string(),
                        field_name: self.current_field_name.to_string(),
                        referenced_field: base.to_string(),
                    });
                }
            }
        }
        Ok(())
    }
}

#[derive(Debug)]
pub struct TypeResolver {
    pub types: HashMap<String, ResolvedType>,
    pub typedefs: HashMap<String, TypeDef>,
    pub resolution_order: Vec<String>,
}

#[derive(Debug)]
pub enum ResolutionError {
    UnknownType(String),
    CircularDependency(Vec<String>),
    InvalidTypeDefinition(String),
    InvalidComment(String),
    FieldReferenceNotFound(String),
    FieldReferenceNotPrimitive(String),
    NonConstantTypeReference(String),
    ForwardFieldReference {
        type_name: String,
        field_name: String,
        referenced_field: String,
    },
}

impl TypeResolver {
    pub fn new() -> Self {
        Self {
            types: HashMap::new(),
            typedefs: HashMap::new(),
            resolution_order: Vec::new(),
        }
    }

    pub fn add_typedef(&mut self, typedef: TypeDef) {
        self.typedefs.insert(typedef.name.clone(), typedef);
    }

    pub fn resolve_all(&mut self) -> Result<(), ResolutionError> {
        // First, collect all type names
        let mut type_names: Vec<String> = self.typedefs.keys().cloned().collect();
        type_names.sort();

        // Resolve types in dependency order
        let mut resolved_count = 0;
        let total_types = type_names.len();
        let mut missing_types: HashSet<String> = HashSet::new();

        while resolved_count < total_types {
            let previous_count = resolved_count;
            missing_types.clear();

            for type_name in &type_names {
                if !self.types.contains_key(type_name) {
                    match self.try_resolve_type(type_name) {
                        Ok(resolved_type) => {
                            self.types.insert(type_name.clone(), resolved_type);
                            self.resolution_order.push(type_name.clone());
                            resolved_count += 1;
                        }
                        Err(ResolutionError::UnknownType(missing_type)) => {
                            // Track which specific types are missing
                            // Check if the missing type is actually defined in our typedefs
                            if !self.typedefs.contains_key(&missing_type) {
                                missing_types.insert(missing_type);
                            }
                            // Otherwise, it's just not resolved yet
                        }
                        Err(e) => {
                            // All other errors (InvalidComment, InvalidTypeDefinition, etc.)
                            // should be immediately propagated
                            return Err(e);
                        }
                    }
                }
            }

            // If we made no progress, check why
            if resolved_count == previous_count {
                // First check if we have missing external types
                if !missing_types.is_empty() {
                    let missing_list: Vec<String> = missing_types.into_iter().collect();
                    return Err(ResolutionError::UnknownType(format!(
                        "Missing type definitions: {}",
                        missing_list.join(", ")
                    )));
                }

                // Otherwise we have circular dependencies
                let unresolved: Vec<String> = type_names
                    .iter()
                    .filter(|name| !self.types.contains_key(*name))
                    .cloned()
                    .collect();
                return Err(ResolutionError::CircularDependency(unresolved));
            }
        }

        Ok(())
    }

    fn try_resolve_type(&self, type_name: &str) -> Result<ResolvedType, ResolutionError> {
        let typedef = self
            .typedefs
            .get(type_name)
            .ok_or_else(|| ResolutionError::UnknownType(type_name.to_string()))?;

        let mut context_stack = ContextStack::new();
        self.resolve_type_kind(
            &typedef.kind,
            type_name.to_string(),
            &mut context_stack,
            None,
        )
    }

    fn validate_type_comments(
        &self,
        type_kind: &TypeKind,
        type_name: &str,
    ) -> Result<(), ResolutionError> {
        let comment = match type_kind {
            TypeKind::Struct(t) => &t.container_attributes.comment,
            TypeKind::Union(t) => &t.container_attributes.comment,
            TypeKind::Enum(t) => &t.container_attributes.comment,
            TypeKind::SizeDiscriminatedUnion(t) => &t.container_attributes.comment,
            TypeKind::Array(t) => &t.container_attributes.comment,
            TypeKind::Primitive(_) | TypeKind::TypeRef(_) => return Ok(()),
        };

        // Validate that comment doesn't contain '*/'
        if let Some(comment_text) = comment {
            if comment_text.contains("*/") {
                return Err(ResolutionError::InvalidComment(format!(
                    "Type '{}' has invalid comment: contains '*/' which terminates C-style comments prematurely",
                    type_name
                )));
            }
        }

        Ok(())
    }

    fn resolve_type_kind(
        &self,
        type_kind: &TypeKind,
        type_name: String,
        context_stack: &mut ContextStack,
        field_order: Option<&FieldOrderTracker>,
    ) -> Result<ResolvedType, ResolutionError> {
        // Validate comments in the type before resolution
        self.validate_type_comments(type_kind, &type_name)?;

        match type_kind {
            TypeKind::Primitive(prim) => {
                let (size, alignment) = self.get_primitive_info(prim);
                Ok(ResolvedType {
                    name: type_name,
                    size: Size::Const(size),
                    alignment,
                    comment: None, // Primitive types don't have comments
                    dynamic_params: BTreeMap::new(),
                    kind: ResolvedTypeKind::Primitive {
                        prim_type: prim.clone(),
                    },
                })
            }

            TypeKind::TypeRef(type_ref) => {
                // Check if the referenced type is already resolved
                if self.types.contains_key(&type_ref.name) {
                    // Type reference is resolved - we can copy the target type info
                    let target_type = self.types.get(&type_ref.name).unwrap();

                    // CRITICAL: Size-discriminated unions cannot be used as typerefs (must be anonymous)
                    if matches!(
                        &target_type.kind,
                        ResolvedTypeKind::SizeDiscriminatedUnion { .. }
                    ) {
                        return Err(ResolutionError::InvalidTypeDefinition(format!(
                            "Type '{}' references size-discriminated union '{}'. Size-discriminated unions cannot be used as typerefs and must be anonymous.",
                            type_name, type_ref.name
                        )));
                    }

                    Ok(ResolvedType {
                        name: type_name,
                        size: target_type.size.clone(),
                        alignment: target_type.alignment,
                        comment: type_ref.comment.clone(), // Use TypeRef's own comment
                        dynamic_params: target_type.dynamic_params.clone(),
                        kind: ResolvedTypeKind::TypeRef {
                            target_name: type_ref.name.clone(),
                            resolved: true,
                        },
                    })
                } else {
                    // Type reference not yet resolved - cannot resolve this type yet
                    Err(ResolutionError::UnknownType(type_ref.name.clone()))
                }
            }

            TypeKind::Struct(struct_type) => {
                let mut fields = Vec::new();
                let mut current_offset = 0u64;
                let mut variable_prefix = false;
                let mut max_alignment = 1u64;
                let mut all_sizes_known = true;
                let mut field_references: HashMap<String, HashMap<String, PrimitiveType>> =
                    HashMap::new();
                let mut size_disc_union_count = 0u32;

                // First pass: resolve types without context to build the struct
                let mut temp_resolved = ResolvedType {
                    name: type_name.clone(),
                    size: Size::Const(0), // Temporary value
                    alignment: 1,
                    comment: struct_type.container_attributes.comment.clone(),
                    dynamic_params: BTreeMap::new(),
                    kind: ResolvedTypeKind::Struct {
                        fields: Vec::new(),
                        packed: struct_type.container_attributes.packed,
                        custom_alignment: if struct_type.container_attributes.aligned > 0 {
                            Some(struct_type.container_attributes.aligned)
                        } else {
                            None
                        },
                    },
                };
                let _context_guard = ContextGuard::new(context_stack, &temp_resolved);

                let struct_field_names: HashSet<String> = struct_type
                    .fields
                    .iter()
                    .map(|field| field.name.clone())
                    .collect();
                let field_positions: HashMap<String, usize> = struct_type
                    .fields
                    .iter()
                    .enumerate()
                    .map(|(idx, field)| (field.name.clone(), idx))
                    .collect();

                let total_fields = struct_type.fields.len();
                for (field_index, field) in struct_type.fields.iter().enumerate() {
                    let is_tail_field = field_index + 1 == total_fields;
                    // Check if this field is a size-discriminated union
                    if matches!(&field.field_type, TypeKind::SizeDiscriminatedUnion(_)) {
                        size_disc_union_count += 1;
                        if size_disc_union_count > 1 {
                            return Err(ResolutionError::InvalidTypeDefinition(format!(
                                "Struct '{}' has multiple size-discriminated union fields. Only one size-discriminated union is allowed per struct.",
                                type_name
                            )));
                        }
                    }
                    let tracker = FieldOrderTracker {
                        struct_name: &type_name,
                        field_positions: &field_positions,
                        current_field_index: field_index,
                        current_field_name: &field.name,
                    };
                    let field_type = self.resolve_type_kind(
                        &field.field_type,
                        format!("{}::{}", type_name, field.name),
                        context_stack,
                        Some(&tracker),
                    )?;

                    let field_alignment = field_type.alignment;

                    // Check if field has variable size and collect field references
                    match &field_type.size {
                        Size::Const(field_size) if !variable_prefix => {
                            // Apply packing and alignment rules
                            if !struct_type.container_attributes.packed {
                                current_offset = align_up(current_offset, field_alignment);
                            }

                            let resolved_field = ResolvedField {
                                name: field.name.clone(),
                                field_type: field_type.clone(),
                                offset: Some(current_offset),
                            };

                            fields.push(resolved_field.clone());

                            // Update the temporary struct with the new field for subsequent field resolution
                            if let ResolvedTypeKind::Struct {
                                fields: temp_fields,
                                ..
                            } = &mut temp_resolved.kind
                            {
                                temp_fields.push(resolved_field);
                            }

                            current_offset += field_size;
                            // For packed structs, alignment is 1 unless custom alignment is specified
                            if !struct_type.container_attributes.packed {
                                max_alignment = max_alignment.max(field_alignment);
                            }
                        }
                        Size::Const(_) => {
                            variable_prefix = true;
                            all_sizes_known = false;
                            let resolved_field = ResolvedField {
                                name: field.name.clone(),
                                field_type: field_type.clone(),
                                offset: None,
                            };
                            fields.push(resolved_field.clone());
                            if let ResolvedTypeKind::Struct {
                                fields: temp_fields,
                                ..
                            } = &mut temp_resolved.kind
                            {
                                temp_fields.push(resolved_field);
                            }
                        }
                        Size::Variable(field_refs) => {
                            // Field has variable size - struct size will be variable too
                            all_sizes_known = false;
                            variable_prefix = true;

                            let mut needs_payload_param = false;
                            let mut skip_owners: Option<HashSet<String>> = None;
                            if let ResolvedTypeKind::Enum { variants, .. } = &field_type.kind {
                                let has_variable_variants = variants.iter().any(|variant| {
                                    matches!(variant.variant_type.size, Size::Variable(_))
                                });
                                if has_variable_variants && is_tail_field {
                                    needs_payload_param = true;
                                    let mut owners = HashSet::new();
                                    for variant in variants {
                                        owners.insert(variant.name.clone());
                                    }
                                    skip_owners = Some(owners);
                                }
                            }

                            // Copy field references with field name as key, adding prefix to paths when needed
                            for (owner, inner_refs) in field_refs {
                                if matches!(field_type.kind, ResolvedTypeKind::TypeRef { .. }) {
                                    continue;
                                }
                                let should_skip = skip_owners
                                    .as_ref()
                                    .map_or(false, |owners| owners.contains(owner));
                                if should_skip {
                                    continue;
                                }
                                insert_struct_refs(
                                    &field.name,
                                    inner_refs,
                                    &struct_field_names,
                                    &mut field_references,
                                );
                            }

                            if matches!(
                                field_type.kind,
                                ResolvedTypeKind::SizeDiscriminatedUnion { .. }
                            ) {
                                insert_owner_ref(
                                    &field.name,
                                    &format!("{}.payload_size", field.name),
                                    &PrimitiveType::Integral(IntegralType::U64),
                                    &mut field_references,
                                );
                            }
                            if let ResolvedTypeKind::Enum { .. } = &field_type.kind {
                                if needs_payload_param {
                                    insert_owner_ref(
                                        &field.name,
                                        &format!("{}.payload_size", field.name),
                                        &PrimitiveType::Integral(IntegralType::U64),
                                        &mut field_references,
                                    );
                                }
                            }

                            let resolved_field = ResolvedField {
                                name: field.name.clone(),
                                field_type,
                                offset: None,
                            };

                            fields.push(resolved_field.clone());

                            // Update the temporary struct even for unknown-size fields
                            if let ResolvedTypeKind::Struct {
                                fields: temp_fields,
                                ..
                            } = &mut temp_resolved.kind
                            {
                                temp_fields.push(resolved_field);
                            }
                        }
                    }
                }

                // Apply custom alignment if specified
                if struct_type.container_attributes.aligned > 0 {
                    max_alignment = struct_type.container_attributes.aligned;
                }

                // Calculate final struct size
                let dynamic_params = normalize_field_refs(&field_references);
                let final_size = if all_sizes_known {
                    if struct_type.container_attributes.packed {
                        // Packed structs don't get final alignment padding
                        Size::Const(current_offset)
                    } else {
                        // Regular structs get aligned to their maximum field alignment
                        Size::Const(align_up(current_offset, max_alignment))
                    }
                } else {
                    Size::Variable(field_references)
                };

                Ok(ResolvedType {
                    name: type_name,
                    size: final_size,
                    alignment: max_alignment,
                    comment: struct_type.container_attributes.comment.clone(),
                    dynamic_params,
                    kind: ResolvedTypeKind::Struct {
                        fields,
                        packed: struct_type.container_attributes.packed,
                        custom_alignment: if struct_type.container_attributes.aligned > 0 {
                            Some(struct_type.container_attributes.aligned)
                        } else {
                            None
                        },
                    },
                })
            }

            TypeKind::Union(union_type) => {
                let mut variants = Vec::new();
                let mut max_size = 0u64;
                let mut max_alignment = 1u64;
                let mut all_sizes_known = true;
                let mut field_references: HashMap<String, HashMap<String, PrimitiveType>> =
                    HashMap::new();

                for variant in &union_type.variants {
                    let variant_type = self.resolve_type_kind(
                        &variant.variant_type,
                        format!("{}::{}", type_name, variant.name),
                        context_stack,
                        field_order,
                    )?;
                    let variant_alignment = variant_type.alignment;

                    // Handle size and collect field references
                    match &variant_type.size {
                        Size::Const(variant_size) => {
                            max_size = max_size.max(*variant_size);
                        }
                        Size::Variable(variant_refs) => {
                            all_sizes_known = false;

                            for (_, inner_refs) in variant_refs {
                                insert_variant_refs(
                                    &variant.name,
                                    inner_refs,
                                    &mut field_references,
                                );
                            }
                        }
                    }

                    // For packed unions, alignment is 1 unless custom alignment is specified
                    if !union_type.container_attributes.packed {
                        max_alignment = max_alignment.max(variant_alignment);
                    }

                    variants.push(ResolvedField {
                        name: variant.name.clone(),
                        field_type: variant_type,
                        offset: Some(0), // All union fields start at offset 0
                    });
                }

                let dynamic_params = normalize_field_refs(&field_references);
                let final_size = if all_sizes_known {
                    Size::Const(max_size)
                } else {
                    Size::Variable(field_references)
                };

                Ok(ResolvedType {
                    name: type_name,
                    size: final_size,
                    alignment: max_alignment,
                    comment: union_type.container_attributes.comment.clone(),
                    dynamic_params,
                    kind: ResolvedTypeKind::Union { variants },
                })
            }

            TypeKind::Enum(enum_type) => {
                // Analyze the tag expression for constantness
                let tag_constant_status = self.analyze_expression_constantness_with_order(
                    &enum_type.tag_ref,
                    context_stack,
                    field_order,
                )?;

                let mut variants = Vec::new();
                let mut max_variant_size = 0u64;
                let mut max_variant_alignment = 1u64;
                let mut all_sizes_known = true;
                let mut field_references: HashMap<String, HashMap<String, PrimitiveType>> =
                    HashMap::new();

                for variant in &enum_type.variants {
                    let variant_type = self.resolve_type_kind(
                        &variant.variant_type,
                        format!("{}::{}", type_name, variant.name),
                        context_stack,
                        field_order,
                    )?;
                    let variant_requires_payload_size =
                        matches!(variant_type.size, Size::Variable(_));

                    // Track maximum variant size and collect field references
                    match &variant_type.size {
                        Size::Const(variant_size) => {
                            max_variant_size = max_variant_size.max(*variant_size);
                        }
                        Size::Variable(variant_refs) => {
                            all_sizes_known = false;

                            if variant_refs.is_empty() {
                                // Nothing to insert; rely on payload_size parameter.
                            } else {
                                for (_, inner_refs) in variant_refs {
                                    insert_variant_refs(
                                        &variant.name,
                                        inner_refs,
                                        &mut field_references,
                                    );
                                }
                            }
                        }
                    }
                    max_variant_alignment = max_variant_alignment.max(variant_type.alignment);

                    variants.push(ResolvedEnumVariant {
                        name: variant.name.clone(),
                        tag_value: variant.tag_value,
                        variant_type,
                        requires_payload_size: variant_requires_payload_size,
                    });
                }

                let mut enum_field_references = field_references;

                // Check if all variants have the same size
                let all_same_size = if all_sizes_known {
                    let first_variant_size = variants
                        .first()
                        .map(|v| {
                            if let Size::Const(size) = v.variant_type.size {
                                Some(size)
                            } else {
                                None
                            }
                        })
                        .flatten();

                    first_variant_size
                        .map(|first_size| {
                            variants.iter().all(|v| {
                                if let Size::Const(size) = v.variant_type.size {
                                    size == first_size
                                } else {
                                    false
                                }
                            })
                        })
                        .unwrap_or(false)
                } else {
                    false
                };

                // Enum size calculation:
                // - If all variants have the same constant size: enum has that constant size
                // - If variants have different sizes: enum is variable-size (depends on tag value)
                // - If any variant has variable size: enum is variable-size
                if !(all_sizes_known && all_same_size) {
                    // Variable size - depends on tag value to determine which variant is active
                    // Include tag expression in field references
                    if let ConstantStatus::NonConstant(tag_field_refs) = &tag_constant_status {
                        let entry = enum_field_references
                            .entry(type_name.clone())
                            .or_insert_with(HashMap::new);
                        for (ref_path, prim_type) in tag_field_refs {
                            entry.insert(ref_path.clone(), prim_type.clone());
                        }
                    } else if let ConstantStatus::Constant = &tag_constant_status {
                        // Tag is constant but variants differ in size - still need tag ref for size calculation
                        // Add the tag field reference from the tag expression
                        let entry = enum_field_references
                            .entry(type_name.clone())
                            .or_insert_with(HashMap::new);
                        if let ExprKind::FieldRef(field_ref) = &enum_type.tag_ref {
                            // Assume tag is primitive integral type (validated elsewhere)
                            // Use u8 as placeholder - actual type should be validated
                            entry.insert(
                                field_ref.path.join("."),
                                PrimitiveType::Integral(IntegralType::U8),
                            );
                        }
                    }
                }

                let dynamic_params = normalize_field_refs(&enum_field_references);
                let final_size = if all_sizes_known && all_same_size {
                    // All variants same size - enum has constant size
                    Size::Const(max_variant_size)
                } else {
                    Size::Variable(enum_field_references)
                };

                Ok(ResolvedType {
                    name: type_name,
                    size: final_size,
                    alignment: max_variant_alignment,
                    comment: enum_type.container_attributes.comment.clone(),
                    dynamic_params,
                    kind: ResolvedTypeKind::Enum {
                        tag_expression: enum_type.tag_ref.clone(),
                        tag_constant_status,
                        variants,
                    },
                })
            }

            TypeKind::Array(array_type) => {
                // Check if element type is a TypeRef pointing to a non-constant sized type
                // Skip this check for jagged arrays, which allow variable-size elements
                if !array_type.jagged {
                    if let TypeKind::TypeRef(type_ref) = &*array_type.element_type {
                        if let Some(target_type) = self.types.get(&type_ref.name) {
                            if let Size::Variable(_) = target_type.size {
                                return Err(ResolutionError::NonConstantTypeReference(format!(
                                    "Array '{}' element type references '{}' which has non-constant size",
                                    type_name, type_ref.name
                                )));
                            }
                        }
                    }
                } else {
                    // Jagged arrays cannot contain SDUs - validate element type
                    if let TypeKind::TypeRef(type_ref) = &*array_type.element_type {
                        if let Some(target_type) = self.types.get(&type_ref.name) {
                            // Check if target type is a struct containing SDU fields
                            if let ResolvedTypeKind::Struct { fields, .. } = &target_type.kind {
                                for field in fields {
                                    if matches!(field.field_type.kind, ResolvedTypeKind::SizeDiscriminatedUnion { .. }) {
                                        return Err(ResolutionError::NonConstantTypeReference(format!(
                                            "Jagged array '{}' element type '{}' contains size-discriminated union field '{}'. SDUs are not allowed in jagged array elements.",
                                            type_name, type_ref.name, field.name
                                        )));
                                    }
                                }
                            } else if matches!(target_type.kind, ResolvedTypeKind::SizeDiscriminatedUnion { .. }) {
                                return Err(ResolutionError::NonConstantTypeReference(format!(
                                    "Jagged array '{}' element type '{}' is a size-discriminated union. SDUs are not allowed as jagged array elements.",
                                    type_name, type_ref.name
                                )));
                            }
                        }
                    } else if matches!(*array_type.element_type, TypeKind::SizeDiscriminatedUnion(_)) {
                        return Err(ResolutionError::NonConstantTypeReference(format!(
                            "Jagged array '{}' has inline size-discriminated union element. SDUs are not allowed as jagged array elements.",
                            type_name
                        )));
                    }
                }

                let element_type = Box::new(self.resolve_type_kind(
                    &array_type.element_type,
                    format!("{}::element", type_name),
                    context_stack,
                    field_order,
                )?);
                // Analyze field references with parent context for validation
                let size_constant_status = self.analyze_expression_constantness_with_order(
                    &array_type.size,
                    context_stack,
                    field_order,
                )?;

                // Validate that array size fields are integral types (already validated that they're primitive)
                if let ConstantStatus::NonConstant(ref field_refs) = size_constant_status {
                    for (path, prim_type) in field_refs {
                        // Arrays sizes must be integral types
                        if !matches!(prim_type, PrimitiveType::Integral(_)) {
                            return Err(ResolutionError::FieldReferenceNotPrimitive(path.clone()));
                        }
                    }
                }

                // Calculate array size and propagate field references
                let mut dynamic_sources: HashMap<String, HashMap<String, PrimitiveType>> =
                    HashMap::new();
                let mut key_segments: Vec<String> = type_name
                    .split("::")
                    .skip(1)
                    .map(|s| s.to_string())
                    .collect();
                if key_segments.is_empty() {
                    key_segments.push("array".to_string());
                } else if key_segments
                    .first()
                    .map(|s| s == "element")
                    .unwrap_or(false)
                {
                    key_segments.insert(0, "array".to_string());
                }
                let field_key = key_segments.join(".");

                let final_size = match (&element_type.size, &size_constant_status) {
                    (Size::Const(element_size), ConstantStatus::Constant) => {
                        // Try to evaluate the constant expression
                        if let Some(array_count) =
                            self.evaluate_constant_expression(&array_type.size)
                        {
                            Size::Const(element_size * array_count)
                        } else {
                            // Couldn't evaluate but it's supposed to be constant
                            let mut field_refs = HashMap::new();
                            let mut inner_refs = HashMap::new();
                            inner_refs.insert(
                                "array_size".to_string(),
                                PrimitiveType::Integral(IntegralType::U64),
                            );
                            field_refs.insert(field_key.clone(), inner_refs);
                            dynamic_sources = field_refs.clone();
                            Size::Variable(field_refs)
                        }
                    }
                    (Size::Const(_), ConstantStatus::NonConstant(size_field_refs)) => {
                        // Array size is non-constant due to field references
                        // Create a hashmap with the array's field references
                        let mut field_refs = HashMap::new();
                        field_refs.insert(field_key.clone(), size_field_refs.clone());
                        dynamic_sources = field_refs.clone();
                        Size::Variable(field_refs)
                    }
                    (Size::Variable(element_field_refs), _) => {
                        // Element type has variable size, propagate those references
                        // Also add any size expression field references
                        let mut field_refs = HashMap::new();

                        // Add element type's field references
                        for (_, inner_refs) in element_field_refs {
                            for (ref_path, prim_type) in inner_refs {
                                // Prefix with "element"
                                let full_path = format!("element.{}", ref_path);
                                field_refs
                                    .entry(field_key.clone())
                                    .or_insert_with(HashMap::new)
                                    .insert(full_path, prim_type.clone());
                            }
                        }

                        // Add size expression's field references if any
                        if let ConstantStatus::NonConstant(ref size_field_refs) =
                            size_constant_status
                        {
                            for (path, prim_type) in size_field_refs {
                                field_refs
                                    .entry(field_key.clone())
                                    .or_insert_with(HashMap::new)
                                    .insert(path.clone(), prim_type.clone());
                            }
                        }

                        dynamic_sources = field_refs.clone();
                        Size::Variable(field_refs)
                    }
                };
                let dynamic_params = normalize_field_refs(&dynamic_sources);

                Ok(ResolvedType {
                    name: type_name,
                    size: final_size,
                    alignment: element_type.alignment,
                    comment: array_type.container_attributes.comment.clone(),
                    dynamic_params,
                    kind: ResolvedTypeKind::Array {
                        element_type,
                        size_expression: array_type.size.clone(),
                        size_constant_status,
                        jagged: array_type.jagged,
                    },
                })
            }

            TypeKind::SizeDiscriminatedUnion(size_disc_union) => {
                let mut variants = Vec::new();
                let mut max_alignment = 1u64;
                let mut expected_sizes = HashSet::new();

                for variant in &size_disc_union.variants {
                    // Check if variant is a TypeRef pointing to a non-constant sized type
                    if let TypeKind::TypeRef(type_ref) = &variant.variant_type {
                        if let Some(target_type) = self.types.get(&type_ref.name) {
                            if let Size::Variable(_) = target_type.size {
                                return Err(ResolutionError::NonConstantTypeReference(format!(
                                    "Size-discriminated union '{}' variant '{}' references type '{}' which has non-constant size",
                                    type_name, variant.name, type_ref.name
                                )));
                            }
                        }
                    }

                    let variant_type = self.resolve_type_kind(
                        &variant.variant_type,
                        format!("{}::{}", type_name, variant.name),
                        context_stack,
                        field_order,
                    )?;
                    max_alignment = max_alignment.max(variant_type.alignment);

                    // CRITICAL: All variants must have constant sizes for size-discriminated unions
                    match &variant_type.size {
                        Size::Const(actual_size) => {
                            // Verify that the expected_size matches the actual size
                            if *actual_size != variant.expected_size {
                                return Err(ResolutionError::InvalidTypeDefinition(format!(
                                    "Size-discriminated union '{}' variant '{}' has expected_size {} but actual size is {}",
                                    type_name, variant.name, variant.expected_size, actual_size
                                )));
                            }

                            // Check for duplicate expected sizes
                            if !expected_sizes.insert(variant.expected_size) {
                                return Err(ResolutionError::InvalidTypeDefinition(format!(
                                    "Size-discriminated union '{}' has multiple variants with the same expected size ({}). All variants must have different sizes.",
                                    type_name, variant.expected_size
                                )));
                            }
                        }
                        Size::Variable(_) => {
                            return Err(ResolutionError::InvalidTypeDefinition(format!(
                                "Size-discriminated union '{}' variant '{}' has variable size. All variants must have constant sizes.",
                                type_name, variant.name
                            )));
                        }
                    }

                    variants.push(ResolvedSizeDiscriminatedVariant {
                        name: variant.name.clone(),
                        expected_size: variant.expected_size,
                        variant_type,
                    });
                }

                // Size-discriminated unions have variable runtime size since it depends on which variant is active
                // But all variants themselves have constant sizes
                Ok(ResolvedType {
                    name: type_name,
                    size: Size::Variable(HashMap::new()), // Variable runtime size, but no field references since all variants are constant-size
                    alignment: max_alignment,
                    comment: size_disc_union.container_attributes.comment.clone(),
                    dynamic_params: BTreeMap::new(),
                    kind: ResolvedTypeKind::SizeDiscriminatedUnion { variants },
                })
            }
        }
    }

    pub fn analyze_expression_constantness(
        &self,
        expr: &ExprKind,
        parent_context: Option<&ResolvedType>,
    ) -> Result<ConstantStatus, ResolutionError> {
        let mut stack = ContextStack::new();
        if let Some(ctx) = parent_context {
            stack.push(ctx as *const ResolvedType);
        }
        self.analyze_expression_constantness_with_order(expr, &stack, None)
    }

    fn analyze_expression_constantness_with_order(
        &self,
        expr: &ExprKind,
        context_stack: &ContextStack,
        field_order: Option<&FieldOrderTracker>,
    ) -> Result<ConstantStatus, ResolutionError> {
        if expr.is_constant() {
            Ok(ConstantStatus::Constant)
        } else {
            // Collect field references that make this non-constant
            let mut field_refs = HashMap::new();
            self.collect_field_references_with_context(
                expr,
                &mut field_refs,
                context_stack,
                field_order,
            )?;
            Ok(ConstantStatus::NonConstant(field_refs))
        }
    }

    fn collect_field_references_with_context(
        &self,
        expr: &ExprKind,
        field_refs: &mut HashMap<String, PrimitiveType>,
        context_stack: &ContextStack,
        field_order: Option<&FieldOrderTracker>,
    ) -> Result<(), ResolutionError> {
        match expr {
            ExprKind::FieldRef(field_ref) => {
                let path_str = field_ref.path.join(".");
                if let Some(order) = field_order {
                    order.validate_reference(&path_str)?;
                }

                if context_stack.is_empty() {
                    field_refs.insert(path_str, PrimitiveType::Integral(IntegralType::U64));
                    return Ok(());
                }

                if let Some(field_type) =
                    self.resolve_field_type_from_path(&field_ref.path, context_stack)
                {
                    match &field_type.kind {
                        ResolvedTypeKind::Primitive { prim_type } => {
                            field_refs.insert(path_str, prim_type.clone());
                        }
                        ResolvedTypeKind::TypeRef { target_name, .. } => {
                            if let Some(target) = self.types.get(target_name) {
                                if let ResolvedTypeKind::Primitive { prim_type } = &target.kind {
                                    field_refs.insert(path_str, prim_type.clone());
                                } else {
                                    return Err(ResolutionError::FieldReferenceNotPrimitive(
                                        path_str,
                                    ));
                                }
                            } else {
                                return Err(ResolutionError::FieldReferenceNotFound(path_str));
                            }
                        }
                        _ => {
                            return Err(ResolutionError::FieldReferenceNotPrimitive(path_str));
                        }
                    }
                } else {
                    return Err(ResolutionError::FieldReferenceNotFound(path_str));
                }
            }

            // Binary operations
            ExprKind::Add(e) => {
                self.collect_field_references_with_context(
                    &e.left,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
                self.collect_field_references_with_context(
                    &e.right,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
            }
            ExprKind::Sub(e) => {
                self.collect_field_references_with_context(
                    &e.left,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
                self.collect_field_references_with_context(
                    &e.right,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
            }
            ExprKind::Mul(e) => {
                self.collect_field_references_with_context(
                    &e.left,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
                self.collect_field_references_with_context(
                    &e.right,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
            }
            ExprKind::Div(e) => {
                self.collect_field_references_with_context(
                    &e.left,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
                self.collect_field_references_with_context(
                    &e.right,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
            }
            ExprKind::Mod(e) => {
                self.collect_field_references_with_context(
                    &e.left,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
                self.collect_field_references_with_context(
                    &e.right,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
            }
            ExprKind::Pow(e) => {
                self.collect_field_references_with_context(
                    &e.left,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
                self.collect_field_references_with_context(
                    &e.right,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
            }

            // Bitwise operations
            ExprKind::BitAnd(e) => {
                self.collect_field_references_with_context(
                    &e.left,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
                self.collect_field_references_with_context(
                    &e.right,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
            }
            ExprKind::BitOr(e) => {
                self.collect_field_references_with_context(
                    &e.left,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
                self.collect_field_references_with_context(
                    &e.right,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
            }
            ExprKind::BitXor(e) => {
                self.collect_field_references_with_context(
                    &e.left,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
                self.collect_field_references_with_context(
                    &e.right,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
            }
            ExprKind::LeftShift(e) => {
                self.collect_field_references_with_context(
                    &e.left,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
                self.collect_field_references_with_context(
                    &e.right,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
            }
            ExprKind::RightShift(e) => {
                self.collect_field_references_with_context(
                    &e.left,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
                self.collect_field_references_with_context(
                    &e.right,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
            }

            // Comparison operations
            ExprKind::Eq(e) => {
                self.collect_field_references_with_context(
                    &e.left,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
                self.collect_field_references_with_context(
                    &e.right,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
            }
            ExprKind::Ne(e) => {
                self.collect_field_references_with_context(
                    &e.left,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
                self.collect_field_references_with_context(
                    &e.right,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
            }
            ExprKind::Lt(e) => {
                self.collect_field_references_with_context(
                    &e.left,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
                self.collect_field_references_with_context(
                    &e.right,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
            }
            ExprKind::Gt(e) => {
                self.collect_field_references_with_context(
                    &e.left,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
                self.collect_field_references_with_context(
                    &e.right,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
            }
            ExprKind::Le(e) => {
                self.collect_field_references_with_context(
                    &e.left,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
                self.collect_field_references_with_context(
                    &e.right,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
            }
            ExprKind::Ge(e) => {
                self.collect_field_references_with_context(
                    &e.left,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
                self.collect_field_references_with_context(
                    &e.right,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
            }

            // Logical operations
            ExprKind::And(e) => {
                self.collect_field_references_with_context(
                    &e.left,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
                self.collect_field_references_with_context(
                    &e.right,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
            }
            ExprKind::Or(e) => {
                self.collect_field_references_with_context(
                    &e.left,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
                self.collect_field_references_with_context(
                    &e.right,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
            }
            ExprKind::Xor(e) => {
                self.collect_field_references_with_context(
                    &e.left,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
                self.collect_field_references_with_context(
                    &e.right,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
            }

            // Unary operations
            ExprKind::BitNot(e) => {
                self.collect_field_references_with_context(
                    &e.operand,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
            }
            ExprKind::Neg(e) => {
                self.collect_field_references_with_context(
                    &e.operand,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
            }
            ExprKind::Not(e) => {
                self.collect_field_references_with_context(
                    &e.operand,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
            }
            ExprKind::Popcount(e) => {
                self.collect_field_references_with_context(
                    &e.operand,
                    field_refs,
                    context_stack,
                    field_order,
                )?;
            }

            // These don't contain field references
            ExprKind::Literal(_) | ExprKind::Sizeof(_) | ExprKind::Alignof(_) => {}
        }
        Ok(())
    }

    // Helper method to resolve field type from a path
    fn resolve_field_type_from_path(
        &self,
        path: &[String],
        context_stack: &ContextStack,
    ) -> Option<ResolvedType> {
        if path.is_empty() || context_stack.is_empty() {
            return None;
        }

        let mut scope_index = context_stack.len();
        while scope_index > 0 {
            scope_index -= 1;
            if let Some(resolved) = self.resolve_path_from_scope(path, context_stack, scope_index) {
                return Some(resolved);
            }
        }

        None
    }

    fn resolve_path_from_scope(
        &self,
        path: &[String],
        context_stack: &ContextStack,
        mut scope_index: usize,
    ) -> Option<ResolvedType> {
        let mut current_type = unsafe { &*context_stack[scope_index] }.clone();
        let mut idx = 0;

        while idx < path.len() {
            let segment = &path[idx];

            if segment == ".." {
                if scope_index == 0 {
                    return None;
                }
                scope_index -= 1;
                current_type = unsafe { &*context_stack[scope_index] }.clone();
                idx += 1;
                continue;
            }

            match &current_type.kind {
                ResolvedTypeKind::Struct { fields, .. } => {
                    let field_name = segment.trim_start_matches("../");
                    if let Some(field) = fields.iter().find(|f| f.name == field_name) {
                        current_type = field.field_type.clone();
                        idx += 1;
                    } else {
                        return None;
                    }
                }
                ResolvedTypeKind::Array {
                    element_type,
                    size_expression,
                    size_constant_status,
                    ..
                } => {
                    let index = match segment.parse::<usize>() {
                        Ok(idx) => idx,
                        Err(_) => return None,
                    };

                    match size_constant_status {
                        ConstantStatus::Constant => {
                            let Some(count) = self.evaluate_constant_expression(size_expression)
                            else {
                                return None;
                            };
                            if index >= count as usize {
                                return None;
                            }
                        }
                        _ => {
                            // Require constant-length arrays for indexed field references
                            return None;
                        }
                    }

                    current_type = element_type.as_ref().clone();
                    idx += 1;
                }
                ResolvedTypeKind::TypeRef { target_name, .. } => {
                    if let Some(target_type) = self.types.get(target_name) {
                        current_type = target_type.clone();
                        continue;
                    } else {
                        return None;
                    }
                }
                _ => {
                    return None;
                }
            }
        }

        Some(current_type)
    }

    fn get_primitive_info(&self, prim: &PrimitiveType) -> (u64, u64) {
        match prim {
            PrimitiveType::Integral(int_type) => match int_type {
                IntegralType::U8 | IntegralType::I8 => (1, 1),
                IntegralType::U16 | IntegralType::I16 => (2, 2),
                IntegralType::U32 | IntegralType::I32 => (4, 4),
                IntegralType::U64 | IntegralType::I64 => (8, 8),
            },
            PrimitiveType::FloatingPoint(float_type) => match float_type {
                FloatingPointType::F16 => (2, 2),
                FloatingPointType::F32 => (4, 4),
                FloatingPointType::F64 => (8, 8),
            },
        }
    }

    // pub fn collect_field_references_from_expr(&self, expr: &ExprKind) -> Vec<String> {
    //     let mut refs = Vec::new();
    //     self.collect_field_references(expr, &mut refs);
    //     refs
    // }

    // fn collect_field_references(&self, expr: &ExprKind, refs: &mut Vec<String>) {
    //     match expr {
    //         ExprKind::FieldRef(field_ref) => {
    //             refs.push(field_ref.path.join("."));
    //         }
    //         ExprKind::Add(e) => {
    //             self.collect_field_references(&e.left, refs);
    //             self.collect_field_references(&e.right, refs);
    //         }
    //         ExprKind::Sub(e) => {
    //             self.collect_field_references(&e.left, refs);
    //             self.collect_field_references(&e.right, refs);
    //         }
    //         ExprKind::Mul(e) => {
    //             self.collect_field_references(&e.left, refs);
    //             self.collect_field_references(&e.right, refs);
    //         }
    //         ExprKind::Div(e) => {
    //             self.collect_field_references(&e.left, refs);
    //             self.collect_field_references(&e.right, refs);
    //         }
    //         ExprKind::Mod(e) => {
    //             self.collect_field_references(&e.left, refs);
    //             self.collect_field_references(&e.right, refs);
    //         }
    //         ExprKind::Pow(e) => {
    //             self.collect_field_references(&e.left, refs);
    //             self.collect_field_references(&e.right, refs);
    //         }
    //         ExprKind::BitAnd(e) => {
    //             self.collect_field_references(&e.left, refs);
    //             self.collect_field_references(&e.right, refs);
    //         }
    //         ExprKind::BitOr(e) => {
    //             self.collect_field_references(&e.left, refs);
    //             self.collect_field_references(&e.right, refs);
    //         }
    //         ExprKind::BitXor(e) => {
    //             self.collect_field_references(&e.left, refs);
    //             self.collect_field_references(&e.right, refs);
    //         }
    //         ExprKind::LeftShift(e) => {
    //             self.collect_field_references(&e.left, refs);
    //             self.collect_field_references(&e.right, refs);
    //         }
    //         ExprKind::RightShift(e) => {
    //             self.collect_field_references(&e.left, refs);
    //             self.collect_field_references(&e.right, refs);
    //         }
    //         ExprKind::Eq(e) => {
    //             self.collect_field_references(&e.left, refs);
    //             self.collect_field_references(&e.right, refs);
    //         }
    //         ExprKind::Ne(e) => {
    //             self.collect_field_references(&e.left, refs);
    //             self.collect_field_references(&e.right, refs);
    //         }
    //         ExprKind::Lt(e) => {
    //             self.collect_field_references(&e.left, refs);
    //             self.collect_field_references(&e.right, refs);
    //         }
    //         ExprKind::Gt(e) => {
    //             self.collect_field_references(&e.left, refs);
    //             self.collect_field_references(&e.right, refs);
    //         }
    //         ExprKind::Le(e) => {
    //             self.collect_field_references(&e.left, refs);
    //             self.collect_field_references(&e.right, refs);
    //         }
    //         ExprKind::Ge(e) => {
    //             self.collect_field_references(&e.left, refs);
    //             self.collect_field_references(&e.right, refs);
    //         }
    //         ExprKind::And(e) => {
    //             self.collect_field_references(&e.left, refs);
    //             self.collect_field_references(&e.right, refs);
    //         }
    //         ExprKind::Or(e) => {
    //             self.collect_field_references(&e.left, refs);
    //             self.collect_field_references(&e.right, refs);
    //         }
    //         ExprKind::Xor(e) => {
    //             self.collect_field_references(&e.left, refs);
    //             self.collect_field_references(&e.right, refs);
    //         }
    //         ExprKind::BitNot(e) => {
    //             self.collect_field_references(&e.operand, refs);
    //         }
    //         ExprKind::Neg(e) => {
    //             self.collect_field_references(&e.operand, refs);
    //         }
    //         ExprKind::Not(e) => {
    //             self.collect_field_references(&e.operand, refs);
    //         }
    //         ExprKind::Popcount(e) => {
    //             self.collect_field_references(&e.operand, refs);
    //         }
    //         ExprKind::Literal(_)
    //         | ExprKind::Sizeof(_)
    //         | ExprKind::Alignof(_) => {}
    //     }
    // }

    pub fn get_non_constant_dependencies(&self, type_name: &str) -> Vec<String> {
        if let Some(resolved) = self.types.get(type_name) {
            if let Size::Variable(variable_refs) = &resolved.size {
                let mut deps = std::collections::BTreeSet::new();
                for inner_refs in variable_refs.values() {
                    for path in inner_refs.keys() {
                        deps.insert(path.clone());
                    }
                }
                return deps.into_iter().collect();
            }
        }
        Vec::new()
    }

    pub fn get_type_info(&self, type_name: &str) -> Option<&ResolvedType> {
        self.types.get(type_name)
    }

    pub fn has_variable_runtime_size(&self, type_name: &str) -> bool {
        if let Some(resolved_type) = self.types.get(type_name) {
            self.type_has_variable_runtime_size(resolved_type)
        } else {
            false
        }
    }

    fn type_has_variable_runtime_size(&self, resolved_type: &ResolvedType) -> bool {
        match &resolved_type.kind {
            ResolvedTypeKind::Enum { .. } => {
                // Enums (tagged unions) have constant size - the max of all variants
                // The runtime variability is about which variant is active, not the total size
                false
            }
            ResolvedTypeKind::Struct { fields, .. } => {
                // Struct has variable runtime size if any field does
                for field in fields {
                    if self.type_has_variable_runtime_size(&field.field_type) {
                        return true;
                    }
                }
                false
            }
            ResolvedTypeKind::TypeRef { target_name, .. } => {
                // TypeRef has variable runtime size if target does
                if let Some(target_type) = self.types.get(target_name) {
                    self.type_has_variable_runtime_size(target_type)
                } else {
                    false
                }
            }
            ResolvedTypeKind::SizeDiscriminatedUnion { .. } => {
                // Size-discriminated unions have variable runtime size
                true
            }
            _ => false,
        }
    }

    pub fn evaluate_constant_expression(&self, expr: &ExprKind) -> Option<u64> {
        match expr {
            ExprKind::Literal(lit) => match lit {
                LiteralExpr::U64(val) => Some(*val),
                LiteralExpr::U32(val) => Some(*val as u64),
                LiteralExpr::U16(val) => Some(*val as u64),
                LiteralExpr::U8(val) => Some(*val as u64),
                LiteralExpr::I64(val) => {
                    if *val >= 0 {
                        Some(*val as u64)
                    } else {
                        None
                    }
                }
                LiteralExpr::I32(val) => {
                    if *val >= 0 {
                        Some(*val as u64)
                    } else {
                        None
                    }
                }
                LiteralExpr::I16(val) => {
                    if *val >= 0 {
                        Some(*val as u64)
                    } else {
                        None
                    }
                }
                LiteralExpr::I8(val) => {
                    if *val >= 0 {
                        Some(*val as u64)
                    } else {
                        None
                    }
                }
            },
            ExprKind::Sizeof(sizeof_expr) => {
                // Look up the size of the referenced type
                self.types
                    .get(&sizeof_expr.type_name)
                    .and_then(|t| match &t.size {
                        Size::Const(size) => Some(*size),
                        Size::Variable(_) => None,
                    })
            }
            ExprKind::Alignof(alignof_expr) => {
                // Look up the alignment of the referenced type
                self.types.get(&alignof_expr.type_name).map(|t| t.alignment)
            }
            ExprKind::Add(expr) => {
                let left = self.evaluate_constant_expression(&expr.left)?;
                let right = self.evaluate_constant_expression(&expr.right)?;
                Some(left + right)
            }
            ExprKind::Sub(expr) => {
                let left = self.evaluate_constant_expression(&expr.left)?;
                let right = self.evaluate_constant_expression(&expr.right)?;
                left.checked_sub(right)
            }
            ExprKind::Mul(expr) => {
                let left = self.evaluate_constant_expression(&expr.left)?;
                let right = self.evaluate_constant_expression(&expr.right)?;
                Some(left * right)
            }
            ExprKind::Div(expr) => {
                let left = self.evaluate_constant_expression(&expr.left)?;
                let right = self.evaluate_constant_expression(&expr.right)?;
                if right == 0 { None } else { Some(left / right) }
            }
            ExprKind::Mod(expr) => {
                let left = self.evaluate_constant_expression(&expr.left)?;
                let right = self.evaluate_constant_expression(&expr.right)?;
                if right == 0 { None } else { Some(left % right) }
            }
            ExprKind::Pow(expr) => {
                let left = self.evaluate_constant_expression(&expr.left)?;
                let right = self.evaluate_constant_expression(&expr.right)?;
                // Simple power implementation for small exponents
                if right > 64 {
                    None
                } else {
                    left.checked_pow(right as u32)
                }
            }
            ExprKind::LeftShift(expr) => {
                let left = self.evaluate_constant_expression(&expr.left)?;
                let right = self.evaluate_constant_expression(&expr.right)?;
                // Prevent overflow - limit shift to reasonable amounts
                if right > 63 {
                    None
                } else {
                    left.checked_shl(right as u32)
                }
            }
            ExprKind::RightShift(expr) => {
                let left = self.evaluate_constant_expression(&expr.left)?;
                let right = self.evaluate_constant_expression(&expr.right)?;
                // Prevent overflow - limit shift to reasonable amounts
                if right > 63 {
                    None
                } else {
                    Some(left >> right)
                }
            }
            ExprKind::Popcount(expr) => {
                let operand = self.evaluate_constant_expression(&expr.operand)?;
                Some(operand.count_ones() as u64)
            }
            // For other operations, we could implement them, but arrays typically use simple literals
            // or arithmetic operations, so this should cover most cases
            _ => None,
        }
    }
}

fn align_up(value: u64, alignment: u64) -> u64 {
    (value + alignment - 1) & !(alignment - 1)
}

fn normalize_field_refs(
    map: &HashMap<String, HashMap<String, PrimitiveType>>,
) -> BTreeMap<String, BTreeMap<String, PrimitiveType>> {
    let mut outer = BTreeMap::new();
    for (key, inner) in map {
        let mut inner_tree = BTreeMap::new();
        for (inner_key, prim) in inner {
            inner_tree.insert(inner_key.clone(), prim.clone());
        }
        outer.insert(key.clone(), inner_tree);
    }
    outer
}

fn insert_struct_refs(
    field_name: &str,
    raw_refs: &HashMap<String, PrimitiveType>,
    struct_fields: &HashSet<String>,
    out: &mut FieldRefMap,
) {
    for (ref_path, prim_type) in raw_refs {
        let full_path = qualify_struct_path(field_name, ref_path, struct_fields);
        insert_owner_ref(field_name, &full_path, prim_type, out);
    }
}

fn qualify_struct_path(
    field_name: &str,
    ref_path: &str,
    struct_fields: &HashSet<String>,
) -> String {
    let should_prefix = if ref_path.is_empty() {
        true
    } else {
        let mut segments = ref_path.split('.');
        let first_segment = segments.next().unwrap_or_default();

        if first_segment == ".." {
            false
        } else if first_segment == field_name {
            false
        } else if struct_fields.contains(first_segment) && first_segment != field_name {
            false
        } else {
            true
        }
    };

    if should_prefix {
        if ref_path.is_empty() {
            field_name.to_string()
        } else {
            format!("{}.{}", field_name, ref_path)
        }
    } else {
        ref_path.to_string()
    }
}

fn insert_variant_refs(
    owner: &str,
    raw_refs: &HashMap<String, PrimitiveType>,
    out: &mut FieldRefMap,
) {
    for (ref_path, prim_type) in raw_refs {
        let full_path = if ref_path.is_empty() {
            owner.to_string()
        } else {
            format!("{}.{}", owner, ref_path)
        };
        insert_owner_ref(owner, &full_path, prim_type, out);
    }
}

fn insert_owner_ref(
    owner: &str,
    full_path: &str,
    prim_type: &PrimitiveType,
    out: &mut FieldRefMap,
) {
    let entry = out.entry(owner.to_string()).or_insert_with(HashMap::new);
    entry
        .entry(full_path.to_string())
        .or_insert_with(|| prim_type.clone());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::abi::expr::*;
    use crate::abi::types::*;
    use std::collections::HashSet;

    #[test]
    fn test_primitive_resolution() {
        let mut resolver = TypeResolver::new();

        let typedef = TypeDef {
            name: "test_type".to_string(),
            kind: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32)),
        };

        resolver.add_typedef(typedef);
        resolver.resolve_all().unwrap();

        let resolved = resolver.types.get("test_type").unwrap();
        assert_eq!(resolved.size, Size::Const(4));
        assert_eq!(resolved.alignment, 4);
    }

    #[test]
    fn test_constant_analysis() {
        let resolver = TypeResolver::new();

        // Constant expression
        let const_expr = ExprKind::Literal(LiteralExpr::U32(42));
        let status = resolver
            .analyze_expression_constantness(&const_expr, None)
            .unwrap();
        assert!(matches!(status, ConstantStatus::Constant));

        // Non-constant expression with field reference (without parent context, won't validate)
        let non_const_expr = ExprKind::FieldRef(FieldRefExpr {
            path: vec!["field_name".to_string()],
        });
        let status = resolver
            .analyze_expression_constantness(&non_const_expr, None)
            .unwrap();
        assert!(matches!(status, ConstantStatus::NonConstant(_)));

        // With parent context, it should validate the field exists and is primitive
        // This would require a more complex test setup with actual resolved types
    }

    #[test]
    fn struct_ref_helpers_prefix_and_dedup() {
        let mut out: FieldRefMap = HashMap::new();
        let mut struct_fields = HashSet::new();
        struct_fields.insert("count".to_string());

        let mut raw_refs = HashMap::new();
        raw_refs.insert("".to_string(), PrimitiveType::Integral(IntegralType::U32));
        raw_refs.insert(
            "sibling.value".to_string(),
            PrimitiveType::Integral(IntegralType::U64),
        );
        raw_refs.insert(
            "count.inner".to_string(),
            PrimitiveType::Integral(IntegralType::U16),
        );

        insert_struct_refs("data", &raw_refs, &struct_fields, &mut out);
        insert_struct_refs("data", &raw_refs, &struct_fields, &mut out); // dedup

        let entry = out.get("data").expect("data entry");
        assert_eq!(entry.len(), 3);
        assert!(entry.contains_key("data"));
        assert!(entry.contains_key("data.sibling.value"));
        assert!(entry.contains_key("count.inner"));
    }

    #[test]
    fn variant_ref_helpers_prefix_owner() {
        let mut out: FieldRefMap = HashMap::new();
        let mut raw_refs = HashMap::new();
        raw_refs.insert("".to_string(), PrimitiveType::Integral(IntegralType::U8));
        raw_refs.insert(
            "child.len".to_string(),
            PrimitiveType::Integral(IntegralType::U16),
        );

        insert_variant_refs("variant", &raw_refs, &mut out);
        insert_variant_refs("variant", &raw_refs, &mut out);

        let entry = out.get("variant").expect("variant entry");
        assert_eq!(entry.len(), 2);
        assert!(entry.contains_key("variant"));
        assert!(entry.contains_key("variant.child.len"));
    }

    #[test]
    fn struct_field_forward_reference_error() {
        let mut resolver = TypeResolver::new();

        let typedef = TypeDef {
            name: "ForwardRef".to_string(),
            kind: TypeKind::Struct(StructType {
                container_attributes: Default::default(),
                fields: vec![
                    StructField {
                        name: "data".to_string(),
                        field_type: TypeKind::Array(ArrayType {
                            container_attributes: Default::default(),
                            size: ExprKind::FieldRef(FieldRefExpr {
                                path: vec!["len".to_string()],
                            }),
                            element_type: Box::new(TypeKind::Primitive(PrimitiveType::Integral(
                                IntegralType::U8,
                            ))),
                            jagged: false,
                        }),
                    },
                    StructField {
                        name: "len".to_string(),
                        field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U16)),
                    },
                ],
            }),
        };

        resolver.add_typedef(typedef);
        let err = resolver.resolve_all().unwrap_err();
        match err {
            ResolutionError::ForwardFieldReference {
                type_name,
                field_name,
                referenced_field,
            } => {
                assert_eq!(type_name, "ForwardRef");
                assert_eq!(field_name, "data");
                assert_eq!(referenced_field, "len");
            }
            other => panic!("unexpected error: {:?}", other),
        }
    }

    #[test]
    fn parent_field_reference_allowed() {
        let mut resolver = TypeResolver::new();

        let typedef = TypeDef {
            name: "ParentStruct".to_string(),
            kind: TypeKind::Struct(StructType {
                container_attributes: Default::default(),
                fields: vec![
                    StructField {
                        name: "count".to_string(),
                        field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32)),
                    },
                    StructField {
                        name: "child".to_string(),
                        field_type: TypeKind::Struct(StructType {
                            container_attributes: Default::default(),
                            fields: vec![
                                StructField {
                                    name: "value".to_string(),
                                    field_type: TypeKind::Primitive(PrimitiveType::Integral(
                                        IntegralType::U8,
                                    )),
                                },
                                StructField {
                                    name: "payload".to_string(),
                                    field_type: TypeKind::Array(ArrayType {
                                        container_attributes: Default::default(),
                                        size: ExprKind::FieldRef(FieldRefExpr {
                                            path: vec!["..".to_string(), "count".to_string()],
                                        }),
                                        element_type: Box::new(TypeKind::Primitive(
                                            PrimitiveType::Integral(IntegralType::U8),
                                        )),
                                        jagged: false,
                                    }),
                                },
                            ],
                        }),
                    },
                ],
            }),
        };

        resolver.add_typedef(typedef);
        resolver
            .resolve_all()
            .expect("parent references should be allowed");
    }

    #[test]
    fn enum_tag_forward_reference_error() {
        let mut resolver = TypeResolver::new();

        let enum_type = TypeKind::Enum(EnumType {
            container_attributes: Default::default(),
            tag_ref: ExprKind::Add(AddExpr {
                left: Box::new(ExprKind::Literal(LiteralExpr::U8(1))),
                right: Box::new(ExprKind::FieldRef(FieldRefExpr {
                    path: vec!["tag_value".to_string()],
                })),
            }),
            variants: vec![EnumVariant {
                name: "Only".to_string(),
                tag_value: 0,
                variant_type: TypeKind::Struct(StructType {
                    container_attributes: Default::default(),
                    fields: vec![],
                }),
            }],
        });

        let typedef = TypeDef {
            name: "EnumStruct".to_string(),
            kind: TypeKind::Struct(StructType {
                container_attributes: Default::default(),
                fields: vec![
                    StructField {
                        name: "payload".to_string(),
                        field_type: enum_type,
                    },
                    StructField {
                        name: "tag_value".to_string(),
                        field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U8)),
                    },
                ],
            }),
        };

        resolver.add_typedef(typedef);
        let err = resolver.resolve_all().unwrap_err();
        match err {
            ResolutionError::ForwardFieldReference {
                type_name,
                field_name,
                referenced_field,
            } => {
                assert_eq!(type_name, "EnumStruct");
                assert_eq!(field_name, "payload");
                assert_eq!(referenced_field, "tag_value");
            }
            other => panic!("unexpected error: {:?}", other),
        }
    }

    #[test]
    fn enum_tag_computed_previous_field_allowed() {
        let mut resolver = TypeResolver::new();

        let enum_type = TypeKind::Enum(EnumType {
            container_attributes: Default::default(),
            tag_ref: ExprKind::BitAnd(BitAndExpr {
                left: Box::new(ExprKind::FieldRef(FieldRefExpr {
                    path: vec!["tag_bits".to_string()],
                })),
                right: Box::new(ExprKind::Literal(LiteralExpr::U8(3))),
            }),
            variants: vec![EnumVariant {
                name: "Only".to_string(),
                tag_value: 0,
                variant_type: TypeKind::Struct(StructType {
                    container_attributes: Default::default(),
                    fields: vec![],
                }),
            }],
        });

        let typedef = TypeDef {
            name: "EnumStructOk".to_string(),
            kind: TypeKind::Struct(StructType {
                container_attributes: Default::default(),
                fields: vec![
                    StructField {
                        name: "tag_bits".to_string(),
                        field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U8)),
                    },
                    StructField {
                        name: "payload".to_string(),
                        field_type: enum_type,
                    },
                ],
            }),
        };

        resolver.add_typedef(typedef);
        resolver.resolve_all().expect("computed tags allowed");
    }

    #[test]
    fn typeref_allows_variable_size_types() {
        let mut resolver = TypeResolver::new();

        resolver.add_typedef(TypeDef {
            name: "DynStruct".to_string(),
            kind: TypeKind::Struct(StructType {
                container_attributes: Default::default(),
                fields: vec![
                    StructField {
                        name: "length".to_string(),
                        field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U8)),
                    },
                    StructField {
                        name: "bytes".to_string(),
                        field_type: TypeKind::Array(ArrayType {
                            container_attributes: Default::default(),
                            size: ExprKind::FieldRef(FieldRefExpr {
                                path: vec!["length".to_string()],
                            }),
                            element_type: Box::new(TypeKind::Primitive(PrimitiveType::Integral(
                                IntegralType::U8,
                            ))),
                            jagged: false,
                        }),
                    },
                ],
            }),
        });

        resolver.add_typedef(TypeDef {
            name: "DynAlias".to_string(),
            kind: TypeKind::TypeRef(TypeRefType {
                name: "DynStruct".to_string(),
                comment: None,
            }),
        });

        resolver.resolve_all().expect("typeref should resolve");

        let alias = resolver
            .get_type_info("DynAlias")
            .expect("alias should exist");
        assert!(
            matches!(alias.size, Size::Variable(_)),
            "typeref alias should retain variable size"
        );
    }

    #[test]
    fn type_resolver_get_type_info_includes_dynamic_params() {
        let mut resolver = TypeResolver::new();

        let typedef = TypeDef {
            name: "DynStruct".to_string(),
            kind: TypeKind::Struct(StructType {
                container_attributes: Default::default(),
                fields: vec![
                    StructField {
                        name: "len".to_string(),
                        field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32)),
                    },
                    StructField {
                        name: "data".to_string(),
                        field_type: TypeKind::Array(ArrayType {
                            container_attributes: Default::default(),
                            size: ExprKind::FieldRef(FieldRefExpr {
                                path: vec!["len".to_string()],
                            }),
                            element_type: Box::new(TypeKind::Primitive(PrimitiveType::Integral(
                                IntegralType::U8,
                            ))),
                            jagged: false,
                        }),
                    },
                ],
            }),
        };

        resolver.add_typedef(typedef);
        resolver.resolve_all().unwrap();

        let resolved = resolver.get_type_info("DynStruct").expect("resolved type");
        assert_eq!(resolved.dynamic_params.len(), 1);

        let data_params = resolved
            .dynamic_params
            .get("data")
            .expect("dynamic params for data");
        assert_eq!(data_params.len(), 1);

        assert_eq!(
            data_params.get("len"),
            Some(&PrimitiveType::Integral(IntegralType::U32))
        );
    }
}
