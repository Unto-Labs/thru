import type {
  AbiDocument,
  ArrayType,
  EnumType,
  SizeDiscriminatedUnionType,
  StructType,
  TypeDefinition,
  TypeKind,
  TypeRefType,
  UnionType,
} from "./abiSchema";
import { AbiValidationError } from "./errors";

export class TypeRegistry {
  private readonly types = new Map<string, TypeDefinition>();

  constructor(definitions: Iterable<TypeDefinition>) {
    for (const def of definitions) {
      this.types.set(def.name, def);
    }
  }

  get(typeName: string): TypeDefinition {
    const definition = this.types.get(typeName);
    if (!definition) {
      throw new AbiValidationError(`Type '${typeName}' is not defined in this ABI file`, { typeName });
    }
    return definition;
  }

  has(typeName: string): boolean {
    return this.types.has(typeName);
  }

  entries(): IterableIterator<[string, TypeDefinition]> {
    return this.types.entries();
  }
}

export function buildTypeRegistry(document: AbiDocument): TypeRegistry {
  const registry = new TypeRegistry(document.types);
  validateTypeReferences(registry);
  detectReferenceCycles(registry);
  return registry;
}

function validateTypeReferences(registry: TypeRegistry) {
  for (const [, type] of registry.entries()) {
    validateTypeKindReferences(type.kind, registry, type.name);
  }
}

function validateTypeKindReferences(kind: TypeKind, registry: TypeRegistry, context: string) {
  switch (kind.kind) {
    case "type-ref":
      ensureTypeExists(kind, registry, context);
      break;
    case "struct":
      kind.fields.forEach((field) => validateTypeKindReferences(field.type, registry, `${context}.${field.name}`));
      break;
    case "array":
      validateTypeKindReferences(kind.elementType, registry, `${context}[]`);
      break;
    case "enum":
      kind.variants.forEach((variant) => validateTypeKindReferences(variant.type, registry, `${context}.${variant.name}`));
      break;
    case "union":
      kind.variants.forEach((variant) => validateTypeKindReferences(variant.type, registry, `${context}.${variant.name}`));
      break;
    case "size-discriminated-union":
      kind.variants.forEach((variant) => validateTypeKindReferences(variant.type, registry, `${context}.${variant.name}`));
      break;
    case "primitive":
      break;
    default:
      kind satisfies never;
  }
}

function ensureTypeExists(typeRef: TypeRefType, registry: TypeRegistry, context: string) {
  if (!registry.has(typeRef.name)) {
    throw new AbiValidationError(`Type '${context}' references unknown type '${typeRef.name}'`, {
      typeName: context,
      referencedType: typeRef.name,
    });
  }
}

function detectReferenceCycles(registry: TypeRegistry) {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (typeName: string, stack: string[]) => {
    if (visited.has(typeName)) {
      return;
    }
    if (visiting.has(typeName)) {
      const cyclePath = [...stack, typeName];
      throw new AbiValidationError(`Cyclic type reference detected: ${cyclePath.join(" -> ")}`, { cycle: cyclePath });
    }

    visiting.add(typeName);
    const type = registry.get(typeName);
    const referencedTypes = collectTypeReferences(type.kind);
    for (const referenced of referencedTypes) {
      if (registry.has(referenced)) {
        visit(referenced, [...stack, typeName]);
      }
    }
    visiting.delete(typeName);
    visited.add(typeName);
  };

  for (const [typeName] of registry.entries()) {
    if (!visited.has(typeName)) {
      visit(typeName, []);
    }
  }
}

function collectTypeReferences(kind: TypeKind, refs: Set<string> = new Set()): Set<string> {
  switch (kind.kind) {
    case "type-ref":
      refs.add(kind.name);
      break;
    case "struct":
      collectStructRefs(kind, refs);
      break;
    case "array":
      collectTypeReferences(kind.elementType, refs);
      break;
    case "enum":
      collectEnumRefs(kind, refs);
      break;
    case "union":
      collectUnionRefs(kind, refs);
      break;
    case "size-discriminated-union":
      collectSizeUnionRefs(kind, refs);
      break;
    case "primitive":
      break;
    default:
      kind satisfies never;
  }
  return refs;
}

function collectStructRefs(struct: StructType, refs: Set<string>) {
  for (const field of struct.fields) {
    collectTypeReferences(field.type, refs);
  }
}

function collectEnumRefs(enumType: EnumType, refs: Set<string>) {
  for (const variant of enumType.variants) {
    collectTypeReferences(variant.type, refs);
  }
}

function collectUnionRefs(union: UnionType, refs: Set<string>) {
  for (const variant of union.variants) {
    collectTypeReferences(variant.type, refs);
  }
}

function collectSizeUnionRefs(union: SizeDiscriminatedUnionType, refs: Set<string>) {
  for (const variant of union.variants) {
    collectTypeReferences(variant.type, refs);
  }
}

