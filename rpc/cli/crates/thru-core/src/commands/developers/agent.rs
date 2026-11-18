//! `thru auth keys create --agent <client>`: installs the approved key into
//! the agent client's MCP configuration, so the secret never appears in the
//! command's output (which the agent reads), and installs the Thru skill.
//!
//! Config files are edited in place: other entries are kept, the previous
//! file is copied to `<file>.bak`, and the new file replaces the old one
//! atomically (temporary file, then rename).
use super::{failure, storage};
use crate::error::CliError;
use serde_json::{Map, Value, json};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Output,
    time::Duration,
};
use url::{Host, Url};

/// MCP endpoint the key is installed for, unless [`MCP_URL_ENV`] is set.
pub(super) const DEFAULT_MCP_URL: &str = "https://mcp.thru.org/mcp";
/// Overrides [`DEFAULT_MCP_URL`], for testing against another deployment.
pub(super) const MCP_URL_ENV: &str = "THRU_MCP_URL";
/// Source of the Thru skill for `npx skills add`.
pub(super) const SKILL_SOURCE: &str = "https://thru.org";
/// Name of the MCP server entry in every client's configuration.
const SERVER_NAME: &str = "thru";
/// Environment variable Codex reads the bearer token from. Not
/// `THRU_API_KEY`, which the `thru` CLI itself sends to RPC: exporting the
/// agent key there would charge the user's own CLI calls to the agent key.
pub(super) const CODEX_KEY_ENV: &str = "THRU_MCP_API_KEY";
/// Longest key name Thru Developers accepts.
const MAX_KEY_NAME_LEN: usize = 64;
/// Largest client config file the CLI rewrites.
const MAX_CONFIG_LEN: u64 = 4 * 1024 * 1024;
pub(super) const RELOAD_HINT: &str =
    "Reload MCP servers (start a new session) to use the thru tools.";

/// Whether `client` is a valid `--agent` label: 1-32 lowercase ASCII letters,
/// digits or `-`, starting with a letter or digit (`^[a-z0-9][a-z0-9-]{0,31}$`).
pub fn valid_agent_client(client: &str) -> bool {
    let bytes = client.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 32
        && (bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit())
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
}

/// Agent clients the CLI can install a key into.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum KnownClient {
    ClaudeCode,
    Codex,
    Cursor,
    VsCode,
}

impl KnownClient {
    pub(super) fn from_label(label: &str) -> Option<Self> {
        match label {
            "claude-code" => Some(Self::ClaudeCode),
            "codex" => Some(Self::Codex),
            "cursor" => Some(Self::Cursor),
            "vscode" => Some(Self::VsCode),
            _ => None,
        }
    }

    pub(super) fn label(self) -> &'static str {
        match self {
            Self::ClaudeCode => "claude-code",
            Self::Codex => "codex",
            Self::Cursor => "cursor",
            Self::VsCode => "vscode",
        }
    }

    /// The client's id in `npx skills add --agent`.
    fn skills_agent(self) -> &'static str {
        match self {
            Self::ClaudeCode => "claude-code",
            Self::Codex => "codex",
            Self::Cursor => "cursor",
            Self::VsCode => "github-copilot",
        }
    }
}

/// Key name used when `--agent` is given without `--name`:
/// `agent-<client>-<machine>`, cut to the server's 64-character limit.
pub(super) fn default_key_name(client: &str, machine: &str) -> String {
    let name: String = format!("agent-{client}-{machine}")
        .chars()
        .take(MAX_KEY_NAME_LEN)
        .collect();
    let name = name.trim_end().trim_end_matches('-');
    name.to_owned()
}

/// The MCP URL: [`MCP_URL_ENV`] if set, else [`DEFAULT_MCP_URL`].
pub(super) fn mcp_url() -> Result<String, CliError> {
    match std::env::var(MCP_URL_ENV) {
        Ok(value) => parse_mcp_url(&value),
        Err(std::env::VarError::NotPresent) => Ok(DEFAULT_MCP_URL.to_owned()),
        Err(_) => Err(invalid_mcp_url()),
    }
}

fn invalid_mcp_url() -> CliError {
    failure(
        "INVALID_MCP_URL",
        "THRU_MCP_URL must be an HTTPS URL (or HTTP on loopback) without userinfo, query or fragment",
        None,
    )
}

/// Accepts an HTTPS URL, or HTTP on loopback, without userinfo, query or
/// fragment.
pub(super) fn parse_mcp_url(value: &str) -> Result<String, CliError> {
    let url = Url::parse(value.trim()).map_err(|_| invalid_mcp_url())?;
    let loopback = match url.host() {
        Some(Host::Domain("localhost")) => true,
        Some(Host::Ipv4(address)) => address.is_loopback(),
        Some(Host::Ipv6(address)) => address.is_loopback(),
        _ => false,
    };
    if !(url.scheme() == "https" || (url.scheme() == "http" && loopback))
        || url.host().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(invalid_mcp_url());
    }
    Ok(url.to_string())
}

