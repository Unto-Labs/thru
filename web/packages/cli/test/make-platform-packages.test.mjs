import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { generatePlatformPackages } from "../scripts/make-platform-packages.mjs";

const quietLogger = { log: () => {}, warn: () => {} };

async function setupFixture( { version = "1.2.3", assetPlatforms } ) {
  const tmp = await mkdtemp( path.join( os.tmpdir(), "thru-platform-pkgs-" ) );
  const binariesDir = path.join( tmp, "binaries" );
  const outDir = path.join( tmp, "npm" );
  const mainPackageJsonPath = path.join( tmp, "package.json" );

  for( const [ assetPlatform, binName ] of assetPlatforms ) {
    const dir = path.join( binariesDir, assetPlatform );
    await mkdir( dir, { recursive: true } );
    await writeFile( path.join( dir, binName ), `fake binary for ${assetPlatform}\n` );
  }

  await writeFile(
    mainPackageJsonPath,
    `${JSON.stringify( { name: "thru", version, bin: { thru: "./bin/thru.js" } }, null, 2 )}\n`,
  );

  return { binariesDir, outDir, mainPackageJsonPath };
}

test( "generates platform packages and pins optionalDependencies", async () => {
  const fixture = await setupFixture( {
    assetPlatforms: [
      [ "Linux-x86_64", "thru" ],
      [ "Darwin-arm64", "thru" ],
    ],
  } );

  const result = await generatePlatformPackages( {
    version: "1.2.3",
    binariesDir: fixture.binariesDir,
    outDir: fixture.outDir,
    optionalPlatforms: [ "linux-arm64", "darwin-x64", "win32-x64" ],
    mainPackageJsonPath: fixture.mainPackageJsonPath,
    logger: quietLogger,
  } );

  assert.deepEqual( result.generated, [ "thru-darwin-arm64", "thru-linux-x64" ] );
  assert.deepEqual(
    result.skipped.sort(),
    [ "thru-darwin-x64", "thru-linux-arm64", "thru-win32-x64" ],
  );

  const packageJson = JSON.parse(
    await readFile( path.join( fixture.outDir, "thru-linux-x64", "package.json" ), "utf8" ),
  );
  assert.equal( packageJson.name, "thru-linux-x64" );
  assert.equal( packageJson.version, "1.2.3" );
  assert.deepEqual( packageJson.os, [ "linux" ] );
  assert.deepEqual( packageJson.cpu, [ "x64" ] );
  assert.deepEqual( packageJson.files, [ "bin" ] );
  assert.equal( packageJson.publishConfig.access, "public" );

  const binaryPath = path.join( fixture.outDir, "thru-linux-x64", "bin", "thru" );
  assert.equal( await readFile( binaryPath, "utf8" ), "fake binary for Linux-x86_64\n" );
  if( process.platform !== "win32" ) {
    const mode = ( await stat( binaryPath ) ).mode;
    assert.equal( mode & 0o111, 0o111, "binary must be executable" );
  }

  const mainPackageJson = JSON.parse( await readFile( fixture.mainPackageJsonPath, "utf8" ) );
  assert.deepEqual( mainPackageJson.optionalDependencies, {
    "thru-darwin-arm64": "1.2.3",
    "thru-linux-x64": "1.2.3",
  } );
} );

test( "fails when a required platform binary is missing", async () => {
  const fixture = await setupFixture( {
    assetPlatforms: [ [ "Linux-x86_64", "thru" ] ],
  } );

  await assert.rejects(
    generatePlatformPackages( {
      version: "1.2.3",
      binariesDir: fixture.binariesDir,
      outDir: fixture.outDir,
      optionalPlatforms: [ "linux-arm64", "darwin-x64", "win32-x64" ],
      mainPackageJsonPath: fixture.mainPackageJsonPath,
      logger: quietLogger,
    } ),
    /Missing required binary for darwin-arm64/,
  );
} );

test( "fails when the main package version does not match", async () => {
  const fixture = await setupFixture( {
    version: "9.9.9",
    assetPlatforms: [
      [ "Linux-x86_64", "thru" ],
      [ "Darwin-arm64", "thru" ],
    ],
  } );

  await assert.rejects(
    generatePlatformPackages( {
      version: "1.2.3",
      binariesDir: fixture.binariesDir,
      outDir: fixture.outDir,
      optionalPlatforms: [ "linux-arm64", "darwin-x64", "win32-x64" ],
      mainPackageJsonPath: fixture.mainPackageJsonPath,
      logger: quietLogger,
    } ),
    /does not match release version/,
  );
} );

test( "rejects unknown optional platform keys", async () => {
  const fixture = await setupFixture( {
    assetPlatforms: [ [ "Linux-x86_64", "thru" ] ],
  } );

  await assert.rejects(
    generatePlatformPackages( {
      version: "1.2.3",
      binariesDir: fixture.binariesDir,
      outDir: fixture.outDir,
      optionalPlatforms: [ "amiga-68k" ],
      mainPackageJsonPath: fixture.mainPackageJsonPath,
      logger: quietLogger,
    } ),
    /Unknown optional platform amiga-68k/,
  );
} );
