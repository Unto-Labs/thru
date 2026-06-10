import path from "node:path";
import { fileURLToPath } from "node:url";

export const packageRoot = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), ".." );

export const PUBLIC_RELEASES_URL = "https://github.com/Unto-Labs/thru/releases";

/* Canonical list of platforms the thru CLI ships native binaries for.

   Each entry maps a Node.js (process.platform, process.arch) pair to:
   - packageName:   the npm package that carries the binary for that platform.
                    The main `thru` package depends on all of these via
                    optionalDependencies; npm installs only the one whose
                    os/cpu constraints match the host.
   - assetPlatform: the platform component of the GitHub release asset name,
                    thru-cli-<assetPlatform>-<tag>.tar.gz.
   - binName:       the binary file name inside both the release asset and
                    the platform package's bin/ directory. */
export const SUPPORTED_PLATFORMS = [
  { platform: "linux",  arch: "x64",   packageName: "thru-linux-x64",    assetPlatform: "Linux-x86_64",   binName: "thru" },
  { platform: "linux",  arch: "arm64", packageName: "thru-linux-arm64",  assetPlatform: "Linux-aarch64",  binName: "thru" },
  { platform: "darwin", arch: "x64",   packageName: "thru-darwin-x64",   assetPlatform: "Darwin-x86_64",  binName: "thru" },
  { platform: "darwin", arch: "arm64", packageName: "thru-darwin-arm64", assetPlatform: "Darwin-arm64",   binName: "thru" },
  { platform: "win32",  arch: "x64",   packageName: "thru-win32-x64",    assetPlatform: "Windows-x86_64", binName: "thru.exe" },
];

export function supportedPlatformList() {
  return SUPPORTED_PLATFORMS.map( entry => `${entry.platform}-${entry.arch}` ).join( ", " );
}

export function releasePlatform( platform = process.platform, arch = process.arch ) {
  const entry = SUPPORTED_PLATFORMS.find(
    candidate => candidate.platform === platform && candidate.arch === arch,
  );
  if( entry ) return entry;

  throw new Error(
    `Unsupported platform for the thru CLI: ${platform}-${arch}. ` +
    `Supported platforms are ${supportedPlatformList()}. ` +
    `Prebuilt binaries are published at ${PUBLIC_RELEASES_URL}.`,
  );
}
