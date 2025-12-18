use crate::abi::expr::{ConstantExpression, ExprKind, FieldRefExpr};
use crate::abi::types::{
    ArrayType, EnumType, FloatingPointType, IntegralType, PrimitiveType,
    SizeDiscriminatedUnionType, StructType, TypeDef, TypeKind, TypeRefType, UnionType,
};
use std::collections::{HashMap, HashSet, VecDeque};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DependencyKind {
    TypeReference,
    FieldReference,
    SizeExpression,
    TagExpression,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LayoutDependencyKind {
    /// A field whose size affects the layout of subsequent fields
    SizeAffecting,
    /// A field whose offset is affected by other fields' sizes
    OffsetDependent,
    /// An enum tag that determines variant layout
    VariantSelector,
    /// An array size that affects total struct size
    ArraySizeAffecting,
}

#[derive(Debug, Clone)]
pub struct Dependency {
    pub from: String,
    pub to: String,
    pub kind: DependencyKind,
    pub context: String, // Additional context about where the dependency occurs
}

#[derive(Debug, Clone)]
pub struct LayoutDependency {
    pub from_type: String,
    pub from_field: Option<String>, // None for type-level dependencies
    pub to_type: String,
    pub to_field: Option<String>,
    pub kind: LayoutDependencyKind,
    pub context: String,
}

#[derive(Debug, Clone)]
pub struct LayoutConstraintViolation {
    pub violating_type: String,
    pub violating_expression: String,
    pub dependency_chain: Vec<String>,
    pub reason: String,
}

#[derive(Debug, Clone)]
pub struct ValidationError {
    pub error_type: String,
    pub violating_type: String,
    pub duplicate_name: String,
    pub reason: String,
}

#[derive(Debug)]
pub struct DependencyGraph {
    pub nodes: HashSet<String>,
    pub edges: Vec<Dependency>,
    pub adjacency_list: HashMap<String, Vec<String>>,
    pub layout_dependencies: Vec<LayoutDependency>,
    pub layout_violations: Vec<LayoutConstraintViolation>,
    pub validation_errors: Vec<ValidationError>,
}

#[derive(Debug)]
pub struct CyclePath {
    pub cycle: Vec<String>,
    pub dependencies: Vec<Dependency>,
}

#[derive(Debug)]
pub struct DependencyAnalysis {
    pub graph: DependencyGraph,
    pub cycles: Vec<CyclePath>,
    pub topological_order: Option<Vec<String>>,
    pub layout_violations: Vec<LayoutConstraintViolation>,
    pub validation_errors: Vec<ValidationError>,
}

impl DependencyGraph {
    pub fn new() -> Self {
        Self {
            nodes: HashSet::new(),
            edges: Vec::new(),
            adjacency_list: HashMap::new(),
            layout_dependencies: Vec::new(),
            layout_violations: Vec::new(),
            validation_errors: Vec::new(),
        }
    }

    pub fn add_node(&mut self, name: String) {
        self.nodes.insert(name.clone());
        self.adjacency_list.entry(name).or_insert_with(Vec::new);
    }

    pub fn add_dependency(&mut self, dep: Dependency) {
        self.add_node(dep.from.clone());
        self.add_node(dep.to.clone());

        self.adjacency_list
            .entry(dep.from.clone())
            .or_insert_with(Vec::new)
            .push(dep.to.clone());

        self.edges.push(dep);
    }

    pub fn add_layout_dependency(&mut self, layout_dep: LayoutDependency) {
        self.layout_dependencies.push(layout_dep);
    }

    pub fn add_layout_violation(&mut self, violation: LayoutConstraintViolation) {
        self.layout_violations.push(violation);
    }

    pub fn add_validation_error(&mut self, error: ValidationError) {
        self.validation_errors.push(error);
    }

    /// Detect cycles using DFS with cycle detection
    pub fn detect_cycles(&self) -> Vec<CyclePath> {
        let mut cycles = Vec::new();
        let mut visited = HashSet::new();
        let mut rec_stack = HashSet::new();
        let mut path = Vec::new();

        for node in &self.nodes {
            if !visited.contains(node) {
                self.dfs_cycle_detection(
                    node,
                    &mut visited,
                    &mut rec_stack,
                    &mut path,
                    &mut cycles,
                );
            }
        }

        cycles
    }

    fn dfs_cycle_detection(
        &self,
        node: &str,
        visited: &mut HashSet<String>,
        rec_stack: &mut HashSet<String>,
        path: &mut Vec<String>,
        cycles: &mut Vec<CyclePath>,
    ) {
        visited.insert(node.to_string());
        rec_stack.insert(node.to_string());
        path.push(node.to_string());

        if let Some(neighbors) = self.adjacency_list.get(node) {
            for neighbor in neighbors {
                if !visited.contains(neighbor) {
                    self.dfs_cycle_detection(neighbor, visited, rec_stack, path, cycles);
                } else if rec_stack.contains(neighbor) {
                    // Found a cycle
                    let cycle_start_idx = path.iter().position(|x| x == neighbor).unwrap();
                    let cycle_path: Vec<String> = path[cycle_start_idx..].to_vec();

                    // Add the first node again to complete the cycle
                    let mut complete_cycle = cycle_path.clone();
                    complete_cycle.push(neighbor.clone());

                    // Find the dependencies that form this cycle
                    let cycle_deps = self.get_dependencies_for_cycle(&complete_cycle);

                    cycles.push(CyclePath {
                        cycle: complete_cycle,
                        dependencies: cycle_deps,
                    });
                }
            }
        }

        path.pop();
        rec_stack.remove(node);
    }

    fn get_dependencies_for_cycle(&self, cycle: &[String]) -> Vec<Dependency> {
        let mut cycle_deps = Vec::new();

        for i in 0..cycle.len() - 1 {
            let from = &cycle[i];
            let to = &cycle[i + 1];

            // Find the dependency edge from 'from' to 'to'
            if let Some(dep) = self.edges.iter().find(|d| d.from == *from && d.to == *to) {
                cycle_deps.push(dep.clone());
            }
        }

        cycle_deps
    }

    /// Compute topological ordering using Kahn's algorithm
    pub fn topological_sort(&self) -> Option<Vec<String>> {
        if !self.detect_cycles().is_empty() {
            return None; // Can't topologically sort a graph with cycles
        }

        let mut in_degree: HashMap<String, usize> = HashMap::new();
        let mut reverse_adjacency: HashMap<String, Vec<String>> = HashMap::new();
        let mut queue = VecDeque::new();
        let mut result = Vec::new();

        // Initialize in-degree count and reverse adjacency list
        for node in &self.nodes {
            in_degree.insert(node.clone(), 0);
            reverse_adjacency.insert(node.clone(), Vec::new());
        }

        // Calculate in-degrees and build reverse adjacency list
        // If A -> B means "A depends on B", then:
        // - A has in-degree +1 (A depends on something)
        // - When we process B, we can enable A (reduce A's in-degree)
        for dep in &self.edges {
            *in_degree.entry(dep.from.clone()).or_insert(0) += 1;
            // B points to A in reverse adjacency (when B is processed, A can be enabled)
            reverse_adjacency
                .entry(dep.to.clone())
                .or_insert_with(Vec::new)
                .push(dep.from.clone());
        }

        // Find all nodes with in-degree 0
        for (node, &degree) in &in_degree {
            if degree == 0 {
                queue.push_back(node.clone());
            }
        }

        // Process the queue
        while let Some(node) = queue.pop_front() {
            result.push(node.clone());

            // For each dependent of the current node (reverse direction)
            if let Some(dependents) = reverse_adjacency.get(&node) {
                for dependent in dependents {
                    if let Some(degree) = in_degree.get_mut(dependent) {
                        *degree -= 1;
                        if *degree == 0 {
                            queue.push_back(dependent.clone());
                        }
                    }
                }
            }
        }

        if result.len() == self.nodes.len() {
            Some(result)
        } else {
            None // Graph has cycles
        }
    }
}

pub struct DependencyAnalyzer {
    graph: DependencyGraph,
    current_type_name: Option<String>,
    field_path: Vec<String>,
}

impl DependencyAnalyzer {
    pub fn new() -> Self {
        Self {
            graph: DependencyGraph::new(),
            current_type_name: None,
            field_path: Vec::new(),
        }
    }

    pub fn analyze_typedef(&mut self, typedef: &TypeDef) -> DependencyAnalysis {
        self.current_type_name = Some(typedef.name.clone());
        self.graph.add_node(typedef.name.clone());

        self.analyze_type_kind(&typedef.kind);

        let cycles = self.graph.detect_cycles();
        let topological_order = self.graph.topological_sort();
        let layout_violations = self.graph.layout_violations.clone();
        let validation_errors = self.graph.validation_errors.clone();

        DependencyAnalysis {
            graph: std::mem::replace(&mut self.graph, DependencyGraph::new()),
            cycles,
            topological_order,
            layout_violations,
            validation_errors,
        }
    }

    pub fn analyze_multiple_typedefs(&mut self, typedefs: &[TypeDef]) -> DependencyAnalysis {
        // First pass: add all type names as nodes
        for typedef in typedefs {
            self.graph.add_node(typedef.name.clone());
        }

        // Second pass: analyze dependencies
        for typedef in typedefs {
            self.current_type_name = Some(typedef.name.clone());
            self.analyze_type_kind(&typedef.kind);
        }

        // Third pass: validate basic structure (no duplicates, etc.)
        self.validate_basic_structure(typedefs);

        // Fourth pass: validate layout constraints after building dependencies
        self.validate_layout_constraints(typedefs);

        let cycles = self.graph.detect_cycles();
        let topological_order = self.graph.topological_sort();
        let layout_violations = self.graph.layout_violations.clone();
        let validation_errors = self.graph.validation_errors.clone();

        DependencyAnalysis {
            graph: std::mem::replace(&mut self.graph, DependencyGraph::new()),
            cycles,
            topological_order,
            layout_violations,
            validation_errors,
        }
    }

    fn analyze_type_kind(&mut self, type_kind: &TypeKind) {
        match type_kind {
            TypeKind::Struct(struct_type) => self.analyze_struct(struct_type),
            TypeKind::Union(union_type) => self.analyze_union(union_type),
            TypeKind::Enum(enum_type) => self.analyze_enum(enum_type),
            TypeKind::Array(array_type) => self.analyze_array(array_type),
            TypeKind::SizeDiscriminatedUnion(size_disc_union) => {
                self.analyze_size_discriminated_union(size_disc_union)
            }
            TypeKind::TypeRef(type_ref) => self.analyze_type_ref(type_ref),
            TypeKind::Primitive(_) => {} // Primitives have no dependencies
        }
    }

    fn analyze_struct(&mut self, struct_type: &StructType) {
        for field in &struct_type.fields {
            self.field_path.push(field.name.clone());
            self.analyze_type_kind(&field.field_type);
            self.field_path.pop();
        }
    }

    fn analyze_union(&mut self, union_type: &UnionType) {
        for variant in &union_type.variants {
            self.field_path.push(variant.name.clone());
            self.analyze_type_kind(&variant.variant_type);
            self.field_path.pop();
        }
    }

    fn analyze_size_discriminated_union(&mut self, size_disc_union: &SizeDiscriminatedUnionType) {
        for variant in &size_disc_union.variants {
            self.field_path.push(variant.name.clone());
            self.analyze_type_kind(&variant.variant_type);
            self.field_path.pop();
        }
    }

    fn analyze_enum(&mut self, enum_type: &EnumType) {
        // Analyze tag expression for field references
        self.analyze_expression(&enum_type.tag_ref, DependencyKind::TagExpression);

        for variant in &enum_type.variants {
            self.field_path.push(variant.name.clone());
            self.analyze_type_kind(&variant.variant_type);
            self.field_path.pop();
        }
    }

    fn analyze_array(&mut self, array_type: &ArrayType) {
        // Analyze size expression for field references
        self.analyze_expression(&array_type.size, DependencyKind::SizeExpression);

        // Analyze element type
        self.analyze_type_kind(&array_type.element_type);
    }

    fn analyze_type_ref(&mut self, type_ref: &TypeRefType) {
        if let Some(current_type) = &self.current_type_name {
            let context = if self.field_path.is_empty() {
                "direct type reference".to_string()
            } else {
                format!("field: {}", self.field_path.join("."))
            };

            self.graph.add_dependency(Dependency {
                from: current_type.clone(), // Current type depends on referenced type
                to: type_ref.name.clone(),  // Referenced type must come first
                kind: DependencyKind::TypeReference,
                context,
            });
        }
    }

    fn analyze_expression(&mut self, expr: &ExprKind, dep_kind: DependencyKind) {
        match expr {
            ExprKind::Literal(_) => {} // Literals have no dependencies
            ExprKind::FieldRef(field_ref) => {
                self.analyze_field_reference(field_ref, dep_kind);
            }
            ExprKind::Sizeof(sizeof_expr) => {
                // Sizeof creates a type dependency
                if let Some(current_type) = &self.current_type_name {
                    let context =
                        format!("sizeof expression in field: {}", self.field_path.join("."));
                    self.graph.add_dependency(Dependency {
                        from: current_type.clone(),
                        to: sizeof_expr.type_name.clone(),
                        kind: DependencyKind::TypeReference,
                        context,
                    });
                }
            }
            ExprKind::Alignof(alignof_expr) => {
                // Alignof creates a type dependency
                if let Some(current_type) = &self.current_type_name {
                    let context =
                        format!("alignof expression in field: {}", self.field_path.join("."));
                    self.graph.add_dependency(Dependency {
                        from: current_type.clone(),
                        to: alignof_expr.type_name.clone(),
                        kind: DependencyKind::TypeReference,
                        context,
                    });
                }
            }

            // Binary operations - recursively analyze operands
            ExprKind::Add(expr) => {
                self.analyze_expression(&expr.left, dep_kind.clone());
                self.analyze_expression(&expr.right, dep_kind);
            }
            ExprKind::Sub(expr) => {
                self.analyze_expression(&expr.left, dep_kind.clone());
                self.analyze_expression(&expr.right, dep_kind);
            }
            ExprKind::Mul(expr) => {
                self.analyze_expression(&expr.left, dep_kind.clone());
                self.analyze_expression(&expr.right, dep_kind);
            }
            ExprKind::Div(expr) => {
                self.analyze_expression(&expr.left, dep_kind.clone());
                self.analyze_expression(&expr.right, dep_kind);
            }
            ExprKind::Mod(expr) => {
                self.analyze_expression(&expr.left, dep_kind.clone());
                self.analyze_expression(&expr.right, dep_kind);
            }
            ExprKind::Pow(expr) => {
                self.analyze_expression(&expr.left, dep_kind.clone());
                self.analyze_expression(&expr.right, dep_kind);
            }

            // Bitwise operations
            ExprKind::BitAnd(expr) => {
                self.analyze_expression(&expr.left, dep_kind.clone());
                self.analyze_expression(&expr.right, dep_kind);
            }
            ExprKind::BitOr(expr) => {
                self.analyze_expression(&expr.left, dep_kind.clone());
                self.analyze_expression(&expr.right, dep_kind);
            }
            ExprKind::BitXor(expr) => {
                self.analyze_expression(&expr.left, dep_kind.clone());
                self.analyze_expression(&expr.right, dep_kind);
            }
            ExprKind::LeftShift(expr) => {
                self.analyze_expression(&expr.left, dep_kind.clone());
                self.analyze_expression(&expr.right, dep_kind);
            }
            ExprKind::RightShift(expr) => {
                self.analyze_expression(&expr.left, dep_kind.clone());
                self.analyze_expression(&expr.right, dep_kind);
            }

            // Comparison operations
            ExprKind::Eq(expr) => {
                self.analyze_expression(&expr.left, dep_kind.clone());
                self.analyze_expression(&expr.right, dep_kind);
            }
            ExprKind::Ne(expr) => {
                self.analyze_expression(&expr.left, dep_kind.clone());
                self.analyze_expression(&expr.right, dep_kind);
            }
            ExprKind::Lt(expr) => {
                self.analyze_expression(&expr.left, dep_kind.clone());
                self.analyze_expression(&expr.right, dep_kind);
            }
            ExprKind::Gt(expr) => {
                self.analyze_expression(&expr.left, dep_kind.clone());
                self.analyze_expression(&expr.right, dep_kind);
            }
            ExprKind::Le(expr) => {
                self.analyze_expression(&expr.left, dep_kind.clone());
                self.analyze_expression(&expr.right, dep_kind);
            }
            ExprKind::Ge(expr) => {
                self.analyze_expression(&expr.left, dep_kind.clone());
                self.analyze_expression(&expr.right, dep_kind);
            }

            // Logical operations
            ExprKind::And(expr) => {
                self.analyze_expression(&expr.left, dep_kind.clone());
                self.analyze_expression(&expr.right, dep_kind);
            }
            ExprKind::Or(expr) => {
                self.analyze_expression(&expr.left, dep_kind.clone());
                self.analyze_expression(&expr.right, dep_kind);
            }
            ExprKind::Xor(expr) => {
                self.analyze_expression(&expr.left, dep_kind.clone());
                self.analyze_expression(&expr.right, dep_kind);
            }

            // Unary operations
            ExprKind::BitNot(expr) => {
                self.analyze_expression(&expr.operand, dep_kind);
            }
            ExprKind::Neg(expr) => {
                self.analyze_expression(&expr.operand, dep_kind);
            }
            ExprKind::Not(expr) => {
                self.analyze_expression(&expr.operand, dep_kind);
            }
            ExprKind::Popcount(expr) => {
                self.analyze_expression(&expr.operand, dep_kind);
            }
        }
    }

    fn analyze_field_reference(&mut self, field_ref: &FieldRefExpr, dep_kind: DependencyKind) {
        if let Some(current_type) = &self.current_type_name {
            let context = format!(
                "field reference '{}' in field: {}",
                field_ref.path.join("."),
                self.field_path.join(".")
            );

            // Field references create dependencies on the fields they reference
            let target_field = if field_ref.path.len() == 1 {
                // Simple field reference within the same type
                format!("{}::{}", current_type, field_ref.path[0])
            } else if field_ref.path.len() == 2 {
                // Field reference to another type: ["TypeName", "field_name"]
                format!("{}::{}", field_ref.path[0], field_ref.path[1])
            } else {
                // Complex nested field path - use the full path as reference
                format!("{}::{}", field_ref.path[0], field_ref.path[1..].join("."))
            };

            self.graph.add_dependency(Dependency {
                from: current_type.clone(),
                to: target_field,
                kind: dep_kind,
                context,
            });
        }
    }

    fn validate_basic_structure(&mut self, typedefs: &[TypeDef]) {
        // Check for duplicate type names
        let mut type_names = HashSet::new();
        for typedef in typedefs {
            if !type_names.insert(typedef.name.clone()) {
                self.graph.add_validation_error(ValidationError {
                    error_type: "DuplicateTypeName".to_string(),
                    violating_type: typedef.name.clone(),
                    duplicate_name: typedef.name.clone(),
                    reason: format!("Type name '{}' is defined multiple times", typedef.name),
                });
            }
        }

        // Check each type for internal duplicate names
        for typedef in typedefs {
            self.validate_type_internal_duplicates(typedef);
        }
    }

    fn validate_type_internal_duplicates(&mut self, typedef: &TypeDef) {
        match &typedef.kind {
            TypeKind::Struct(struct_type) => {
                self.validate_struct_field_duplicates(&typedef.name, struct_type);
            }
            TypeKind::Union(union_type) => {
                self.validate_union_variant_duplicates(&typedef.name, union_type);
            }
            TypeKind::Enum(enum_type) => {
                self.validate_enum_variant_duplicates(&typedef.name, enum_type);
            }
            TypeKind::SizeDiscriminatedUnion(size_disc_union) => {
                self.validate_size_discriminated_union_variant_duplicates(
                    &typedef.name,
                    size_disc_union,
                );
            }
            _ => {} // Other types don't have fields/variants to check
        }
    }

    fn validate_struct_field_duplicates(&mut self, type_name: &str, struct_type: &StructType) {
        let mut field_names = HashSet::new();
        for field in &struct_type.fields {
            if !field_names.insert(field.name.clone()) {
                self.graph.add_validation_error(ValidationError {
                    error_type: "DuplicateFieldName".to_string(),
                    violating_type: type_name.to_string(),
                    duplicate_name: field.name.clone(),
                    reason: format!(
                        "Field name '{}' appears multiple times in struct '{}'",
                        field.name, type_name
                    ),
                });
            }
        }
    }

    fn validate_union_variant_duplicates(&mut self, type_name: &str, union_type: &UnionType) {
        let mut variant_names = HashSet::new();
        for variant in &union_type.variants {
            if !variant_names.insert(variant.name.clone()) {
                self.graph.add_validation_error(ValidationError {
                    error_type: "DuplicateVariantName".to_string(),
                    violating_type: type_name.to_string(),
                    duplicate_name: variant.name.clone(),
                    reason: format!(
                        "Variant name '{}' appears multiple times in union '{}'",
                        variant.name, type_name
                    ),
                });
            }
        }
    }

    fn validate_enum_variant_duplicates(&mut self, type_name: &str, enum_type: &EnumType) {
        let mut variant_names = HashSet::new();
        let mut tag_values = HashSet::new();

        for variant in &enum_type.variants {
            // Check for duplicate variant names
            if !variant_names.insert(variant.name.clone()) {
                self.graph.add_validation_error(ValidationError {
                    error_type: "DuplicateVariantName".to_string(),
                    violating_type: type_name.to_string(),
                    duplicate_name: variant.name.clone(),
                    reason: format!(
                        "Variant name '{}' appears multiple times in enum '{}'",
                        variant.name, type_name
                    ),
                });
            }

            // Check for duplicate tag values
            if !tag_values.insert(variant.tag_value) {
                self.graph.add_validation_error(ValidationError {
                    error_type: "DuplicateTagValue".to_string(),
                    violating_type: type_name.to_string(),
                    duplicate_name: variant.tag_value.to_string(),
                    reason: format!(
                        "Tag value '{}' is used by multiple variants in enum '{}'",
                        variant.tag_value, type_name
                    ),
                });
            }
        }
    }

    fn validate_size_discriminated_union_variant_duplicates(
        &mut self,
        type_name: &str,
        size_disc_union: &SizeDiscriminatedUnionType,
    ) {
        let mut variant_names = HashSet::new();

        for variant in &size_disc_union.variants {
            // Check for duplicate variant names
            if !variant_names.insert(variant.name.clone()) {
                self.graph.add_validation_error(ValidationError {
                    error_type: "DuplicateVariantName".to_string(),
                    violating_type: type_name.to_string(),
                    duplicate_name: variant.name.clone(),
                    reason: format!(
                        "Variant name '{}' appears multiple times in size-discriminated union '{}'",
                        variant.name, type_name
                    ),
                });
            }
        }
    }

    fn validate_layout_constraints(&mut self, typedefs: &[TypeDef]) {
        for typedef in typedefs {
            self.validate_type_layout_constraints(typedef, typedefs);
        }
    }

    fn validate_type_layout_constraints(&mut self, typedef: &TypeDef, all_typedefs: &[TypeDef]) {
        match &typedef.kind {
            TypeKind::Enum(enum_type) => {
                self.validate_enum_tag_constraints(&typedef.name, enum_type, all_typedefs);
            }
            TypeKind::Array(array_type) => {
                self.validate_array_size_constraints(&typedef.name, array_type, all_typedefs);
            }
            TypeKind::Struct(struct_type) => {
                self.validate_struct_field_constraints(&typedef.name, struct_type, all_typedefs);
            }
            TypeKind::SizeDiscriminatedUnion(size_disc_union) => {
                self.validate_size_discriminated_union_constraints(
                    &typedef.name,
                    size_disc_union,
                    all_typedefs,
                );
            }
            _ => {} // Other types don't have layout-affecting expressions
        }
    }

    fn validate_enum_tag_constraints(
        &mut self,
        enum_name: &str,
        enum_type: &EnumType,
        all_typedefs: &[TypeDef],
    ) {
        // Collect field references in the tag expression
        let field_refs = self.collect_field_references_from_expr(&enum_type.tag_ref);

        for field_ref in field_refs {
            // Check if this field reference creates a layout cycle
            if let Some(violation) =
                self.check_enum_tag_layout_cycle(enum_name, &field_ref, all_typedefs)
            {
                self.graph.add_layout_violation(violation);
            }
        }
    }

    fn validate_array_size_constraints(
        &mut self,
        array_name: &str,
        array_type: &ArrayType,
        all_typedefs: &[TypeDef],
    ) {
        // Check if element type has non-constant size
        if let Some(violation) =
            self.check_array_element_type_size(array_name, array_type, all_typedefs)
        {
            self.graph.add_layout_violation(violation);
        }

        let field_refs = self.collect_field_references_from_expr(&array_type.size);

        for field_ref in field_refs {
            if let Some(violation) =
                self.check_array_size_layout_cycle(array_name, &field_ref, all_typedefs)
            {
                self.graph.add_layout_violation(violation);
            }
        }
    }

    fn validate_struct_field_constraints(
        &mut self,
        struct_name: &str,
        struct_type: &StructType,
        all_typedefs: &[TypeDef],
    ) {
        // For each field, check if its type contains expressions that reference this struct
        for (field_index, field) in struct_type.fields.iter().enumerate() {
            if let Some(violation) =
                self.check_field_layout_dependency(struct_name, field_index, field, all_typedefs)
            {
                self.graph.add_layout_violation(violation);
            }
        }
    }

    fn check_enum_tag_layout_cycle(
        &self,
        enum_name: &str,
        field_ref: &str,
        all_typedefs: &[TypeDef],
    ) -> Option<LayoutConstraintViolation> {
        // Parse field reference to determine which type and field it refers to
        let (ref_type, ref_field) = self.parse_field_reference(field_ref);

        // Check if this enum's size actually depends on its tag
        let enum_size_depends_on_tag =
            if let Some(enum_typedef) = all_typedefs.iter().find(|td| td.name == enum_name) {
                self.type_size_depends_on_field_refs(enum_typedef, all_typedefs)
            } else {
                false
            };

        // Special case: Check if the enum is embedded in the same struct that contains the referenced field
        // This is problematic regardless of whether the enum has constant size
        let is_same_struct_reference =
            self.is_enum_referencing_same_container_struct(enum_name, &ref_type, all_typedefs);

        if is_same_struct_reference {
            // Check if this is a forward reference (enum field comes before referenced field in the struct)
            if let Some(forward_ref_violation) = self.check_enum_forward_reference_in_same_struct(
                enum_name,
                &ref_type,
                &ref_field,
                all_typedefs,
            ) {
                return Some(forward_ref_violation);
            } else {
                // Forward reference was checked and deemed acceptable (e.g., multiple constant variants)
                // No need to do further layout dependency checks for same-struct references
                return None;
            }
        }

        // If the enum has constant size and is not referencing the same container struct, it's generally safe
        if !enum_size_depends_on_tag {
            return None;
        }

        // Check if the referenced field's offset could be affected by this enum's size
        if let Some(dependency_chain) =
            self.find_layout_dependency_chain(&ref_type, enum_name, all_typedefs)
        {
            return Some(LayoutConstraintViolation {
                violating_type: enum_name.to_string(),
                violating_expression: format!("enum tag references field: {}", field_ref),
                dependency_chain,
                reason: format!(
                    "Enum '{}' tag expression references field '{}' in type '{}', but this field's offset \
                     depends transitively on the enum's own size, creating a layout cycle",
                    enum_name, ref_field, ref_type
                ),
            });
        }

        None
    }

    fn check_array_size_layout_cycle(
        &self,
        array_name: &str,
        field_ref: &str,
        all_typedefs: &[TypeDef],
    ) -> Option<LayoutConstraintViolation> {
        let (ref_type, ref_field) = self.parse_field_reference(field_ref);

        if let Some(dependency_chain) =
            self.find_layout_dependency_chain(&ref_type, array_name, all_typedefs)
        {
            return Some(LayoutConstraintViolation {
                violating_type: array_name.to_string(),
                violating_expression: format!("array size references field: {}", field_ref),
                dependency_chain,
                reason: format!(
                    "Array '{}' size expression references field '{}' in type '{}', but this field's offset \
                     depends transitively on the array's own size, creating a layout cycle",
                    array_name, ref_field, ref_type
                ),
            });
        }

        None
    }

    fn check_field_layout_dependency(
        &self,
        struct_name: &str,
        field_index: usize,
        field: &crate::abi::types::StructField,
        all_typedefs: &[TypeDef],
    ) -> Option<LayoutConstraintViolation> {
        // Check if the field's type contains expressions that reference fields in this struct
        // whose offsets come after this field (creating a forward reference cycle)

        if let Some(field_type_def) = self.find_typedef_for_type(&field.field_type, all_typedefs) {
            let field_refs = self.collect_all_field_references_in_type(&field_type_def);

            for field_ref in field_refs {
                let (ref_type, ref_field) = self.parse_field_reference(&field_ref);

                // Check if this references a field in the same struct that comes after this field
                if ref_type == struct_name {
                    if let Some(struct_def) = all_typedefs.iter().find(|td| td.name == struct_name)
                    {
                        if let TypeKind::Struct(struct_type) = &struct_def.kind {
                            // Find the referenced field's position
                            if let Some(ref_field_index) =
                                struct_type.fields.iter().position(|f| f.name == ref_field)
                            {
                                if ref_field_index > field_index {
                                    // Forward references within the same struct are problematic if:
                                    // 1. The field's type size depends on the referenced field, OR
                                    // 2. The field's type needs the referenced field value for layout decisions (e.g., enum tag for variant selection)

                                    let creates_layout_dependency =
                                        self.type_size_depends_on_field_refs(
                                            &field_type_def,
                                            all_typedefs,
                                        ) || self.type_needs_field_ref_for_layout(
                                            &field_type_def,
                                            &field_ref,
                                        );

                                    // Special case: Allow enums that don't affect the referenced field's offset
                                    let is_acceptable_enum_reference =
                                        if let TypeKind::Enum(_) = &field_type_def.kind {
                                            !self.does_enum_size_affect_field_offset(
                                                field_index,
                                                ref_field_index,
                                                &field_type_def,
                                                all_typedefs,
                                            )
                                        } else {
                                            false
                                        };

                                    if creates_layout_dependency && !is_acceptable_enum_reference {
                                        return Some(LayoutConstraintViolation {
                                            violating_type: struct_name.to_string(),
                                            violating_expression: format!(
                                                "field '{}' type contains reference to field '{}'",
                                                field.name, field_ref
                                            ),
                                            dependency_chain: vec![
                                                struct_name.to_string(),
                                                field.name.clone(),
                                                ref_field.clone(),
                                            ],
                                            reason: format!(
                                                "Field '{}' in struct '{}' has a type that references field '{}' which comes later \
                                                 in the struct, creating a forward dependency that affects layout calculation",
                                                field.name, struct_name, ref_field
                                            ),
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        None
    }

    fn type_size_depends_on_field_refs(&self, typedef: &TypeDef, all_typedefs: &[TypeDef]) -> bool {
        // Check if a type's size depends on field references in its expressions
        match &typedef.kind {
            TypeKind::Primitive(_) => false, // Primitives have constant size
            TypeKind::TypeRef(_) => false,   // Type refs inherit the target's size properties

            TypeKind::Struct(struct_type) => {
                // A struct's size depends on field refs if any of its fields do
                for field in &struct_type.fields {
                    // Check both named types (via TypeRef) and inline types
                    if let Some(field_typedef) =
                        self.find_typedef_for_type(&field.field_type, all_typedefs)
                    {
                        if self.type_size_depends_on_field_refs(field_typedef, all_typedefs) {
                            return true;
                        }
                    } else {
                        // Handle inline types (not TypeRef)
                        if self.type_size_depends_on_field_refs_recursive(
                            &field.field_type,
                            all_typedefs,
                        ) {
                            return true;
                        }
                    }
                }
                false
            }

            TypeKind::Union(union_type) => {
                // A union's size depends on field refs if any of its variants do
                for variant in &union_type.variants {
                    // Check both named types (via TypeRef) and inline types
                    if let Some(variant_typedef) =
                        self.find_typedef_for_type(&variant.variant_type, all_typedefs)
                    {
                        if self.type_size_depends_on_field_refs(variant_typedef, all_typedefs) {
                            return true;
                        }
                    } else {
                        // Handle inline types (not TypeRef)
                        if self.type_size_depends_on_field_refs_recursive(
                            &variant.variant_type,
                            all_typedefs,
                        ) {
                            return true;
                        }
                    }
                }
                false
            }

            TypeKind::Enum(enum_type) => {
                // An enum's size depends on field refs if:
                // 1. Its variants have different sizes AND the tag expression contains field refs, OR
                // 2. Any of its variants' sizes depend on field refs

                // First check if variants have different sizes or contain field refs
                let mut variant_sizes = std::collections::HashSet::new();
                let mut any_variant_depends_on_refs = false;

                for variant in &enum_type.variants {
                    // Calculate this variant's size (simplified - assume all variants are the same size for now)
                    // This is a conservative approach
                    if let Some(variant_typedef) =
                        self.find_typedef_for_type(&variant.variant_type, all_typedefs)
                    {
                        if self.type_size_depends_on_field_refs(variant_typedef, all_typedefs) {
                            any_variant_depends_on_refs = true;
                        }
                    } else {
                        // Handle inline variant types
                        if self.type_size_depends_on_field_refs_recursive(
                            &variant.variant_type,
                            all_typedefs,
                        ) {
                            any_variant_depends_on_refs = true;
                        }
                    }

                    // For now, assume all primitive types have known sizes
                    // In a more complete implementation, we'd calculate actual sizes
                    match &variant.variant_type {
                        TypeKind::Primitive(prim) => {
                            let size = self.get_primitive_size(prim);
                            variant_sizes.insert(size);
                        }
                        _ => {
                            // For complex types, be conservative and assume different sizes
                            variant_sizes.insert(0); // placeholder
                            variant_sizes.insert(1); // force different sizes
                        }
                    }
                }

                // If any variant depends on field refs, the enum does too
                if any_variant_depends_on_refs {
                    return true;
                }

                // If all variants have the same size, the enum size is constant regardless of tag
                if variant_sizes.len() == 1 {
                    // All variants same size - enum size doesn't depend on tag field refs
                    false
                } else {
                    // Different variant sizes - enum size depends on tag, so check if tag has field refs
                    !enum_type.tag_ref.is_constant()
                }
            }

            TypeKind::Array(array_type) => {
                // Array size depends on field refs if the size expression contains field refs
                !array_type.size.is_constant()
            }

            TypeKind::SizeDiscriminatedUnion(_) => {
                // Size-discriminated unions always have variable size by definition
                true
            }
        }
    }

    fn type_needs_field_ref_for_layout(&self, typedef: &TypeDef, field_ref: &str) -> bool {
        // Check if a type needs a field reference for layout decisions (not just size calculation)
        match &typedef.kind {
            TypeKind::Enum(enum_type) => {
                // Enums need their tag field for variant selection, even if all variants have the same size
                let field_refs = self.collect_field_references_from_expr(&enum_type.tag_ref);
                field_refs.iter().any(|ref_expr| ref_expr == field_ref)
            }
            TypeKind::Array(array_type) => {
                // Arrays need their size field for layout
                let field_refs = self.collect_field_references_from_expr(&array_type.size);
                field_refs.iter().any(|ref_expr| ref_expr == field_ref)
            }
            TypeKind::Struct(struct_type) => {
                // Check recursively for nested types
                for field in &struct_type.fields {
                    if let Some(field_typedef) = self.find_typedef_for_type(&field.field_type, &[])
                    {
                        if self.type_needs_field_ref_for_layout(field_typedef, field_ref) {
                            return true;
                        }
                    }
                }
                false
            }
            TypeKind::Union(union_type) => {
                // Check recursively for nested types
                for variant in &union_type.variants {
                    if let Some(variant_typedef) =
                        self.find_typedef_for_type(&variant.variant_type, &[])
                    {
                        if self.type_needs_field_ref_for_layout(variant_typedef, field_ref) {
                            return true;
                        }
                    }
                }
                false
            }
            _ => false, // Primitives and type refs don't need field refs for layout
        }
    }

    fn get_primitive_size(&self, prim: &PrimitiveType) -> u64 {
        match prim {
            PrimitiveType::Integral(int_type) => match int_type {
                IntegralType::U8 | IntegralType::I8 => 1,
                IntegralType::U16 | IntegralType::I16 => 2,
                IntegralType::U32 | IntegralType::I32 => 4,
                IntegralType::U64 | IntegralType::I64 => 8,
            },
            PrimitiveType::FloatingPoint(float_type) => match float_type {
                FloatingPointType::F16 => 2,
                FloatingPointType::F32 => 4,
                FloatingPointType::F64 => 8,
            },
        }
    }

    fn find_layout_dependency_chain(
        &self,
        from_type: &str,
        to_type: &str,
        _all_typedefs: &[TypeDef],
    ) -> Option<Vec<String>> {
        // Use BFS to find if there's a path from from_type to to_type through layout dependencies
        let mut queue = VecDeque::new();
        let mut visited = HashSet::new();
        let mut parent_map: HashMap<String, String> = HashMap::new();

        queue.push_back(from_type.to_string());
        visited.insert(from_type.to_string());

        while let Some(current) = queue.pop_front() {
            if current == to_type {
                // Found a path - reconstruct it
                let mut chain = Vec::new();
                let mut node = to_type.to_string();

                while let Some(parent) = parent_map.get(&node) {
                    chain.push(node.clone());
                    node = parent.clone();
                }
                chain.push(from_type.to_string());
                chain.reverse();
                return Some(chain);
            }

            // Follow dependency edges to find path from from_type to to_type
            // If A -> B means "A depends on B", then to go from A to B we follow edges where edge.from == current
            for edge in &self.graph.edges {
                if edge.from == current && !visited.contains(&edge.to) {
                    visited.insert(edge.to.clone());
                    parent_map.insert(edge.to.clone(), current.clone());
                    queue.push_back(edge.to.clone());
                }
            }
        }

        None
    }

    fn parse_field_reference(&self, field_ref: &str) -> (String, String) {
        // Parse field references in format "type.field" or "type::field" or just "field" (current type)
        if let Some(pos) = field_ref.find("::") {
            let type_name = field_ref[..pos].to_string();
            let field_name = field_ref[pos + 2..].to_string();
            (type_name, field_name)
        } else if let Some(pos) = field_ref.find('.') {
            let type_name = field_ref[..pos].to_string();
            let field_name = field_ref[pos + 1..].to_string();
            (type_name, field_name)
        } else {
            // Assume it's a field in the current type being analyzed
            let current_type = self
                .current_type_name
                .as_ref()
                .unwrap_or(&"unknown".to_string())
                .clone();
            (current_type, field_ref.to_string())
        }
    }

    fn collect_field_references_from_expr(&self, expr: &ExprKind) -> Vec<String> {
        let mut field_refs = Vec::new();
        self.collect_field_references_recursive(expr, &mut field_refs);
        field_refs
    }

    fn collect_field_references_recursive(&self, expr: &ExprKind, field_refs: &mut Vec<String>) {
        match expr {
            ExprKind::FieldRef(field_ref) => {
                field_refs.push(field_ref.path.join("."));
            }
            // Handle all binary and unary operations recursively
            ExprKind::Add(e) => {
                self.collect_field_references_recursive(&e.left, field_refs);
                self.collect_field_references_recursive(&e.right, field_refs);
            }
            ExprKind::Sub(e) => {
                self.collect_field_references_recursive(&e.left, field_refs);
                self.collect_field_references_recursive(&e.right, field_refs);
            }
            ExprKind::Mul(e) => {
                self.collect_field_references_recursive(&e.left, field_refs);
                self.collect_field_references_recursive(&e.right, field_refs);
            }
            ExprKind::Div(e) => {
                self.collect_field_references_recursive(&e.left, field_refs);
                self.collect_field_references_recursive(&e.right, field_refs);
            }
            ExprKind::Mod(e) => {
                self.collect_field_references_recursive(&e.left, field_refs);
                self.collect_field_references_recursive(&e.right, field_refs);
            }
            ExprKind::Pow(e) => {
                self.collect_field_references_recursive(&e.left, field_refs);
                self.collect_field_references_recursive(&e.right, field_refs);
            }
            ExprKind::BitAnd(e) => {
                self.collect_field_references_recursive(&e.left, field_refs);
                self.collect_field_references_recursive(&e.right, field_refs);
            }
            ExprKind::BitOr(e) => {
                self.collect_field_references_recursive(&e.left, field_refs);
                self.collect_field_references_recursive(&e.right, field_refs);
            }
            ExprKind::BitXor(e) => {
                self.collect_field_references_recursive(&e.left, field_refs);
                self.collect_field_references_recursive(&e.right, field_refs);
            }
            ExprKind::LeftShift(e) => {
                self.collect_field_references_recursive(&e.left, field_refs);
                self.collect_field_references_recursive(&e.right, field_refs);
            }
            ExprKind::RightShift(e) => {
                self.collect_field_references_recursive(&e.left, field_refs);
                self.collect_field_references_recursive(&e.right, field_refs);
            }
            ExprKind::Eq(e) => {
                self.collect_field_references_recursive(&e.left, field_refs);
                self.collect_field_references_recursive(&e.right, field_refs);
            }
            ExprKind::Ne(e) => {
                self.collect_field_references_recursive(&e.left, field_refs);
                self.collect_field_references_recursive(&e.right, field_refs);
            }
            ExprKind::Lt(e) => {
                self.collect_field_references_recursive(&e.left, field_refs);
                self.collect_field_references_recursive(&e.right, field_refs);
            }
            ExprKind::Gt(e) => {
                self.collect_field_references_recursive(&e.left, field_refs);
                self.collect_field_references_recursive(&e.right, field_refs);
            }
            ExprKind::Le(e) => {
                self.collect_field_references_recursive(&e.left, field_refs);
                self.collect_field_references_recursive(&e.right, field_refs);
            }
            ExprKind::Ge(e) => {
                self.collect_field_references_recursive(&e.left, field_refs);
                self.collect_field_references_recursive(&e.right, field_refs);
            }
            ExprKind::And(e) => {
                self.collect_field_references_recursive(&e.left, field_refs);
                self.collect_field_references_recursive(&e.right, field_refs);
            }
            ExprKind::Or(e) => {
                self.collect_field_references_recursive(&e.left, field_refs);
                self.collect_field_references_recursive(&e.right, field_refs);
            }
            ExprKind::Xor(e) => {
                self.collect_field_references_recursive(&e.left, field_refs);
                self.collect_field_references_recursive(&e.right, field_refs);
            }
            ExprKind::BitNot(e) => {
                self.collect_field_references_recursive(&e.operand, field_refs);
            }
            ExprKind::Neg(e) => {
                self.collect_field_references_recursive(&e.operand, field_refs);
            }
            ExprKind::Not(e) => {
                self.collect_field_references_recursive(&e.operand, field_refs);
            }
            ExprKind::Popcount(e) => {
                self.collect_field_references_recursive(&e.operand, field_refs);
            }
            _ => {} // Literals, sizeof, alignof don't contain field references
        }
    }

    fn find_typedef_for_type<'a>(
        &self,
        type_kind: &TypeKind,
        all_typedefs: &'a [TypeDef],
    ) -> Option<&'a TypeDef> {
        match type_kind {
            TypeKind::TypeRef(type_ref) => all_typedefs.iter().find(|td| td.name == type_ref.name),
            _ => None, // For inline types, we'd need more complex analysis
        }
    }

    fn collect_all_field_references_in_type(&self, typedef: &TypeDef) -> Vec<String> {
        let mut field_refs = Vec::new();
        self.collect_field_references_in_type_kind(&typedef.kind, &mut field_refs);
        field_refs
    }

    fn collect_field_references_in_type_kind(
        &self,
        type_kind: &TypeKind,
        field_refs: &mut Vec<String>,
    ) {
        match type_kind {
            TypeKind::Array(array_type) => {
                self.collect_field_references_recursive(&array_type.size, field_refs);
                self.collect_field_references_in_type_kind(&array_type.element_type, field_refs);
            }
            TypeKind::Enum(enum_type) => {
                self.collect_field_references_recursive(&enum_type.tag_ref, field_refs);
                for variant in &enum_type.variants {
                    self.collect_field_references_in_type_kind(&variant.variant_type, field_refs);
                }
            }
            TypeKind::Struct(struct_type) => {
                for field in &struct_type.fields {
                    self.collect_field_references_in_type_kind(&field.field_type, field_refs);
                }
            }
            TypeKind::Union(union_type) => {
                for variant in &union_type.variants {
                    self.collect_field_references_in_type_kind(&variant.variant_type, field_refs);
                }
            }
            _ => {} // Primitives and simple type refs don't contain expressions
        }
    }

    fn is_enum_referencing_same_container_struct(
        &self,
        enum_name: &str,
        ref_type: &str,
        all_typedefs: &[TypeDef],
    ) -> bool {
        // Find structs that contain this enum as a field
        for typedef in all_typedefs {
            if let TypeKind::Struct(struct_type) = &typedef.kind {
                for field in &struct_type.fields {
                    if let TypeKind::TypeRef(type_ref) = &field.field_type {
                        if type_ref.name == enum_name && typedef.name == ref_type {
                            return true;
                        }
                    }
                }
            }
        }
        false
    }

    fn check_enum_forward_reference_in_same_struct(
        &self,
        enum_name: &str,
        struct_name: &str,
        ref_field: &str,
        all_typedefs: &[TypeDef],
    ) -> Option<LayoutConstraintViolation> {
        // Find the struct and check field ordering
        if let Some(struct_typedef) = all_typedefs.iter().find(|td| td.name == struct_name) {
            if let TypeKind::Struct(struct_type) = &struct_typedef.kind {
                let mut enum_field_index = None;
                let mut ref_field_index = None;

                for (i, field) in struct_type.fields.iter().enumerate() {
                    if let TypeKind::TypeRef(type_ref) = &field.field_type {
                        if type_ref.name == enum_name {
                            enum_field_index = Some(i);
                        }
                    }
                    if field.name == ref_field {
                        ref_field_index = Some(i);
                    }
                }

                if let (Some(enum_idx), Some(ref_idx)) = (enum_field_index, ref_field_index) {
                    if enum_idx < ref_idx {
                        // This is a forward reference - check if the referenced field's offset
                        // is actually affected by the enum's size

                        if let Some(enum_typedef) =
                            all_typedefs.iter().find(|td| td.name == enum_name)
                        {
                            // Key insight: Check if the tag field's offset depends on the enum's size
                            let enum_affects_tag_offset = self.does_enum_size_affect_field_offset(
                                enum_idx,
                                ref_idx,
                                enum_typedef,
                                all_typedefs,
                            );

                            if !enum_affects_tag_offset {
                                // Enum size doesn't affect tag field offset - this is valid
                                return None;
                            }
                        }

                        // The enum's size affects the tag field's offset - this creates a cycle
                        return Some(LayoutConstraintViolation {
                            violating_type: enum_name.to_string(),
                            violating_expression: format!(
                                "enum tag references field: {}.{}",
                                struct_name, ref_field
                            ),
                            dependency_chain: vec![
                                struct_name.to_string(),
                                enum_name.to_string(),
                                ref_field.to_string(),
                            ],
                            reason: format!(
                                "Enum '{}' in struct '{}' references field '{}' whose offset depends on the enum's size, \
                                 creating a circular dependency",
                                enum_name, struct_name, ref_field
                            ),
                        });
                    }
                }
            }
        }
        None
    }

    fn does_enum_size_affect_field_offset(
        &self,
        _enum_field_index: usize,
        _ref_field_index: usize,
        enum_typedef: &TypeDef,
        _all_typedefs: &[TypeDef],
    ) -> bool {
        // Check if the enum's size is constant or depends on its tag value
        if let TypeKind::Enum(_enum_type) = &enum_typedef.kind {
            // If the enum has constant size (all variants same size), then it doesn't affect later field offsets
            if self.is_enum_with_constant_size_variants(enum_typedef) {
                return false; // Constant size enum doesn't affect field offsets
            }

            // If enum size varies based on tag, and there are fields between enum and ref field,
            // then those intermediate fields could also be affected
            // For now, be conservative: if enum size varies, it affects later field offsets
            return true;
        }

        // Non-enum types - be conservative
        true
    }

    fn is_enum_with_constant_size_variants(&self, typedef: &TypeDef) -> bool {
        if let TypeKind::Enum(enum_type) = &typedef.kind {
            // Require multiple variants - single variant enums are still considered problematic
            if enum_type.variants.len() <= 1 {
                return false;
            }

            // Check if all variants have the same size
            let mut variant_sizes = std::collections::HashSet::new();
            for variant in &enum_type.variants {
                match &variant.variant_type {
                    TypeKind::Primitive(prim) => {
                        let size = self.get_primitive_size(prim);
                        variant_sizes.insert(size);
                    }
                    _ => {
                        // For non-primitive types, be conservative
                        return false;
                    }
                }
            }

            // If all variants have the same size, the enum has constant size
            variant_sizes.len() == 1
        } else {
            false
        }
    }

    fn check_array_element_type_size(
        &self,
        array_name: &str,
        array_type: &ArrayType,
        all_typedefs: &[TypeDef],
    ) -> Option<LayoutConstraintViolation> {
        // Check if the element type has a non-constant size due to field references
        if self.type_size_depends_on_field_refs_recursive(&array_type.element_type, all_typedefs) {
            return Some(LayoutConstraintViolation {
                violating_type: array_name.to_string(),
                violating_expression: "array element type".to_string(),
                dependency_chain: vec![array_name.to_string()],
                reason: format!(
                    "Array '{}' has an element type with non-constant size that depends on field references, \
                     making the array's total size impossible to determine",
                    array_name
                ),
            });
        }
        None
    }

    fn type_size_depends_on_field_refs_recursive(
        &self,
        type_kind: &TypeKind,
        all_typedefs: &[TypeDef],
    ) -> bool {
        match type_kind {
            TypeKind::Primitive(_) => false, // Primitives always have constant size
            TypeKind::TypeRef(type_ref) => {
                // Check the referenced type
                if let Some(typedef) = all_typedefs.iter().find(|td| td.name == type_ref.name) {
                    self.type_size_depends_on_field_refs(typedef, all_typedefs)
                } else {
                    false // Unknown type, assume constant for now
                }
            }
            TypeKind::Struct(struct_type) => {
                // A struct's size depends on field refs if any of its fields do
                for field in &struct_type.fields {
                    if self
                        .type_size_depends_on_field_refs_recursive(&field.field_type, all_typedefs)
                    {
                        return true;
                    }
                }
                false
            }
            TypeKind::Union(union_type) => {
                // A union's size depends on field refs if any of its variants do
                for variant in &union_type.variants {
                    if self.type_size_depends_on_field_refs_recursive(
                        &variant.variant_type,
                        all_typedefs,
                    ) {
                        return true;
                    }
                }
                false
            }
            TypeKind::Enum(enum_type) => {
                // Check if tag expression contains field references
                if !enum_type.tag_ref.is_constant() {
                    return true;
                }
                // Also check variant types
                for variant in &enum_type.variants {
                    if self.type_size_depends_on_field_refs_recursive(
                        &variant.variant_type,
                        all_typedefs,
                    ) {
                        return true;
                    }
                }
                false
            }
            TypeKind::Array(array_type) => {
                // Array size depends on field refs if the size expression contains field refs
                if !array_type.size.is_constant() {
                    return true;
                }
                // Also check element type
                self.type_size_depends_on_field_refs_recursive(
                    &array_type.element_type,
                    all_typedefs,
                )
            }
            TypeKind::SizeDiscriminatedUnion(_) => {
                // Size-discriminated unions always have variable size by definition
                true
            }
        }
    }

    fn validate_size_discriminated_union_constraints(
        &mut self,
        union_name: &str,
        size_disc_union: &SizeDiscriminatedUnionType,
        all_typedefs: &[TypeDef],
    ) {
        // Find all types that use this size-discriminated union and validate they follow the constraint:
        // Size-discriminated unions can only be used if they are the sole factor affecting the containing type's size

        for typedef in all_typedefs {
            self.check_size_discriminated_union_usage_in_type(
                union_name,
                &typedef.name,
                &typedef.kind,
                all_typedefs,
            );
        }

        // Also validate that all variants have different sizes (otherwise it should be a regular Union)
        self.validate_size_discriminated_union_variant_sizes(
            union_name,
            size_disc_union,
            all_typedefs,
        );
    }

    fn check_size_discriminated_union_usage_in_type(
        &mut self,
        union_name: &str,
        containing_type: &str,
        type_kind: &TypeKind,
        all_typedefs: &[TypeDef],
    ) {
        match type_kind {
            TypeKind::Struct(struct_type) => {
                // Check if this struct contains the size-discriminated union and validate it's used correctly
                let has_size_disc_union = self.struct_contains_size_discriminated_union(
                    struct_type,
                    union_name,
                    all_typedefs,
                );
                if has_size_disc_union {
                    // Check if the union is the sole size-affecting factor
                    if !self.is_sole_size_affecting_factor_in_struct(
                        struct_type,
                        union_name,
                        all_typedefs,
                    ) {
                        self.graph.add_layout_violation(LayoutConstraintViolation {
              violating_type: containing_type.to_string(),
              violating_expression: format!("contains size-discriminated union: {}", union_name),
              dependency_chain: vec![containing_type.to_string(), union_name.to_string()],
              reason: format!(
                "Struct '{}' contains size-discriminated union '{}' but it is not the sole factor affecting the struct's size. \
                                 Size-discriminated unions can only be used when they are the only variable-size component in their containing type.",
                containing_type, union_name
              ),
            });
                    }
                }
            }
            TypeKind::Array(array_type) => {
                // Arrays cannot contain size-discriminated unions as elements (unless they have constant size)
                if self.type_contains_size_discriminated_union(
                    &array_type.element_type,
                    union_name,
                    all_typedefs,
                ) {
                    self.graph.add_layout_violation(LayoutConstraintViolation {
            violating_type: containing_type.to_string(),
            violating_expression: format!("array element contains size-discriminated union: {}", union_name),
            dependency_chain: vec![containing_type.to_string(), union_name.to_string()],
            reason: format!(
              "Array '{}' has element type containing size-discriminated union '{}'. \
                             Arrays cannot have elements with variable sizes determined by size discrimination.",
              containing_type, union_name
            ),
          });
                }
            }
            TypeKind::Union(_) | TypeKind::Enum(_) => {
                // Regular unions and enums cannot contain size-discriminated unions
                if self.type_contains_size_discriminated_union_recursive(
                    type_kind,
                    union_name,
                    all_typedefs,
                ) {
                    self.graph.add_layout_violation(LayoutConstraintViolation {
            violating_type: containing_type.to_string(),
            violating_expression: format!("contains size-discriminated union: {}", union_name),
            dependency_chain: vec![containing_type.to_string(), union_name.to_string()],
            reason: format!(
              "Type '{}' contains size-discriminated union '{}' but unions/enums cannot contain \
                             size-discriminated unions as they require fixed-size variants for proper layout calculation.",
              containing_type, union_name
            ),
          });
                }
            }
            TypeKind::TypeRef(type_ref) => {
                // Check if this TypeRef points to the size-discriminated union
                if type_ref.name == union_name {
                    // This TypeRef directly references the size-discriminated union
                    // Need to check how this TypeRef is used in its containing context
                    // This will be handled by the parent type's validation
                }
            }
            _ => {} // Primitives and size-discriminated unions themselves don't have constraints
        }
    }

    fn struct_contains_size_discriminated_union(
        &self,
        struct_type: &StructType,
        union_name: &str,
        all_typedefs: &[TypeDef],
    ) -> bool {
        for field in &struct_type.fields {
            if self.type_contains_size_discriminated_union(
                &field.field_type,
                union_name,
                all_typedefs,
            ) {
                return true;
            }
        }
        false
    }

    fn is_sole_size_affecting_factor_in_struct(
        &self,
        struct_type: &StructType,
        union_name: &str,
        all_typedefs: &[TypeDef],
    ) -> bool {
        let mut has_union = false;
        let mut has_other_variable_size_component = false;

        for field in &struct_type.fields {
            if self.type_contains_size_discriminated_union(
                &field.field_type,
                union_name,
                all_typedefs,
            ) {
                has_union = true;
            } else if self.type_has_variable_size(&field.field_type, all_typedefs) {
                has_other_variable_size_component = true;
            }
        }

        has_union && !has_other_variable_size_component
    }

    fn type_contains_size_discriminated_union(
        &self,
        type_kind: &TypeKind,
        union_name: &str,
        all_typedefs: &[TypeDef],
    ) -> bool {
        match type_kind {
            TypeKind::TypeRef(type_ref) => {
                if type_ref.name == union_name {
                    // Check if the referenced type is actually a size-discriminated union
                    if let Some(typedef) = all_typedefs.iter().find(|td| td.name == union_name) {
                        matches!(typedef.kind, TypeKind::SizeDiscriminatedUnion(_))
                    } else {
                        false
                    }
                } else {
                    // Check if the referenced type transitively contains the union
                    if let Some(typedef) = all_typedefs.iter().find(|td| td.name == type_ref.name) {
                        self.type_contains_size_discriminated_union_recursive(
                            &typedef.kind,
                            union_name,
                            all_typedefs,
                        )
                    } else {
                        false
                    }
                }
            }
            _ => self.type_contains_size_discriminated_union_recursive(
                type_kind,
                union_name,
                all_typedefs,
            ),
        }
    }

    fn type_contains_size_discriminated_union_recursive(
        &self,
        type_kind: &TypeKind,
        union_name: &str,
        all_typedefs: &[TypeDef],
    ) -> bool {
        match type_kind {
            TypeKind::Struct(struct_type) => {
                self.struct_contains_size_discriminated_union(struct_type, union_name, all_typedefs)
            }
            TypeKind::Union(union_type) => {
                for variant in &union_type.variants {
                    if self.type_contains_size_discriminated_union(
                        &variant.variant_type,
                        union_name,
                        all_typedefs,
                    ) {
                        return true;
                    }
                }
                false
            }
            TypeKind::Enum(enum_type) => {
                for variant in &enum_type.variants {
                    if self.type_contains_size_discriminated_union(
                        &variant.variant_type,
                        union_name,
                        all_typedefs,
                    ) {
                        return true;
                    }
                }
                false
            }
            TypeKind::Array(array_type) => self.type_contains_size_discriminated_union(
                &array_type.element_type,
                union_name,
                all_typedefs,
            ),
            TypeKind::SizeDiscriminatedUnion(_) => {
                // We're looking for a specific union by name, so this would only match if names are equal
                // but we should have handled that in the TypeRef case
                false
            }
            TypeKind::TypeRef(_type_ref) => {
                self.type_contains_size_discriminated_union(type_kind, union_name, all_typedefs)
            }
            TypeKind::Primitive(_) => false,
        }
    }

    fn type_has_variable_size(&self, type_kind: &TypeKind, all_typedefs: &[TypeDef]) -> bool {
        match type_kind {
            TypeKind::Primitive(_) => false, // Primitives have fixed size
            TypeKind::TypeRef(type_ref) => {
                if let Some(typedef) = all_typedefs.iter().find(|td| td.name == type_ref.name) {
                    self.type_has_variable_size(&typedef.kind, all_typedefs)
                } else {
                    false // Unknown type, assume constant for now
                }
            }
            TypeKind::Struct(struct_type) => {
                // A struct has variable size if any of its fields have variable size
                for field in &struct_type.fields {
                    if self.type_has_variable_size(&field.field_type, all_typedefs) {
                        return true;
                    }
                }
                false
            }
            TypeKind::Union(_) => false, // Regular unions have fixed size (max of all variants)
            TypeKind::SizeDiscriminatedUnion(_) => true, // Size-discriminated unions have variable size by definition
            TypeKind::Enum(enum_type) => {
                // Enums have variable size if their tag is non-constant or variants have different sizes
                if !enum_type.tag_ref.is_constant() {
                    return true;
                }
                // Check if variants have different sizes (simplified check)
                // In a full implementation, we'd calculate actual variant sizes
                false
            }
            TypeKind::Array(array_type) => {
                // Arrays have variable size if their size expression is non-constant
                // or if their element type has variable size
                !array_type.size.is_constant()
                    || self.type_has_variable_size(&array_type.element_type, all_typedefs)
            }
        }
    }

    fn validate_size_discriminated_union_variant_sizes(
        &mut self,
        union_name: &str,
        size_disc_union: &SizeDiscriminatedUnionType,
        _all_typedefs: &[TypeDef],
    ) {
        // Check that all variants have different expected sizes
        let mut sizes = HashSet::new();
        for variant in &size_disc_union.variants {
            if !sizes.insert(variant.expected_size) {
                self.graph.add_layout_violation(LayoutConstraintViolation {
          violating_type: union_name.to_string(),
          violating_expression: format!("variant '{}' has duplicate size: {}", variant.name, variant.expected_size),
          dependency_chain: vec![union_name.to_string(), variant.name.clone()],
          reason: format!(
            "Size-discriminated union '{}' has multiple variants with the same expected size ({}). \
                         All variants must have different sizes for size discrimination to work. \
                         If variants have the same size, use a regular Union instead.",
            union_name, variant.expected_size
          ),
        });
            }
        }

        // Validate that there are at least 2 variants
        if size_disc_union.variants.len() < 2 {
            self.graph.add_layout_violation(LayoutConstraintViolation {
                violating_type: union_name.to_string(),
                violating_expression: "insufficient variants".to_string(),
                dependency_chain: vec![union_name.to_string()],
                reason: format!(
                    "Size-discriminated union '{}' has only {} variant(s). \
                     Size-discriminated unions require at least 2 variants with different sizes.",
                    union_name,
                    size_disc_union.variants.len()
                ),
            });
        }
    }
}

// Include comprehensive tests
#[cfg(test)]
#[path = "dependency_tests.rs"]
mod dependency_tests;
