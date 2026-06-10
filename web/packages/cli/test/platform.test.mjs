import assert from "node:assert/strict";
import test from "node:test";
import { SUPPORTED_PLATFORMS, releasePlatform } from "../scripts/platform.mjs";

const EXPECTED = [
  [ "linux",  "x64",   "thru-linux-x64",    "Linux-x86_64",   "thru" ],
  [ "linux",  "arm64", "thru-linux-arm64",  "Linux-aarch64",  "thru" ],
  [ "darwin", "x64",   "thru-darwin-x64",   "Darwin-x86_64",  "thru" ],
  [ "darwin", "arm64", "thru-darwin-arm64", "Darwin-arm64",   "thru" ],
  [ "win32",  "x64",   "thru-win32-x64",    "Windows-x86_64", "thru.exe" ],
];

test( "maps every supported platform to package, asset, and binary names", () => {
  assert.equal( SUPPORTED_PLATFORMS.length, EXPECTED.length );

  for( const [ platform, arch, packageName, assetPlatform, binName ] of EXPECTED ) {
    assert.deepEqual( releasePlatform( platform, arch ), {
      platform,
      arch,
      packageName,
      assetPlatform,
      binName,
    } );
  }
} );

test( "windows binary name carries the .exe suffix", () => {
  assert.equal( releasePlatform( "win32", "x64" ).binName, "thru.exe" );
} );

test( "rejects unsupported platforms with the supported list", () => {
  assert.throws(
    () => releasePlatform( "freebsd", "x64" ),
    /Unsupported platform.*linux-x64.*win32-x64/s,
  );
} );

test( "rejects unsupported architectures", () => {
  assert.throws(
    () => releasePlatform( "linux", "ia32" ),
    /Unsupported platform/,
  );
} );
