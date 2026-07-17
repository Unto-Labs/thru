import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), ".." );
const launcher = path.join( packageRoot, "bin", "thru.js" );
const signalTestTimeoutMs = 5000;

function killProcess( pid ) {
  if( !pid ) return;

  try {
    process.kill( pid, "SIGKILL" );
  } catch {
    /* Process already exited. */
  }
}

async function writeNodeFakeThru( fakeThru, body ) {
  await writeFile(
    fakeThru,
    `#!/usr/bin/env node\n${body}`,
    "utf8",
  );
  await chmod( fakeThru, 0o755 );
}

function waitForClose( child, label, cleanup = () => {} ) {
  return new Promise( ( resolve, reject ) => {
    let settled = false;
    const finish = fn => {
      if( settled ) return;
      settled = true;
      clearTimeout( timer );
      child.off( "close", onClose );
      child.off( "error", onError );
      fn();
    };
    const onClose = ( code, signal ) => {
      finish( () => resolve( { code, signal } ) );
    };
    const onError = error => {
      finish( () => reject( error ) );
    };
    const timer = setTimeout( () => {
      if( settled ) return;
      cleanup();
      finish( () => reject( new Error( `${label} timed out after ${signalTestTimeoutMs}ms` ) ) );
    }, signalTestTimeoutMs );

    child.once( "close", onClose );
    child.once( "error", onError );
  } );
}

function runLauncher( args, env ) {
  return new Promise( resolve => {
    const child = spawn( process.execPath, [ launcher, ...args ], {
      env,
      stdio: [ "ignore", "pipe", "pipe" ],
    } );
    let stdout = "";
    let stderr = "";
    child.stdout.on( "data", chunk => { stdout += chunk; } );
    child.stderr.on( "data", chunk => { stderr += chunk; } );
    child.on( "close", code => resolve( { code, stdout, stderr } ) );
  } );
}

test( "launcher forwards args and exit code to native binary", async () => {
  const tmp = await mkdtemp( path.join( os.tmpdir(), "thru-cli-test-" ) );
  const fakeThru = path.join( tmp, "thru" );

  await writeFile(
    fakeThru,
    "#!/bin/sh\nprintf 'args:%s\\n' \"$*\"\nexit 7\n",
    "utf8",
  );
  await chmod( fakeThru, 0o755 );

  const result = await runLauncher(
    [ "account", "list" ],
    { ...process.env, THRU_CLI_BIN: fakeThru },
  );

  assert.equal( result.code, 7 );
  assert.match( result.stdout, /args:account list/ );
  assert.equal( result.stderr, "" );
} );

test( "launcher fails clearly when no platform package is installed", async () => {
  /* In the development tree the platform packages (thru-linux-x64, ...) are
     never installed, so without THRU_CLI_BIN the launcher must exit 1 with a
     message pointing at the public releases. On hosts that are not in the
     supported platform list the unsupported-platform message also carries
     the same URL, keeping this test portable. */
  const env = { ...process.env };
  delete env.THRU_CLI_BIN;

  const result = await runLauncher( [ "--version" ], env );

  assert.equal( result.code, 1 );
  assert.match( result.stderr, /https:\/\/github\.com\/Unto-Labs\/thru\/releases/ );
} );

test( "launcher rejects a missing THRU_CLI_BIN override", async () => {
  const result = await runLauncher(
    [ "--version" ],
    { ...process.env, THRU_CLI_BIN: "/nonexistent/thru-binary" },
  );

  assert.equal( result.code, 1 );
  assert.match( result.stderr, /missing at \/nonexistent\/thru-binary/ );
} );

