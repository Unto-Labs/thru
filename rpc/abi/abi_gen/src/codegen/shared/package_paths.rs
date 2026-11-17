/* Output paths of the ABI packages of one codegen run.

Package `a.b.c` is written to `a/b/c` (one directory per segment). Two
packages must never share a directory or module, also on a case-insensitive
file system (`cases.Foo`, `cases.foo`), and no package may take a path the
backend writes itself (Go's `tnabi/`, Rust's `tn_abi_runtime.rs`). The rule,
the same for every backend: segments are mapped through the backend's
`segment` function; packages are taken in sorted order and each directory
level is allocated once per (parent, segment), so packages sharing a prefix
share its directories; a name already used at that level (compared ignoring
case) or reserved there gets `_` appended (`cases.foo` -> `cases/foo_`). The
result depends only on the set of packages, so every package of a run (and
every importer) derives the same paths. */

use std::collections::{BTreeMap, HashMap, HashSet};

/* Per-backend path rules. */
pub struct PathRules<'r> {
    /* A package-name segment as a directory / module name. */
    pub segment: fn(&str) -> String,
    /* Names a package may not take at the output root. */
    pub root_reserved: &'r [&'r str],
    /* Names a package may not take below the root. */
    pub child_reserved: &'r [&'r str],
}

/* Allocated path segments of every package. */
pub fn package_paths<'p>(
    packages: impl IntoIterator<Item = &'p String>,
    rules: &PathRules<'_>,
) -> BTreeMap<String, Vec<String>> {
    let mut ps: Vec<&String> = packages.into_iter().collect();
    ps.sort();
    ps.dedup();
    /* (allocated parent path, original segment) -> allocated segment */
    let mut memo: HashMap<(Vec<String>, String), String> = HashMap::new();
    /* allocated parent path -> names taken below it (lower case) */
    let mut taken: HashMap<Vec<String>, HashSet<String>> = HashMap::new();
    let mut out = BTreeMap::new();
    for p in ps {
        let mut path: Vec<String> = Vec::new();
        for seg in p.split('.') {
            let key = (path.clone(), seg.to_string());
            let name = match memo.get(&key) {
                Some(n) => n.clone(),
                None => {
                    let used = taken.entry(path.clone()).or_insert_with(|| {
                        let reserved = if path.is_empty() {
                            rules.root_reserved
                        } else {
                            rules.child_reserved
                        };
                        reserved.iter().map(|r| r.to_ascii_lowercase()).collect()
                    });
                    let mut n = (rules.segment)(seg);
                    while used.contains(&n.to_ascii_lowercase()) {
                        n.push('_');
                    }
                    used.insert(n.to_ascii_lowercase());
                    memo.insert(key, n.clone());
                    n
                }
            };
            path.push(name);
        }
        out.insert(p.clone(), path);
    }
    out
}

/* Relative path from the directory of `from` to that of `to` (`../../x/y`). */
pub fn relative_path(from: &[String], to: &[String]) -> String {
    let common = from.iter().zip(to).take_while(|(a, b)| a == b).count();
    let mut parts: Vec<&str> = vec![".."; from.len() - common];
    parts.extend(to[common..].iter().map(|s| s.as_str()));
    parts.join("/")
}
