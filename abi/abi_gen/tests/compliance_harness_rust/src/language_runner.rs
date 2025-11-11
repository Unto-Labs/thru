use anyhow::Result;
use std::path::Path;

use crate::{TestCaseData, TestResult};

pub trait LanguageRunner {
    #[allow(dead_code)]
    fn language_name(&self) -> &str;
    fn codegen_language_param(&self) -> &str;
    fn run_test(
        &self,
        test_name: &str,
        test_file: &str,
        test_case: &TestCaseData,
        abi_file_path: &Path,
        binary_data: &[u8],
        verbose: bool,
        no_cleanup: bool,
        temp_dir: Option<&Path>,
    ) -> Result<TestResult>;
}

pub mod rust;
pub mod c;
pub mod typescript;

pub use self::rust::RustRunner;
pub use c::CRunner;
pub use typescript::TypeScriptRunner;

/* Get runner for specified language */
pub fn get_runner(language: &str) -> Option<Box<dyn LanguageRunner>> {
    match language.to_lowercase().as_str() {
        "rust" => Some(Box::new(RustRunner)),
        "c" => Some(Box::new(CRunner)),
        "typescript" | "ts" => Some(Box::new(TypeScriptRunner)),
        _ => None,
    }
}