test(
  "launcher forwards SIGTERM to the native binary",
  { skip: process.platform === "win32" },
  async () => {
    /* Without forwarding, killing the launcher (CI cancellation, `kill`,
       `docker stop`) orphans the native binary. The fake binary records its
       PID, then idles until it receives the forwarded TERM. */
    const tmp = await mkdtemp( path.join( os.tmpdir(), "thru-cli-test-" ) );
    const fakeThru = path.join( tmp, "thru" );
    const pidFile = path.join( tmp, "child.pid" );

    await writeNodeFakeThru( fakeThru, `
const { writeFileSync } = require( "node:fs" );

process.on( "SIGTERM", () => process.exit( 0 ) );
writeFileSync( ${JSON.stringify( pidFile )}, \`\${process.pid}\\n\` );
setInterval( () => {}, 1000 );
` );

    const launcherProc = spawn( process.execPath, [ launcher ], {
      env: { ...process.env, THRU_CLI_BIN: fakeThru },
      stdio: "ignore",
    } );

    let binaryPid = 0;
    try {
      for( let attempt = 0; attempt < 100 && !binaryPid; attempt++ ) {
        try {
          binaryPid = Number.parseInt( await readFile( pidFile, "utf8" ), 10 ) || 0;
        } catch {
          await delay( 50 );
        }
      }
      assert.ok( binaryPid > 0, "native binary never started" );

      const launcherClosed = waitForClose(
        launcherProc,
        "launcher close after forwarded SIGTERM",
        () => {
          killProcess( launcherProc.pid );
          killProcess( binaryPid );
        },
      );
      launcherProc.kill( "SIGTERM" );
      await launcherClosed;

      let alive = true;
      for( let attempt = 0; attempt < 100 && alive; attempt++ ) {
        try {
          process.kill( binaryPid, 0 );
          await delay( 50 );
        } catch {
          alive = false;
        }
      }
      assert.equal( alive, false, "native binary kept running after SIGTERM" );
    } finally {
      killProcess( launcherProc.pid );
      killProcess( binaryPid );
    }
  },
);

test(
  "launcher dies from the signal that killed the native binary",
  { skip: process.platform === "win32" },
  async () => {
    /* Unlike the test above, this fake binary installs no TERM handler, so
       the forwarded signal kills it and the launcher takes the
       signal-death branch of its exit handler. The launcher must then die
       from the same signal (close reports signal, not an exit code);
       before the removeAllListeners fix its own forwarding listener
       swallowed the re-raise and the launcher exited 0, making Ctrl+C,
       `docker stop`, and CI cancellation look like success. */
    const tmp = await mkdtemp( path.join( os.tmpdir(), "thru-cli-test-" ) );
    const fakeThru = path.join( tmp, "thru" );
    const pidFile = path.join( tmp, "child.pid" );

    await writeNodeFakeThru( fakeThru, `
const { writeFileSync } = require( "node:fs" );

writeFileSync( ${JSON.stringify( pidFile )}, \`\${process.pid}\\n\` );
setInterval( () => {}, 1000 );
` );

    const launcherProc = spawn( process.execPath, [ launcher ], {
      env: { ...process.env, THRU_CLI_BIN: fakeThru },
      stdio: "ignore",
    } );

    let binaryPid = 0;
    try {
      /* Wait until the native binary is running before signalling, so the
         launcher's spawn + forwarding setup is complete. */
      for( let attempt = 0; attempt < 100 && !binaryPid; attempt++ ) {
        try {
          binaryPid = Number.parseInt( await readFile( pidFile, "utf8" ), 10 ) || 0;
        } catch {
          await delay( 50 );
        }
      }
      assert.ok( binaryPid > 0, "native binary never started" );

      const launcherClosed = waitForClose(
        launcherProc,
        "launcher close after native signal death",
        () => {
          killProcess( launcherProc.pid );
          killProcess( binaryPid );
        },
      );
      launcherProc.kill( "SIGTERM" );
      const { code, signal } = await launcherClosed;

      assert.equal( signal, "SIGTERM", "launcher must die from the forwarded signal" );
      assert.equal( code, null );
    } finally {
      killProcess( launcherProc.pid );
      killProcess( binaryPid );
    }
  },
);