fn install_error(message: impl Into<String>) -> CliError {
    CliError::Developers {
        code: "MCP_INSTALL_FAILED".into(),
        message: message.into(),
        status: None,
        retry_after: None,
        signature: None,
    }
}

/// Quotes `text` for a POSIX shell command the user copies.
fn shell_quote(text: &str) -> String {
    if !text.is_empty()
        && text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"/._-:@%+=,".contains(&b))
    {
        return text.to_owned();
    }
    format!("'{}'", text.replace('\'', r"'\''"))
}

/// `(program, args)` as one copyable shell line.
fn command_line(program: &str, args: &[String]) -> String {
    std::iter::once(program.to_owned())
        .chain(args.iter().map(|arg| shell_quote(arg)))
        .collect::<Vec<_>>()
        .join(" ")
}

// ---------------------------------------------------------------------------
// Config edits
// ---------------------------------------------------------------------------

/// `existing` (a JSON object, or nothing) with `<section>.thru = entry`.
/// Other entries keep their order; an existing `thru` entry is replaced.
/// Fails, without guessing, on text that is not a JSON object (for example
/// JSON with comments).
pub(super) fn upsert_json_server(
    existing: Option<&str>,
    section: &str,
    entry: Value,
) -> Result<String, CliError> {
    let mut root = match existing.filter(|text| !text.trim().is_empty()) {
        None => Value::Object(Map::new()),
        Some(text) => serde_json::from_str::<Value>(text).map_err(|_| {
            install_error(
                "the file is not plain JSON (comments and trailing commas are not supported)",
            )
        })?,
    };
    let Value::Object(object) = &mut root else {
        return Err(install_error("the file does not hold a JSON object"));
    };
    let servers = object
        .entry(section)
        .or_insert_with(|| Value::Object(Map::new()));
    let Value::Object(servers) = servers else {
        return Err(install_error(format!("\"{section}\" is not a JSON object")));
    };
    servers.insert(SERVER_NAME.to_owned(), entry);
    let mut text = serde_json::to_string_pretty(&root)
        .map_err(|_| install_error("could not serialize the configuration"))?;
    text.push('\n');
    Ok(text)
}

/// Cursor's `mcpServers.thru` entry.
pub(super) fn cursor_entry(url: &str, key: &str) -> Value {
    json!({"url": url, "headers": {"Authorization": format!("Bearer {key}")}})
}

/// VS Code's `servers.thru` entry.
pub(super) fn vscode_entry(url: &str, key: &str) -> Value {
    json!({"type": "http", "url": url, "headers": {"Authorization": format!("Bearer {key}")}})
}

/// Keys of a TOML table header line (`[a.b]` or `[[a.b]]`), unquoted.
/// `None` for any other line.
fn toml_header(line: &str) -> Option<Vec<String>> {
    let line = line.trim_start();
    let inner = if let Some(rest) = line.strip_prefix("[[") {
        &rest[..rest.find("]]")?]
    } else {
        let rest = line.strip_prefix('[')?;
        &rest[..rest.find(']')?]
    };
    let mut keys = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    for c in inner.chars() {
        match (quote, c) {
            (Some(open), c) if c == open => quote = None,
            (Some(_), c) => current.push(c),
            (None, '"' | '\'') => quote = Some(c),
            (None, '.') => keys.push(std::mem::take(&mut current).trim().to_owned()),
            (None, c) if c.is_whitespace() => {}
            (None, c) => current.push(c),
        }
    }
    keys.push(current.trim().to_owned());
    Some(keys)
}

fn is_thru_header(keys: &[String]) -> bool {
    keys.len() >= 2 && keys[0] == "mcp_servers" && keys[1] == SERVER_NAME
}

fn parse_toml(text: &str) -> Result<toml::Table, CliError> {
    text.parse::<toml::Table>()
        .map_err(|_| install_error("the file is not valid TOML"))
}

/// `table` without `mcp_servers.thru`, and without `mcp_servers` when that
/// leaves it empty, for comparing the rest of a config.
fn without_thru(mut table: toml::Table) -> toml::Table {
    if let Some(toml::Value::Table(servers)) = table.get_mut("mcp_servers") {
        servers.remove(SERVER_NAME);
        if servers.is_empty() {
            table.remove("mcp_servers");
        }
    }
    table
}

