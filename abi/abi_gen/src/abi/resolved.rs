use crate::abi::expr::{ConstantExpression, ExprKind};
use crate::abi::types::{FloatingPointType, IntegralType, PrimitiveType, TypeDef, TypeKind};
use std::collections::{HashMap, HashSet};

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
  pub kind: ResolvedTypeKind,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ResolvedTypeKind {
  Primitive { prim_type: PrimitiveType },
  Struct { fields: Vec<ResolvedField>, packed: bool, custom_alignment: Option<u64> },
  Union { variants: Vec<ResolvedField> },
  Enum { tag_expression: ExprKind, tag_constant_status: ConstantStatus, variants: Vec<ResolvedEnumVariant> },
  Array { element_type: Box<ResolvedType>, size_expression: ExprKind, size_constant_status: ConstantStatus },
  SizeDiscriminatedUnion { variants: Vec<ResolvedSizeDiscriminatedVariant> },
  TypeRef { target_name: String, resolved: bool },
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
}

#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedSizeDiscriminatedVariant {
  pub name: String,
  pub expected_size: u64,
  pub variant_type: ResolvedType,
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
}

impl TypeResolver {
  pub fn new() -> Self {
    Self { types: HashMap::new(), typedefs: HashMap::new(), resolution_order: Vec::new() }
  }

  pub fn add_typedef(&mut self, typedef: TypeDef) {
    self.typedefs.insert(typedef.name.clone(), typedef);
  }

  pub fn resolve_all(&mut self) -> Result<(), ResolutionError> {
    // First, collect all type names
    let type_names: Vec<String> = self.typedefs.keys().cloned().collect();

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
          return Err(ResolutionError::UnknownType(format!("Missing type definitions: {}", missing_list.join(", "))));
        }

