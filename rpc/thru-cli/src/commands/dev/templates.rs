//! Project templates for initializing new C/C++/Rust projects

use std::collections::HashMap;

/* C Templates - embedded from templates/c/ directory */
pub const GNUMAKEFILE_TEMPLATE: &str = include_str!("../../../templates/c/GNUmakefile");
pub const LOCAL_MK_TEMPLATE: &str = include_str!("../../../templates/c/Local.mk");
pub const PROGRAM_C_TEMPLATE: &str = include_str!("../../../templates/c/program.c");
pub const README_TEMPLATE: &str = include_str!("../../../templates/c/README.md");
pub const GITIGNORE_TEMPLATE: &str = include_str!("../../../templates/c/gitignore");

/// Replace template variables in a string
pub fn replace_template_vars(template: &str, vars: &HashMap<String, String>) -> String {
    let mut result = template.to_string();
    for (key, value) in vars {
        let placeholder = format!("{{{{{}}}}}", key);
        result = result.replace(&placeholder, value);
    }
    result
}

/// Sanitize a project name to create a valid program name
/// Converts to lowercase and replaces non-alphanumeric characters with underscores
pub fn sanitize_program_name(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_replace_template_vars() {
        let template = "Hello {{NAME}}, welcome to {{PLACE}}!";
        let mut vars = HashMap::new();
        vars.insert("NAME".to_string(), "Alice".to_string());
        vars.insert("PLACE".to_string(), "Wonderland".to_string());

        let result = replace_template_vars(template, &vars);
        assert_eq!(result, "Hello Alice, welcome to Wonderland!");
    }

    #[test]
    fn test_sanitize_program_name() {
        assert_eq!(sanitize_program_name("MyProgram"), "myprogram");
        assert_eq!(sanitize_program_name("my-program"), "my_program");
        assert_eq!(sanitize_program_name("my_program_v2"), "my_program_v2");
        assert_eq!(sanitize_program_name("Hello World!"), "hello_world_");
    }

    #[test]
    fn test_templates_are_loaded() {
        /* Verify that templates are actually embedded */
        assert!(!GNUMAKEFILE_TEMPLATE.is_empty());
        assert!(!LOCAL_MK_TEMPLATE.is_empty());
        assert!(!PROGRAM_C_TEMPLATE.is_empty());
        assert!(!README_TEMPLATE.is_empty());
        assert!(!GITIGNORE_TEMPLATE.is_empty());

        /* Verify they contain expected placeholders */
        assert!(GNUMAKEFILE_TEMPLATE.contains("{{PROJECT_NAME}}"));
        assert!(LOCAL_MK_TEMPLATE.contains("{{PROGRAM_NAME}}"));
        assert!(PROGRAM_C_TEMPLATE.contains("{{PROJECT_NAME}}"));
        assert!(README_TEMPLATE.contains("{{PROJECT_NAME}}"));
    }
}
