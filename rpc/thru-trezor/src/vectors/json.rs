//! A JSON tree that keeps the order its keys were added in, and writes it
//! the same way every time (two-space indent, one array element per line,
//! a final newline).
//!
//! `serde_json::Value` is not used for the file: its key order depends on
//! whether any crate in the build turns on `preserve_order`.

/// A JSON value.
#[derive(Clone, Debug)]
pub(super) enum J {
    Bool(bool),
    Num(i64),
    Str(String),
    Arr(Vec<J>),
    Obj(Vec<(String, J)>),
}

impl J {
    pub(super) fn str(text: impl Into<String>) -> J {
        J::Str(text.into())
    }

    pub(super) fn hex(bytes: impl AsRef<[u8]>) -> J {
        J::Str(hex::encode(bytes))
    }

    pub(super) fn num(n: impl TryInto<i64>) -> J {
        J::Num(
            n.try_into()
                .unwrap_or_else(|_| panic!("number out of range")),
        )
    }

    pub(super) fn arr(items: impl IntoIterator<Item = J>) -> J {
        J::Arr(items.into_iter().collect())
    }

    /// Writes the document with a final newline.
    pub(super) fn to_text(&self) -> String {
        let mut out = String::new();
        self.write(&mut out, 0);
        out.push('\n');
        out
    }

    fn write(&self, out: &mut String, depth: usize) {
        match self {
            J::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
            J::Num(n) => out.push_str(&n.to_string()),
            J::Str(s) => out.push_str(&serde_json::to_string(s).expect("string")),
            J::Arr(items) if items.is_empty() => out.push_str("[]"),
            J::Arr(items) => {
                out.push_str("[\n");
                for (i, item) in items.iter().enumerate() {
                    indent(out, depth + 1);
                    item.write(out, depth + 1);
                    out.push_str(if i + 1 < items.len() { ",\n" } else { "\n" });
                }
                indent(out, depth);
                out.push(']');
            }
            J::Obj(entries) if entries.is_empty() => out.push_str("{}"),
            J::Obj(entries) => {
                out.push_str("{\n");
                for (i, (key, value)) in entries.iter().enumerate() {
                    indent(out, depth + 1);
                    out.push_str(&serde_json::to_string(key).expect("key"));
                    out.push_str(": ");
                    value.write(out, depth + 1);
                    out.push_str(if i + 1 < entries.len() { ",\n" } else { "\n" });
                }
                indent(out, depth);
                out.push('}');
            }
        }
    }
}

fn indent(out: &mut String, depth: usize) {
    for _ in 0..depth {
        out.push_str("  ");
    }
}

/// An object from `(key, value)` pairs, in the order given.
pub(super) fn obj<const N: usize>(entries: [(&str, J); N]) -> J {
    J::Obj(
        entries
            .into_iter()
            .map(|(k, v)| (k.to_owned(), v))
            .collect(),
    )
}

/// An object built up key by key.
#[derive(Default)]
pub(super) struct Fields(Vec<(String, J)>);

impl Fields {
    pub(super) fn new() -> Self {
        Self::default()
    }

    pub(super) fn put(mut self, key: &str, value: J) -> Self {
        self.0.push((key.to_owned(), value));
        self
    }

    pub(super) fn done(self) -> J {
        J::Obj(self.0)
    }
}