        // Otherwise we have circular dependencies
        let unresolved: Vec<String> = type_names.iter().filter(|name| !self.types.contains_key(*name)).cloned().collect();
        return Err(ResolutionError::CircularDependency(unresolved));
      }
    }

    Ok(())
  }

  fn try_resolve_type(&self, type_name: &str) -> Result<ResolvedType, ResolutionError> {
    let typedef = self.typedefs.get(type_name).ok_or_else(|| ResolutionError::UnknownType(type_name.to_string()))?;

    self.resolve_type_kind(&typedef.kind, type_name.to_string(), None)
  }

  fn validate_type_comments(&self, type_kind: &TypeKind, type_name: &str) -> Result<(), ResolutionError> {
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
    parent_context: Option<&ResolvedType>,
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
          kind: ResolvedTypeKind::Primitive { prim_type: prim.clone() },
        })
      }

      TypeKind::TypeRef(type_ref) => {
        // Check if the referenced type is already resolved
        if self.types.contains_key(&type_ref.name) {
          // Type reference is resolved - we can copy the target type info
          let target_type = self.types.get(&type_ref.name).unwrap();

          // Check if the referenced type has constant size
          if let Size::Variable(_) = target_type.size {
            return Err(ResolutionError::NonConstantTypeReference(format!(
              "Type '{}' references '{}' which has non-constant size",
              type_name, type_ref.name
            )));
          }

          Ok(ResolvedType {
            name: type_name,
            size: target_type.size.clone(),
            alignment: target_type.alignment,
            comment: type_ref.comment.clone(), // Use TypeRef's own comment
            kind: ResolvedTypeKind::TypeRef { target_name: type_ref.name.clone(), resolved: true },
          })
        } else {
          // Type reference not yet resolved - cannot resolve this type yet
          Err(ResolutionError::UnknownType(type_ref.name.clone()))
        }
      }

      TypeKind::Struct(struct_type) => {
        let mut fields = Vec::new();
        let mut current_offset = 0u64;
        let mut max_alignment = 1u64;
        let mut all_sizes_known = true;
        let mut field_references: HashMap<String, HashMap<String, PrimitiveType>> = HashMap::new();

        // First pass: resolve types without context to build the struct
        let mut temp_resolved = ResolvedType {
          name: type_name.clone(),
          size: Size::Const(0), // Temporary value
          alignment: 1,
          comment: struct_type.container_attributes.comment.clone(),
          kind: ResolvedTypeKind::Struct {
            fields: Vec::new(),
            packed: struct_type.container_attributes.packed,
            custom_alignment: if struct_type.container_attributes.aligned > 0 { Some(struct_type.container_attributes.aligned) } else { None },
          },
        };

        let struct_field_names: HashSet<String> = struct_type.fields.iter().map(|field| field.name.clone()).collect();

        for field in &struct_type.fields {
          // For inline nested structs, pass the parent context so they can reference parent fields
          // If this IS a nested struct (parent_context.is_some()), pass that parent context
          // Otherwise, pass temp_resolved as the context for normal struct field resolution
          let ctx = parent_context.or(Some(&temp_resolved));
          let field_type = self.resolve_type_kind(&field.field_type, format!("{}::{}", type_name, field.name), ctx)?;

          // Check if field is a TypeRef pointing to a non-constant sized type
          if let TypeKind::TypeRef(type_ref) = &field.field_type {
            if let Some(target_type) = self.types.get(&type_ref.name) {
              if let Size::Variable(_) = target_type.size {
                return Err(ResolutionError::NonConstantTypeReference(format!(
                  "Struct field '{}::{}' references type '{}' which has non-constant size",
                  type_name, field.name, type_ref.name
                )));
              }
            }
          }

          let field_alignment = field_type.alignment;

          // Check if field has variable size and collect field references
          match &field_type.size {
            Size::Const(field_size) => {
              // Apply packing and alignment rules
              if !struct_type.container_attributes.packed {
                current_offset = align_up(current_offset, field_alignment);
              }

              let resolved_field = ResolvedField { name: field.name.clone(), field_type: field_type.clone(), offset: Some(current_offset) };

              fields.push(resolved_field.clone());

              // Update the temporary struct with the new field for subsequent field resolution
              if let ResolvedTypeKind::Struct { fields: temp_fields, .. } = &mut temp_resolved.kind {
                temp_fields.push(resolved_field);
              }

              current_offset += field_size;
              // For packed structs, alignment is 1 unless custom alignment is specified
              if !struct_type.container_attributes.packed {
                max_alignment = max_alignment.max(field_alignment);
              }
            }
            Size::Variable(field_refs) => {
              // Field has variable size - struct size will be variable too
              all_sizes_known = false;

              // Copy field references with field name as key, adding prefix to paths when needed
              for (_, inner_refs) in field_refs {
                for (ref_path, prim_type) in inner_refs {
                  let should_prefix = if ref_path.is_empty() {
                    true
                  } else {
                    let mut segments = ref_path.split('.');
                    let first_segment = segments.next().unwrap_or_default();

                    if first_segment == ".." {
                      false
                    } else if first_segment == field.name {
                      false
                    } else if struct_field_names.contains(first_segment) && first_segment != field.name {
                      // Reference points to a sibling (or parent) field at this level
                      false
                    } else {
                      true
                    }
                  };

                  let full_path = if should_prefix { format!("{}.{}", field.name, ref_path) } else { ref_path.clone() };
                  field_references.entry(field.name.clone()).or_insert_with(HashMap::new).insert(full_path, prim_type.clone());
                }
              }

              let resolved_field = ResolvedField { name: field.name.clone(), field_type, offset: None };

              fields.push(resolved_field.clone());

              // Update the temporary struct even for unknown-size fields
              if let ResolvedTypeKind::Struct { fields: temp_fields, .. } = &mut temp_resolved.kind {
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
          kind: ResolvedTypeKind::Struct {
            fields,
            packed: struct_type.container_attributes.packed,
            custom_alignment: if struct_type.container_attributes.aligned > 0 { Some(struct_type.container_attributes.aligned) } else { None },
          },
        })
      }

      TypeKind::Union(union_type) => {
        let mut variants = Vec::new();
        let mut max_size = 0u64;
        let mut max_alignment = 1u64;
        let mut all_sizes_known = true;
        let mut field_references: HashMap<String, HashMap<String, PrimitiveType>> = HashMap::new();

        for variant in &union_type.variants {
          // Check if variant is a TypeRef pointing to a non-constant sized type
          if let TypeKind::TypeRef(type_ref) = &variant.variant_type {
            if let Some(target_type) = self.types.get(&type_ref.name) {
              if let Size::Variable(_) = target_type.size {
                return Err(ResolutionError::NonConstantTypeReference(format!(
                  "Union '{}' variant '{}' references type '{}' which has non-constant size",
                  type_name, variant.name, type_ref.name
                )));
              }
            }
          }

          let variant_type = self.resolve_type_kind(&variant.variant_type, format!("{}::{}", type_name, variant.name), parent_context)?;
          let variant_alignment = variant_type.alignment;

          // Handle size and collect field references
          match &variant_type.size {
            Size::Const(variant_size) => {
              max_size = max_size.max(*variant_size);
            }
            Size::Variable(variant_refs) => {
              all_sizes_known = false;

              for (_, inner_refs) in variant_refs {
                for (ref_path, prim_type) in inner_refs {
                  field_references
                    .entry(variant.name.clone())
                    .or_insert_with(HashMap::new)
                    .insert(format!("{}.{}", variant.name, ref_path), prim_type.clone());
                }
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

        let final_size = if all_sizes_known { Size::Const(max_size) } else { Size::Variable(field_references) };

        Ok(ResolvedType {
          name: type_name,
          size: final_size,
          alignment: max_alignment,
          comment: union_type.container_attributes.comment.clone(),
          kind: ResolvedTypeKind::Union { variants },
        })
      }

      TypeKind::Enum(enum_type) => {
        // Analyze the tag expression for constantness
        let tag_constant_status = self.analyze_expression_constantness(&enum_type.tag_ref, parent_context)?;

        let mut variants = Vec::new();
        let mut max_variant_size = 0u64;
        let mut max_variant_alignment = 1u64;
        let mut all_sizes_known = true;
        let mut field_references: HashMap<String, HashMap<String, PrimitiveType>> = HashMap::new();

        for variant in &enum_type.variants {
          // Check if variant is a TypeRef pointing to a non-constant sized type
          if let TypeKind::TypeRef(type_ref) = &variant.variant_type {
            if let Some(target_type) = self.types.get(&type_ref.name) {
              if let Size::Variable(_) = target_type.size {
                return Err(ResolutionError::NonConstantTypeReference(format!(
                  "Enum '{}' variant '{}' references type '{}' which has non-constant size",
                  type_name, variant.name, type_ref.name
                )));
              }
            }
          }

          let variant_type = self.resolve_type_kind(&variant.variant_type, format!("{}::{}", type_name, variant.name), parent_context)?;

          // Track maximum variant size and collect field references
          match &variant_type.size {
            Size::Const(variant_size) => {
              max_variant_size = max_variant_size.max(*variant_size);
            }
            Size::Variable(variant_refs) => {
              all_sizes_known = false;

              for (_, inner_refs) in variant_refs {
                for (ref_path, prim_type) in inner_refs {
                  field_references
                    .entry(variant.name.clone())
                    .or_insert_with(HashMap::new)
                    .insert(format!("{}.{}", variant.name, ref_path), prim_type.clone());
                }
              }
            }
          }
          max_variant_alignment = max_variant_alignment.max(variant_type.alignment);

          variants.push(ResolvedEnumVariant { name: variant.name.clone(), tag_value: variant.tag_value, variant_type });
        }

        let mut enum_field_references = field_references;

        // Check if all variants have the same size
        let all_same_size = if all_sizes_known {
          let first_variant_size = variants.first().map(|v| {
            if let Size::Const(size) = v.variant_type.size { Some(size) } else { None }
          }).flatten();

          first_variant_size.map(|first_size| {
            variants.iter().all(|v| {
              if let Size::Const(size) = v.variant_type.size {
                size == first_size
              } else {
                false
              }
            })
          }).unwrap_or(false)
        } else {
          false
        };

        // Enum size calculation:
        // - If all variants have the same constant size: enum has that constant size
        // - If variants have different sizes: enum is variable-size (depends on tag value)
        // - If any variant has variable size: enum is variable-size
        let final_size = if all_sizes_known && all_same_size {
          // All variants same size - enum has constant size
          Size::Const(max_variant_size)
        } else {
          // Variable size - depends on tag value to determine which variant is active
          // Include tag expression in field references
          if let ConstantStatus::NonConstant(tag_field_refs) = &tag_constant_status {
            let entry = enum_field_references.entry(type_name.clone()).or_insert_with(HashMap::new);
            for (ref_path, prim_type) in tag_field_refs {
              entry.insert(ref_path.clone(), prim_type.clone());
            }
          } else if let ConstantStatus::Constant = &tag_constant_status {
            // Tag is constant but variants differ in size - still need tag ref for size calculation
            // Add the tag field reference from the tag expression
            let entry = enum_field_references.entry(type_name.clone()).or_insert_with(HashMap::new);
            if let ExprKind::FieldRef(field_ref) = &enum_type.tag_ref {
              // Assume tag is primitive integral type (validated elsewhere)
              // Use u8 as placeholder - actual type should be validated
              entry.insert(field_ref.path.join("."), PrimitiveType::Integral(IntegralType::U8));
            }
          }

          Size::Variable(enum_field_references)
        };

        Ok(ResolvedType {
          name: type_name,
          size: final_size,
          alignment: max_variant_alignment,
          comment: enum_type.container_attributes.comment.clone(),
          kind: ResolvedTypeKind::Enum { tag_expression: enum_type.tag_ref.clone(), tag_constant_status, variants },
        })
      }

      TypeKind::Array(array_type) => {
        // Extract the field name from type_name if it's in the format "StructName::fieldname"
        let field_key = if let Some(pos) = type_name.rfind("::") {
          type_name[pos + 2..].to_string()
        } else {
          "array".to_string() // Fallback for top-level arrays
        };

        // Check if element type is a TypeRef pointing to a non-constant sized type
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

        let element_type = Box::new(self.resolve_type_kind(&array_type.element_type, format!("{}::element", type_name), parent_context)?);
        // Analyze field references with parent context for validation
        let size_constant_status = self.analyze_expression_constantness(&array_type.size, parent_context)?;

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
        let final_size = match (&element_type.size, &size_constant_status) {
          (Size::Const(element_size), ConstantStatus::Constant) => {
            // Try to evaluate the constant expression
            if let Some(array_count) = self.evaluate_constant_expression(&array_type.size) {
              Size::Const(element_size * array_count)
            } else {
              // Couldn't evaluate but it's supposed to be constant
              let mut field_refs = HashMap::new();
              let mut inner_refs = HashMap::new();
              inner_refs.insert("array_size".to_string(), PrimitiveType::Integral(IntegralType::U64));
              field_refs.insert(field_key.clone(), inner_refs);
              Size::Variable(field_refs)
            }
          }
          (Size::Const(_), ConstantStatus::NonConstant(size_field_refs)) => {
            // Array size is non-constant due to field references
            // Create a hashmap with the array's field references
            let mut field_refs = HashMap::new();
            field_refs.insert(field_key.clone(), size_field_refs.clone());
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
                field_refs.entry(field_key.clone()).or_insert_with(HashMap::new).insert(full_path, prim_type.clone());
              }
            }

            // Add size expression's field references if any
            if let ConstantStatus::NonConstant(ref size_field_refs) = size_constant_status {
              for (path, prim_type) in size_field_refs {
                field_refs.entry(field_key.clone()).or_insert_with(HashMap::new).insert(path.clone(), prim_type.clone());
              }
            }

            Size::Variable(field_refs)
          }
        };

        Ok(ResolvedType {
          name: type_name,
          size: final_size,
          alignment: element_type.alignment,
          comment: array_type.container_attributes.comment.clone(),
          kind: ResolvedTypeKind::Array { element_type, size_expression: array_type.size.clone(), size_constant_status },
        })
      }

      TypeKind::SizeDiscriminatedUnion(size_disc_union) => {
        let mut variants = Vec::new();
        let mut max_alignment = 1u64;
        let mut field_references: HashMap<String, HashMap<String, PrimitiveType>> = HashMap::new();

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

          let variant_type = self.resolve_type_kind(&variant.variant_type, format!("{}::{}", type_name, variant.name), parent_context)?;
          max_alignment = max_alignment.max(variant_type.alignment);

          // Collect field references from variants with variable size
          if let Size::Variable(variant_refs) = &variant_type.size {
            for (_, inner_refs) in variant_refs {
              for (ref_path, prim_type) in inner_refs {
                field_references
                  .entry(variant.name.clone())
                  .or_insert_with(HashMap::new)
                  .insert(format!("{}.{}", variant.name, ref_path), prim_type.clone());
              }
            }
          }

          variants.push(ResolvedSizeDiscriminatedVariant { name: variant.name.clone(), expected_size: variant.expected_size, variant_type });
        }

        // Size-discriminated unions always have variable size since it depends on which variant is allocated
        // But we also propagate any field references from variable-sized variants
        Ok(ResolvedType {
          name: type_name,
          size: Size::Variable(field_references), // Size is determined at allocation time, plus any field refs
          alignment: max_alignment,
          comment: size_disc_union.container_attributes.comment.clone(),
          kind: ResolvedTypeKind::SizeDiscriminatedUnion { variants },
        })
      }
    }
  }

  pub fn analyze_expression_constantness(&self, expr: &ExprKind, parent_context: Option<&ResolvedType>) -> Result<ConstantStatus, ResolutionError> {
    if expr.is_constant() {
      Ok(ConstantStatus::Constant)
    } else {
      // Collect field references that make this non-constant
      let mut field_refs = HashMap::new();
      self.collect_field_references_with_context(expr, &mut field_refs, parent_context)?;
      Ok(ConstantStatus::NonConstant(field_refs))
    }
  }

  fn collect_field_references_with_context(
    &self,
    expr: &ExprKind,
    field_refs: &mut HashMap<String, PrimitiveType>,
    parent_context: Option<&ResolvedType>,
  ) -> Result<(), ResolutionError> {
    match expr {
      ExprKind::FieldRef(field_ref) => {
        let path_str = field_ref.path.join(".");

        // Try to resolve the field type if we have parent context
        if let Some(parent) = parent_context {
          if let Some(field_type) = self.resolve_field_type_from_path(&field_ref.path, parent) {
            // Check if the field type is primitive
            match &field_type.kind {
              ResolvedTypeKind::Primitive { prim_type } => {
                field_refs.insert(path_str, prim_type.clone());
              }
              ResolvedTypeKind::TypeRef { target_name, .. } => {
                // Follow type reference to check if it's primitive
                if let Some(target) = self.types.get(target_name) {
                  if let ResolvedTypeKind::Primitive { prim_type } = &target.kind {
                    field_refs.insert(path_str, prim_type.clone());
                  } else {
                    return Err(ResolutionError::FieldReferenceNotPrimitive(path_str));
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
        } else {
          // No parent context - can't validate, but still record the field reference
          // We don't know the type yet, so we'll use a placeholder
          // This happens for standalone arrays that aren't part of a struct
          // Assume it's an integral type for now (most common for array sizes)
          field_refs.insert(path_str, PrimitiveType::Integral(IntegralType::U64));
        }
      }

      // Binary operations
      ExprKind::Add(e) => {
        self.collect_field_references_with_context(&e.left, field_refs, parent_context)?;
        self.collect_field_references_with_context(&e.right, field_refs, parent_context)?;
      }
      ExprKind::Sub(e) => {
        self.collect_field_references_with_context(&e.left, field_refs, parent_context)?;
        self.collect_field_references_with_context(&e.right, field_refs, parent_context)?;
      }
      ExprKind::Mul(e) => {
        self.collect_field_references_with_context(&e.left, field_refs, parent_context)?;
        self.collect_field_references_with_context(&e.right, field_refs, parent_context)?;
      }
      ExprKind::Div(e) => {
        self.collect_field_references_with_context(&e.left, field_refs, parent_context)?;
        self.collect_field_references_with_context(&e.right, field_refs, parent_context)?;
      }
      ExprKind::Mod(e) => {
        self.collect_field_references_with_context(&e.left, field_refs, parent_context)?;
        self.collect_field_references_with_context(&e.right, field_refs, parent_context)?;
      }
      ExprKind::Pow(e) => {
        self.collect_field_references_with_context(&e.left, field_refs, parent_context)?;
        self.collect_field_references_with_context(&e.right, field_refs, parent_context)?;
      }

      // Bitwise operations
      ExprKind::BitAnd(e) => {
        self.collect_field_references_with_context(&e.left, field_refs, parent_context)?;
        self.collect_field_references_with_context(&e.right, field_refs, parent_context)?;
      }
      ExprKind::BitOr(e) => {
        self.collect_field_references_with_context(&e.left, field_refs, parent_context)?;
        self.collect_field_references_with_context(&e.right, field_refs, parent_context)?;
      }
      ExprKind::BitXor(e) => {
        self.collect_field_references_with_context(&e.left, field_refs, parent_context)?;
        self.collect_field_references_with_context(&e.right, field_refs, parent_context)?;
      }
      ExprKind::LeftShift(e) => {
        self.collect_field_references_with_context(&e.left, field_refs, parent_context)?;
        self.collect_field_references_with_context(&e.right, field_refs, parent_context)?;
      }
      ExprKind::RightShift(e) => {
        self.collect_field_references_with_context(&e.left, field_refs, parent_context)?;
        self.collect_field_references_with_context(&e.right, field_refs, parent_context)?;
      }

      // Comparison operations
      ExprKind::Eq(e) => {
        self.collect_field_references_with_context(&e.left, field_refs, parent_context)?;
        self.collect_field_references_with_context(&e.right, field_refs, parent_context)?;
      }
      ExprKind::Ne(e) => {
        self.collect_field_references_with_context(&e.left, field_refs, parent_context)?;
        self.collect_field_references_with_context(&e.right, field_refs, parent_context)?;
      }
      ExprKind::Lt(e) => {
        self.collect_field_references_with_context(&e.left, field_refs, parent_context)?;
        self.collect_field_references_with_context(&e.right, field_refs, parent_context)?;
      }
      ExprKind::Gt(e) => {
        self.collect_field_references_with_context(&e.left, field_refs, parent_context)?;
        self.collect_field_references_with_context(&e.right, field_refs, parent_context)?;
      }
      ExprKind::Le(e) => {
        self.collect_field_references_with_context(&e.left, field_refs, parent_context)?;
        self.collect_field_references_with_context(&e.right, field_refs, parent_context)?;
      }
      ExprKind::Ge(e) => {
        self.collect_field_references_with_context(&e.left, field_refs, parent_context)?;
        self.collect_field_references_with_context(&e.right, field_refs, parent_context)?;
      }

      // Logical operations
      ExprKind::And(e) => {
        self.collect_field_references_with_context(&e.left, field_refs, parent_context)?;
        self.collect_field_references_with_context(&e.right, field_refs, parent_context)?;
      }
      ExprKind::Or(e) => {
        self.collect_field_references_with_context(&e.left, field_refs, parent_context)?;
        self.collect_field_references_with_context(&e.right, field_refs, parent_context)?;
      }
      ExprKind::Xor(e) => {
        self.collect_field_references_with_context(&e.left, field_refs, parent_context)?;
        self.collect_field_references_with_context(&e.right, field_refs, parent_context)?;
      }

      // Unary operations
      ExprKind::BitNot(e) => {
        self.collect_field_references_with_context(&e.operand, field_refs, parent_context)?;
      }
      ExprKind::Neg(e) => {
        self.collect_field_references_with_context(&e.operand, field_refs, parent_context)?;
      }
      ExprKind::Not(e) => {
        self.collect_field_references_with_context(&e.operand, field_refs, parent_context)?;
      }
      ExprKind::Popcount(e) => {
        self.collect_field_references_with_context(&e.operand, field_refs, parent_context)?;
      }

      // These don't contain field references
      ExprKind::Literal(_) | ExprKind::Sizeof(_) | ExprKind::Alignof(_) => {}
    }
    Ok(())
  }

  // Helper method to resolve field type from a path
  fn resolve_field_type_from_path(&self, path: &[String], parent: &ResolvedType) -> Option<ResolvedType> {
    if path.is_empty() {
      return None;
    }

    // Handle special paths like "../tag" or "../hdr/type_slot"
    let mut current_type = parent.clone();

    for segment in path {
      if segment == ".." {
        // Go up one level - for now, just continue
        // This would need more context about the parent's parent
        continue;
      }

      // Try to find the field in the current type
      match &current_type.kind {
        ResolvedTypeKind::Struct { fields, .. } => {
          // Remove any leading "../" from the segment
          let field_name = segment.trim_start_matches("../");
          if let Some(field) = fields.iter().find(|f| f.name == field_name) {
            current_type = field.field_type.clone();
          } else {
            return None; // Field not found
          }
        }
        ResolvedTypeKind::TypeRef { target_name, .. } => {
          // Follow the type reference
          if let Some(target) = self.types.get(target_name) {
            current_type = target.clone();
            // Retry with the resolved type
            let remaining_path: Vec<String> = vec![segment.clone()];
            return self.resolve_field_type_from_path(&remaining_path, &current_type);
          } else {
            return None;
          }
        }
        _ => return None, // Can't navigate into other types
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
    if let Some(resolved_type) = self.types.get(type_name) { self.type_has_variable_runtime_size(resolved_type) } else { false }
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
        if let Some(target_type) = self.types.get(target_name) { self.type_has_variable_runtime_size(target_type) } else { false }
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
        crate::abi::expr::LiteralExpr::U64(val) => Some(*val),
        crate::abi::expr::LiteralExpr::U32(val) => Some(*val as u64),
        crate::abi::expr::LiteralExpr::U16(val) => Some(*val as u64),
        crate::abi::expr::LiteralExpr::U8(val) => Some(*val as u64),
        crate::abi::expr::LiteralExpr::I64(val) => {
          if *val >= 0 {
            Some(*val as u64)
          } else {
            None
          }
        }
        crate::abi::expr::LiteralExpr::I32(val) => {
          if *val >= 0 {
            Some(*val as u64)
          } else {
            None
          }
        }
        crate::abi::expr::LiteralExpr::I16(val) => {
          if *val >= 0 {
            Some(*val as u64)
          } else {
            None
          }
        }
        crate::abi::expr::LiteralExpr::I8(val) => {
          if *val >= 0 {
            Some(*val as u64)
          } else {
            None
          }
        }
      },
      ExprKind::Sizeof(sizeof_expr) => {
        // Look up the size of the referenced type
        self.types.get(&sizeof_expr.type_name).and_then(|t| match &t.size {
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
        if right > 64 { None } else { left.checked_pow(right as u32) }
      }
      ExprKind::LeftShift(expr) => {
        let left = self.evaluate_constant_expression(&expr.left)?;
        let right = self.evaluate_constant_expression(&expr.right)?;
        // Prevent overflow - limit shift to reasonable amounts
        if right > 63 { None } else { left.checked_shl(right as u32) }
      }
      ExprKind::RightShift(expr) => {
        let left = self.evaluate_constant_expression(&expr.left)?;
        let right = self.evaluate_constant_expression(&expr.right)?;
        // Prevent overflow - limit shift to reasonable amounts
        if right > 63 { None } else { Some(left >> right) }
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

#[cfg(test)]
mod tests {
  use super::*;
  use crate::abi::expr::*;
  use crate::abi::types::*;

  #[test]
  fn test_primitive_resolution() {
    let mut resolver = TypeResolver::new();

    let typedef = TypeDef { name: "test_type".to_string(), kind: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32)) };

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
    let status = resolver.analyze_expression_constantness(&const_expr, None).unwrap();
    assert!(matches!(status, ConstantStatus::Constant));

    // Non-constant expression with field reference (without parent context, won't validate)
    let non_const_expr = ExprKind::FieldRef(FieldRefExpr { path: vec!["field_name".to_string()] });
    let status = resolver.analyze_expression_constantness(&non_const_expr, None).unwrap();
    assert!(matches!(status, ConstantStatus::NonConstant(_)));

    // With parent context, it should validate the field exists and is primitive
    // This would require a more complex test setup with actual resolved types
  }
}
