import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { PUBLIC_RELEASES_URL, releasePlatform } from "./platform.mjs";

const require = createRequire( import.meta.url );

/* resolveBinaryPath returns the path of the native thru binary.

   Resolution order:
   1. THRU_CLI_BIN environment variable (development / manual override).
   2. The platform package (e.g. thru-linux-x64) installed by npm as an
      optional dependency of `thru`. The binary ships inside that package,
      so no lifecycle scripts or network access are needed at install time.

   Throws with an actionable message when the host platform is unsupported
   or the platform package is missing (e.g. installed with --omit=optional). */
export function resolveBinaryPath( env = process.env ) {
  if( env.THRU_CLI_BIN ) return env.THRU_CLI_BIN;

  const platform = releasePlatform();

  let packageJsonPath;
  try {
    packageJsonPath = require.resolve( `${platform.packageName}/package.json` );
  } catch {
    throw new Error(
      `The thru CLI platform package ${platform.packageName} is not installed.\n` +
      "It is normally installed automatically as an optional dependency of `thru`.\n" +
      "This happens when optional dependencies are disabled (--omit=optional /\n" +
      "--no-optional), or when no prebuilt binary was published for this platform\n" +
      "and version. Reinstall with optional dependencies enabled, or download the\n" +
      `binary from ${PUBLIC_RELEASES_URL} and point THRU_CLI_BIN at it.`,
    );
  }

  return path.join( path.dirname( packageJsonPath ), "bin", platform.binName );
}

export function runThru( args, { env = process.env, stdio = "inherit" } = {} ) {
  let binaryPath;
  try {
    binaryPath = resolveBinaryPath( env );
  } catch( error ) {
    console.error( error.message );
    process.exit( 1 );
  }

  if( !existsSync( binaryPath ) ) {
    console.error(
      `The thru CLI binary is missing at ${binaryPath}.\n` +
      "Reinstall `thru`, or download the binary from " +
      `${PUBLIC_RELEASES_URL} and point THRU_CLI_BIN at it.`,
    );
    process.exit( 1 );
  }

  const child = spawn( binaryPath, args, { stdio } );

  /* Forward termination signals so cancelling a CI job, `kill`, or
     `docker stop` does not orphan the native binary. Ctrl+C in a terminal
     already reaches the child through the process group; a duplicate
     SIGINT is harmless. The launcher still exits via the child's exit
     handler below, preserving the child's exit code. */
  for( const signal of [ "SIGINT", "SIGTERM", "SIGHUP" ] ) {
    process.on( signal, () => child.kill( signal ) );
  }

  child.on( "error", error => {
    console.error( `Failed to start thru CLI binary at ${binaryPath}: ${error.message}` );
    process.exit( 1 );
  } );

  child.on( "exit", ( code, signal ) => {
    if( signal ) {
      /* Die from the same signal as the child so callers (shells, CI,
         `docker stop`) observe signal death (exit status 128+n) instead of
         a successful exit. The forwarding listener for that signal must be
         removed first: it would otherwise swallow the re-raise, letting
         the event loop drain and the launcher exit 0. */
      process.removeAllListeners( signal );
      process.kill( process.pid, signal );
      return;
    }
    process.exit( code ?? 1 );
  } );
}