/// `existing` Codex config with `[mcp_servers.thru]` set to read a bearer
/// token for `url` from [`CODEX_KEY_ENV`]. The text is edited in place, so
/// comments and formatting elsewhere are kept: the old `[mcp_servers.thru]`
/// table and its sub-tables are removed and the new table is appended. The
/// result is checked by parsing: everything else must be unchanged, so a
/// `thru` entry defined some other way (inline or dotted keys) is refused
/// rather than guessed at.
pub(super) fn upsert_codex_toml(existing: Option<&str>, url: &str) -> Result<String, CliError> {
    let existing = existing.unwrap_or("");
    let before = without_thru(parse_toml(existing)?);
    let mut kept = String::with_capacity(existing.len());
    let mut skipping = false;
    for line in existing.split_inclusive('\n') {
        if let Some(keys) = toml_header(line) {
            skipping = is_thru_header(&keys);
        }
        if !skipping {
            kept.push_str(line);
        }
    }
    let stripped = parse_toml(&kept)?;
    let thru_left = matches!(
        stripped.get("mcp_servers"),
        Some(toml::Value::Table(servers)) if servers.contains_key(SERVER_NAME)
    );
    if thru_left {
        return Err(install_error(
            "the file defines mcp_servers.thru outside a [mcp_servers.thru] table; remove that entry and run the command again",
        ));
    }
    let section = format!(
        "[mcp_servers.{SERVER_NAME}]\nurl = {}\nbearer_token_env_var = {}\n",
        toml::Value::String(url.to_owned()),
        toml::Value::String(CODEX_KEY_ENV.to_owned()),
    );
    let kept = kept.trim_end();
    let result = if kept.is_empty() {
        section
    } else {
        format!("{kept}\n\n{section}")
    };
    let after = parse_toml(&result)?;
    let expected = toml::Value::Table(toml::Table::from_iter([
        ("url".to_owned(), toml::Value::String(url.to_owned())),
        (
            "bearer_token_env_var".to_owned(),
            toml::Value::String(CODEX_KEY_ENV.to_owned()),
        ),
    ]));
    let installed = after
        .get("mcp_servers")
        .and_then(|servers| servers.get(SERVER_NAME));
    if installed != Some(&expected) || without_thru(after) != before {
        return Err(install_error(
            "the file's layout could not be edited safely; add [mcp_servers.thru] by hand",
        ));
    }
    Ok(result)
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/// Result of [`rewrite_config`].
#[derive(Debug)]
pub(super) struct Rewritten {
    /// File that was written (the symlink target when the path is a link).
    pub path: PathBuf,
    /// Copy of the previous contents, when the file existed.
    pub backup: Option<PathBuf>,
}

/// Rewrites `path` with `edit(previous contents)`. A new file gets mode 0600
/// and an existing one keeps its mode; the previous contents are copied to
/// `<file>.bak` (0600) first; the new contents are written to a temporary
/// file in the same directory and renamed over the old one, so the file is
/// never half-written. A symlink is followed, so the link itself survives.
pub(super) fn rewrite_config(
    path: &Path,
    edit: impl FnOnce(Option<&str>) -> Result<String, CliError>,
) -> Result<Rewritten, CliError> {
    let path = match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => fs::canonicalize(path)
            .map_err(|_| install_error(format!("{} is a broken symlink", path.display())))?,
        _ => path.to_owned(),
    };
    let existing = match fs::metadata(&path) {
        Ok(meta) if !meta.is_file() => {
            return Err(install_error(format!(
                "{} is not a regular file",
                path.display()
            )));
        }
        Ok(meta) if meta.len() > MAX_CONFIG_LEN => {
            return Err(install_error(format!("{} is too large", path.display())));
        }
        Ok(meta) => {
            let text = fs::read_to_string(&path).map_err(|_| {
                install_error(format!("could not read {} as UTF-8 text", path.display()))
            })?;
            Some((text, meta.permissions()))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(_) => {
            return Err(install_error(format!(
                "could not inspect {}",
                path.display()
            )));
        }
    };
    let updated =
        edit(existing.as_ref().map(|(text, _)| text.as_str())).map_err(|error| match error {
            CliError::Developers { message, .. } => {
                install_error(format!("could not update {}: {message}", path.display()))
            }
            error => error,
        })?;
    let directory = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(Path::new("."))
        .to_owned();
    fs::create_dir_all(&directory)
        .map_err(|_| install_error(format!("could not create {}", directory.display())))?;
    let backup = match &existing {
        Some((text, _)) => {
            let mut name = path.file_name().unwrap_or_default().to_os_string();
            name.push(".bak");
            let backup = path.with_file_name(name);
            write_atomic(&directory, &backup, text.as_bytes(), None)?;
            Some(backup)
        }
        None => None,
    };
    write_atomic(
        &directory,
        &path,
        updated.as_bytes(),
        existing.map(|(_, permissions)| permissions),
    )?;
    Ok(Rewritten { path, backup })
}

/// Writes `raw` to a temporary file in `directory`, then renames it to
/// `path`. On Unix the file is owner-only: `permissions` keeps only its owner
/// read/write bits, else 0600, because the file may hold a key. A symlink at
/// `path` is replaced, not followed (callers resolve links).
fn write_atomic(
    directory: &Path,
    path: &Path,
    raw: &[u8],
    permissions: Option<fs::Permissions>,
) -> Result<(), CliError> {
    let failed = || install_error(format!("could not write {}", path.display()));
    let temporary = directory.join(format!(
        ".{}.thru-{:016x}.tmp",
        path.file_name().unwrap_or_default().to_string_lossy(),
        rand::random::<u64>()
    ));
    let result = (|| {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary).map_err(|_| failed())?;
        file.write_all(raw).map_err(|_| failed())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = permissions
                .as_ref()
                .map(|permissions| permissions.mode() & 0o600)
                .unwrap_or(0o600);
            file.set_permissions(fs::Permissions::from_mode(mode))
                .map_err(|_| failed())?;
        }
        #[cfg(not(unix))]
        if let Some(permissions) = &permissions {
            file.set_permissions(permissions.clone())
                .map_err(|_| failed())?;
        }
        file.sync_all().map_err(|_| failed())?;
        drop(file);
        fs::rename(&temporary, path).map_err(|_| failed())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

/// Saves `secret` to `<key_dir>/<client>.key`, owner-only, and returns the
/// path.
pub(super) fn save_key_file(
    key_dir: &Path,
    client: &str,
    secret: &str,
) -> Result<PathBuf, CliError> {
    storage::ensure_private_dir(key_dir)?;
    let path = key_dir.join(format!("{client}.key"));
    super::write_owner_only_file(key_dir, &path, secret.as_bytes())?;
    Ok(path)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Runs external programs. Tests substitute a fake.
pub(super) trait Runner {
    /// Runs `program` with `args` (no shell), stdin closed, output captured.
    /// `Err` with `NotFound` when the program is not installed.
    fn run(
        &self,
        program: &str,
        args: &[String],
        timeout: Duration,
    ) -> impl std::future::Future<Output = std::io::Result<Output>>;
}

pub(super) struct SystemRunner;

/// The working directory for `claude` and `npx`: an owner-only
/// `~/.thru/cli/run`, not the caller's directory. Run inside an untrusted
/// checkout, `npx` would otherwise pick up that project's own `skills`
/// binary or `.npmrc` right after the key is saved. Falls back to the home
/// directory, and to the inherited directory only when there is no home.
fn trusted_working_dir() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let run = home.join(".thru").join("cli").join("run");
    Some(if storage::ensure_private_dir(&run).is_ok() {
        run
    } else {
        home
    })
}

impl Runner for SystemRunner {
    async fn run(
        &self,
        program: &str,
        args: &[String],
        timeout: Duration,
    ) -> std::io::Result<Output> {
        // Windows finds `.exe` files on PATH but not npm's `.cmd` shims.
        let candidates: Vec<String> = if cfg!(windows) {
            vec![program.to_owned(), format!("{program}.cmd")]
        } else {
            vec![program.to_owned()]
        };
        let directory = trusted_working_dir();
        let mut last = std::io::Error::from(std::io::ErrorKind::NotFound);
        for candidate in candidates {
            let mut command = tokio::process::Command::new(&candidate);
            if let Some(directory) = &directory {
                command.current_dir(directory);
            }
            let child = command
                .args(args)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .kill_on_drop(true)
                .spawn();
            match child {
                Ok(child) => {
                    return match tokio::time::timeout(timeout, child.wait_with_output()).await {
                        Ok(output) => output,
                        Err(_) => Err(std::io::Error::new(
                            std::io::ErrorKind::TimedOut,
                            "timed out",
                        )),
                    };
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => last = error,
                Err(error) => return Err(error),
            }
        }
        Err(last)
    }
}

/// The last lines of a failed command's output, with `secret` removed.
fn failure_detail(output: &Output, secret: &str) -> String {
    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stderr),
        String::from_utf8_lossy(&output.stdout)
    );
    let text = if secret.is_empty() {
        text
    } else {
        text.replace(secret, "<redacted>")
    };
    let lines: Vec<&str> = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    let tail = lines[lines.len().saturating_sub(3)..].join(" / ");
    let tail: String = tail.chars().filter(|c| !c.is_control()).take(400).collect();
    if tail.is_empty() {
        format!("exit status {}", output.status)
    } else {
        tail
    }
}

/// Where a known client's configuration lives on this machine.
pub(super) struct InstallPaths {
    /// Codex config directory: `$CODEX_HOME` or `~/.codex`.
    pub codex_home: PathBuf,
    /// `~/.cursor`.
    pub cursor_dir: PathBuf,
    /// VS Code's user settings directory, when the platform has one.
    pub vscode_user_dir: Option<PathBuf>,
    /// Owner-only directory for key files: `~/.thru/cli/agent-keys`.
    pub key_dir: PathBuf,
}

impl InstallPaths {
    pub(super) fn configured() -> Result<Self, CliError> {
        let home =
            dirs::home_dir().ok_or_else(|| install_error("could not find the home directory"))?;
        let codex_home = std::env::var_os("CODEX_HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".codex"));
        // macOS: ~/Library/Application Support, Linux: ~/.config (or
        // $XDG_CONFIG_HOME), Windows: %APPDATA%.
        let vscode_user_dir = dirs::config_dir().map(|dir| dir.join("Code").join("User"));
        Ok(Self {
            codex_home,
            cursor_dir: home.join(".cursor"),
            vscode_user_dir,
            key_dir: crate::config::Config::get_config_dir()?.join("agent-keys"),
        })
    }
}

/// What installing the key did, as reported in the command's output. Never
/// contains the secret.
#[derive(Debug, PartialEq)]
pub(super) struct Installation {
    pub client: &'static str,
    /// `installed`, or `manual` when the user must finish the setup.
    pub status: &'static str,
    /// File or command that was updated.
    pub updated: Option<String>,
    pub backup: Option<PathBuf>,
    /// Owner-only file holding the key, when one was written.
    pub key_file: Option<PathBuf>,
    /// Why the install could not finish (`manual` only).
    pub reason: Option<String>,
    pub next_steps: Vec<String>,
}

impl Installation {
    pub(super) fn to_json(&self) -> Value {
        json!({
            "client": self.client,
            "status": self.status,
            "updated": self.updated,
            "backup": self.backup.as_ref().map(|path| path.display().to_string()),
            "key_file": self.key_file.as_ref().map(|path| path.display().to_string()),
            "reason": self.reason,
            "next_steps": self.next_steps,
        })
    }
}

/// Installs `secret` for `client`. On any failure the key is saved to an
/// owner-only file instead and the result says how to finish by hand; the
/// error is only returned when even that file cannot be written.
pub(super) async fn install<R: Runner>(
    runner: &R,
    paths: &InstallPaths,
    client: KnownClient,
    url: &str,
    secret: &str,
) -> Result<Installation, CliError> {
    match client {
        KnownClient::ClaudeCode => install_claude_code(runner, paths, url, secret).await,
        KnownClient::Codex => install_codex(paths, url, secret),
        KnownClient::Cursor => install_json(
            client,
            &paths.cursor_dir.join("mcp.json"),
            paths,
            "mcpServers",
            (url, cursor_entry(url, secret)),
            secret,
        ),
        KnownClient::VsCode => match &paths.vscode_user_dir {
            Some(dir) => install_json(
                client,
                &dir.join("mcp.json"),
                paths,
                "servers",
                (url, vscode_entry(url, secret)),
                secret,
            ),
            None => manual(
                client,
                paths,
                secret,
                "VS Code's user settings directory is unknown on this platform".into(),
                |file| {
                    vec![format!(
                        "Add to servers in VS Code's user mcp.json (MCP: Open User Configuration): \"thru\": {{\"type\": \"http\", \"url\": \"{url}\", \"headers\": {{\"Authorization\": \"Bearer <contents of {}>\"}}}}",
                        file.display()
                    )]
                },
            ),
        },
    }
}

/// The fallback: saves the key to a file and returns `next_steps(file)`.
fn manual(
    client: KnownClient,
    paths: &InstallPaths,
    secret: &str,
    reason: String,
    next_steps: impl FnOnce(&Path) -> Vec<String>,
) -> Result<Installation, CliError> {
    let file = save_key_file(&paths.key_dir, client.label(), secret)?;
    let mut steps = next_steps(&file);
    steps.push(RELOAD_HINT.into());
    Ok(Installation {
        client: client.label(),
        status: "manual",
        updated: None,
        backup: None,
        key_file: Some(file),
        reason: Some(reason),
        next_steps: steps,
    })
}

const CLAUDE_TIMEOUT: Duration = Duration::from_secs(60);

fn claude_add_args(url: &str, header: &str) -> Vec<String> {
    [
        "mcp",
        "add",
        "--scope",
        "user",
        "--transport",
        "http",
        SERVER_NAME,
        url,
        "--header",
        header,
    ]
    .map(str::to_owned)
    .to_vec()
}

async fn install_claude_code<R: Runner>(
    runner: &R,
    paths: &InstallPaths,
    url: &str,
    secret: &str,
) -> Result<Installation, CliError> {
    let add = claude_add_args(url, &format!("Authorization: Bearer {secret}"));
    let mut result = runner.run("claude", &add, CLAUDE_TIMEOUT).await;
    // Re-running replaces the previous entry: `claude mcp add` refuses an
    // existing name, so the old entry is removed and the add retried once.
    if let Ok(output) = &result
        && !output.status.success()
        && failure_detail(output, secret).contains("already exists")
    {
        let remove = ["mcp", "remove", "--scope", "user", SERVER_NAME].map(str::to_owned);
        if runner
            .run("claude", &remove, CLAUDE_TIMEOUT)
            .await
            .is_ok_and(|output| output.status.success())
        {
            result = runner.run("claude", &add, CLAUDE_TIMEOUT).await;
        }
    }
    let reason = match result {
        Ok(output) if output.status.success() => {
            return Ok(Installation {
                client: KnownClient::ClaudeCode.label(),
                status: "installed",
                updated: Some(command_line(
                    "claude",
                    &claude_add_args(url, "Authorization: Bearer <key>"),
                )),
                backup: None,
                key_file: None,
                reason: None,
                next_steps: vec![RELOAD_HINT.into()],
            });
        }
        Ok(output) => format!(
            "`claude mcp add` failed: {}",
            failure_detail(&output, secret)
        ),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            "the `claude` command is not on PATH".into()
        }
        Err(error) if error.kind() == std::io::ErrorKind::TimedOut => {
            "`claude mcp add` timed out".into()
        }
        Err(_) => "`claude mcp add` could not be run".into(),
    };
    manual(KnownClient::ClaudeCode, paths, secret, reason, |file| {
        let args = claude_add_args(url, "HEADER");
        let line = command_line("claude", &args).replace(
            "HEADER",
            &format!(
                "\"Authorization: Bearer $(cat {})\"",
                shell_quote(&file.display().to_string())
            ),
        );
        vec![format!("Run: {line}")]
    })
}

fn install_codex(paths: &InstallPaths, url: &str, secret: &str) -> Result<Installation, CliError> {
    let client = KnownClient::Codex;
    let config = paths.codex_home.join("config.toml");
    let export = |file: &Path| {
        format!(
            "Add to your shell profile, then start Codex from a new shell: export {CODEX_KEY_ENV}=\"$(cat {})\"",
            shell_quote(&file.display().to_string())
        )
    };
    match rewrite_config(&config, |existing| upsert_codex_toml(existing, url)) {
        Ok(rewritten) => {
            let file = save_key_file(&paths.key_dir, client.label(), secret)?;
            Ok(Installation {
                client: client.label(),
                status: "installed",
                updated: Some(rewritten.path.display().to_string()),
                backup: rewritten.backup,
                next_steps: vec![export(&file), RELOAD_HINT.into()],
                key_file: Some(file),
                reason: None,
            })
        }
        Err(error) => manual(client, paths, secret, error_message(&error), |file| {
            vec![
                format!(
                    "Add to {}: [mcp_servers.thru] url = \"{url}\" bearer_token_env_var = \"{CODEX_KEY_ENV}\"",
                    config.display()
                ),
                export(file),
            ]
        }),
    }
}

fn install_json(
    client: KnownClient,
    config: &Path,
    paths: &InstallPaths,
    section: &str,
    (url, entry): (&str, Value),
    secret: &str,
) -> Result<Installation, CliError> {
    match rewrite_config(config, |existing| {
        upsert_json_server(existing, section, entry)
    }) {
        Ok(rewritten) => {
            let next_steps = vec![RELOAD_HINT.into()];
            Ok(Installation {
                client: client.label(),
                status: "installed",
                updated: Some(rewritten.path.display().to_string()),
                backup: rewritten.backup,
                key_file: None,
                reason: None,
                next_steps,
            })
        }
        Err(error) => manual(client, paths, secret, error_message(&error), |file| {
            vec![format!(
                "Add to {section} in {}: \"thru\": {{\"url\": \"{}\", \"headers\": {{\"Authorization\": \"Bearer <contents of {}>\"}}}}",
                config.display(),
                url,
                file.display()
            )]
        }),
    }
}

pub(super) fn error_message(error: &CliError) -> String {
    match error {
        CliError::Developers { message, .. } => message.clone(),
        error => error.to_string(),
    }
}

/// `npx skills add` arguments for `client` (`None`: let the tool detect it).
pub(super) fn skill_args(client: Option<KnownClient>) -> Vec<String> {
    let mut args: Vec<String> = ["--yes", "skills", "add", SKILL_SOURCE, "--global", "--yes"]
        .map(str::to_owned)
        .to_vec();
    if let Some(client) = client {
        args.extend(["--agent".to_owned(), client.skills_agent().to_owned()]);
    }
    args
}

const SKILL_TIMEOUT: Duration = Duration::from_secs(180);

/// Installs the Thru skill with `npx skills add`. Never fails: when npx is
/// missing or the command fails, the result holds the command to run.
pub(super) async fn install_skill<R: Runner>(runner: &R, client: Option<KnownClient>) -> Value {
    let args = skill_args(client);
    // What the user runs by hand: without npx's own `--yes`.
    let command = command_line("npx", &args[1..]);
    let reason = match runner.run("npx", &args, SKILL_TIMEOUT).await {
        Ok(output) if output.status.success() => {
            return json!({"status": "installed", "command": command});
        }
        Ok(output) => format!("the command failed: {}", failure_detail(&output, "")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            "npx is not on PATH (install Node.js)".into()
        }
        Err(error) if error.kind() == std::io::ErrorKind::TimedOut => {
            "the command timed out".into()
        }
        Err(_) => "the command could not be run".into(),
    };
    json!({"status": "manual", "command": command, "reason": reason})
}

#[cfg(test)]
mod tests {
    use super::*;

    const URL: &str = "https://mcp.example/mcp";

    #[test]
    fn agent_clients_match_the_label_pattern() {
        for client in [
            "claude-code",
            "codex",
            "cursor",
            "vscode",
            "a",
            "9x",
            "a-",
            &"a".repeat(32),
        ] {
            assert!(valid_agent_client(client), "{client}");
        }
        for client in [
            "",
            "-a",
            "Claude",
            "a_b",
            "a b",
            "a.b",
            "ä",
            &"a".repeat(33),
        ] {
            assert!(!valid_agent_client(client), "{client}");
        }
        assert_eq!(
            KnownClient::from_label("claude-code"),
            Some(KnownClient::ClaudeCode)
        );
        assert_eq!(KnownClient::from_label("vscode"), Some(KnownClient::VsCode));
        assert_eq!(KnownClient::from_label("claude"), None);
    }

    #[test]
    fn default_key_names_fit_the_server_limit() {
        assert_eq!(
            default_key_name("claude-code", "laptop"),
            "agent-claude-code-laptop"
        );
        let long = default_key_name(&"c".repeat(32), &"m".repeat(48));
        assert_eq!(long.chars().count(), MAX_KEY_NAME_LEN);
        assert!(long.starts_with("agent-ccc"));
        /* A cut never leaves a trailing separator or space. */
        let cut = default_key_name(&"c".repeat(57), "machine");
        assert!(
            !cut.ends_with('-') && cut.len() <= MAX_KEY_NAME_LEN,
            "{cut}"
        );
    }

    #[test]
    fn mcp_url_overrides_must_be_https_or_loopback() {
        assert_eq!(parse_mcp_url(DEFAULT_MCP_URL).unwrap(), DEFAULT_MCP_URL);
        assert_eq!(
            parse_mcp_url("http://localhost:3000/mcp").unwrap(),
            "http://localhost:3000/mcp"
        );
        for url in [
            "http://mcp.example/mcp",
            "https://user:pw@mcp.example/mcp",
            "https://mcp.example/mcp?x=1",
            "https://mcp.example/mcp#x",
            "not a url",
        ] {
            assert!(parse_mcp_url(url).is_err(), "{url}");
        }
    }

    #[test]
    fn codex_toml_keeps_other_content_and_replaces_the_thru_table() {
        let original = "\
# my codex config
model = \"o3\"

[mcp_servers.other]
command = \"other-mcp\"
args = [\"--flag\"] # inline comment

[mcp_servers.thru]
url = \"https://old.example/mcp\"
http_headers = { \"X-Old\" = \"1\" }

[mcp_servers.thru.env]
OLD = \"1\"

[profiles.fast]
model = \"o4-mini\"
";
        let updated = upsert_codex_toml(Some(original), URL).unwrap();
        assert!(updated.starts_with(
            "# my codex config\nmodel = \"o3\"\n\n[mcp_servers.other]\ncommand = \"other-mcp\"\nargs = [\"--flag\"] # inline comment\n\n[profiles.fast]\nmodel = \"o4-mini\"\n"
        ), "{updated}");
        assert!(updated.ends_with(&format!(
            "\n\n[mcp_servers.thru]\nurl = \"{URL}\"\nbearer_token_env_var = \"THRU_MCP_API_KEY\"\n"
        )));
        assert!(!updated.contains("old.example") && !updated.contains("OLD"));
        let parsed: toml::Table = updated.parse().unwrap();
        assert_eq!(
            parsed["mcp_servers"]["other"]["command"].as_str(),
            Some("other-mcp")
        );
        assert_eq!(
            parsed["profiles"]["fast"]["model"].as_str(),
            Some("o4-mini")
        );
        /* Re-running is idempotent. */
        assert_eq!(upsert_codex_toml(Some(&updated), URL).unwrap(), updated);
        /* A new or empty file gets just the table. */
        let fresh = upsert_codex_toml(None, URL).unwrap();
        assert_eq!(
            fresh,
            format!(
                "[mcp_servers.thru]\nurl = \"{URL}\"\nbearer_token_env_var = \"THRU_MCP_API_KEY\"\n"
            )
        );
        assert_eq!(upsert_codex_toml(Some(""), URL).unwrap(), fresh);
        /* Quoted header keys are recognised. */
        let quoted = "[mcp_servers.\"thru\"]\nurl = \"https://old.example\"\n";
        assert!(
            !upsert_codex_toml(Some(quoted), URL)
                .unwrap()
                .contains("old.example")
        );
    }

    #[test]
    fn codex_toml_refuses_what_it_cannot_edit_safely() {
        for original in [
            "model = [",
            "[mcp_servers]\nthru = { url = \"https://old.example\" }\n",
            "mcp_servers.thru.url = \"https://old.example\"\n",
        ] {
            assert!(
                upsert_codex_toml(Some(original), URL).is_err(),
                "{original}"
            );
        }
    }

    #[test]
    fn json_configs_keep_other_entries_and_replace_thru() {
        let original = r#"{"inputs":[],"servers":{"zeta":{"url":"https://z.example"},"thru":{"url":"https://old.example"},"alpha":{"command":"a"}}}"#;
        let updated =
            upsert_json_server(Some(original), "servers", vscode_entry(URL, "thru_k1")).unwrap();
        let parsed: Value = serde_json::from_str(&updated).unwrap();
        assert_eq!(
            parsed,
            json!({"inputs":[],"servers":{
                "zeta":{"url":"https://z.example"},
                "thru":{"type":"http","url":URL,"headers":{"Authorization":"Bearer thru_k1"}},
                "alpha":{"command":"a"},
            }})
        );
        /* Key order is kept, so a diff shows only the thru entry. */
        let zeta = updated.find("zeta").unwrap();
        let thru = updated.find("\"thru\"").unwrap();
        let alpha = updated.find("alpha").unwrap();
        assert!(zeta < thru && thru < alpha, "{updated}");
        /* Re-running with a new key replaces the entry. */
        let again =
            upsert_json_server(Some(&updated), "servers", vscode_entry(URL, "thru_k2")).unwrap();
        assert!(again.contains("Bearer thru_k2") && !again.contains("thru_k1"));
        assert_eq!(
            upsert_json_server(Some(&again), "servers", vscode_entry(URL, "thru_k2")).unwrap(),
            again
        );

        let cursor = upsert_json_server(None, "mcpServers", cursor_entry(URL, "thru_k1")).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&cursor).unwrap(),
            json!({"mcpServers":{"thru":{"url":URL,"headers":{"Authorization":"Bearer thru_k1"}}}})
        );
        for broken in [
            "{ // comment\n}",
            "[1]",
            r#"{"mcpServers": 3}"#,
            "{\"a\":1,}",
        ] {
            assert!(
                upsert_json_server(Some(broken), "mcpServers", json!({})).is_err(),
                "{broken}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn rewrites_back_up_the_old_file_keep_its_mode_and_follow_symlinks() {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        let mode = |path: &Path| fs::metadata(path).unwrap().permissions().mode() & 0o777;

        /* A new file is owner-only and has no backup; its directory is created. */
        let created = directory.path().join("new").join("mcp.json");
        let result = rewrite_config(&created, |old| {
            assert!(old.is_none());
            Ok("{}\n".into())
        })
        .unwrap();
        assert!(result.backup.is_none());
        assert_eq!(mode(&created), 0o600);

        /* An existing file loses group and other access (it may now hold a
        key); the old text goes to .bak (0600). */
        let existing = directory.path().join("config.toml");
        fs::write(&existing, "old\n").unwrap();
        fs::set_permissions(&existing, fs::Permissions::from_mode(0o640)).unwrap();
        let result = rewrite_config(&existing, |old| {
            assert_eq!(old, Some("old\n"));
            Ok("new\n".into())
        })
        .unwrap();
        let backup = result.backup.unwrap();
        assert_eq!(backup, directory.path().join("config.toml.bak"));
        assert_eq!(fs::read_to_string(&backup).unwrap(), "old\n");
        assert_eq!(mode(&backup), 0o600);
        assert_eq!(fs::read_to_string(&existing).unwrap(), "new\n");
        assert_eq!(mode(&existing), 0o600);

        /* A failed edit leaves the file and no backup or temporary file. */
        fs::remove_file(&backup).unwrap();
        assert!(rewrite_config(&existing, |_| Err(install_error("nope"))).is_err());
        assert_eq!(fs::read_to_string(&existing).unwrap(), "new\n");
        let names: Vec<_> = fs::read_dir(directory.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names.len(), 2, "{names:?}");

        /* A symlinked config (dotfiles) stays a symlink. */
        let target = directory.path().join("dotfiles-mcp.json");
        fs::write(&target, "{}").unwrap();
        let link = directory.path().join("link.json");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        let result = rewrite_config(&link, |_| Ok("{\"a\":1}\n".into())).unwrap();
        assert!(
            fs::symlink_metadata(&link)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert_eq!(fs::read_to_string(&target).unwrap(), "{\"a\":1}\n");
        assert_eq!(result.path, fs::canonicalize(&target).unwrap());
    }

    #[test]
    fn commands_shown_to_the_user_are_quoted_for_a_shell() {
        assert_eq!(shell_quote("/home/a/.thru/key"), "/home/a/.thru/key");
        assert_eq!(shell_quote("/Users/a b/it's"), r"'/Users/a b/it'\''s'");
        assert_eq!(
            skill_args(Some(KnownClient::VsCode))[6..],
            ["--agent".to_owned(), "github-copilot".to_owned()]
        );
        assert_eq!(skill_args(None).len(), 6);
    }
}
