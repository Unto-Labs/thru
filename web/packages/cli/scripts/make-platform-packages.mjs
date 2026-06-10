import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SUPPORTED_PLATFORMS, packageRoot } from "./platform.mjs";

/* make-platform-packages generates the per-platform npm packages
   (thru-linux-x64, thru-darwin-arm64, ...) that carry the native thru
   binaries, and pins them as optionalDependencies of the main `thru`
   package. It runs in the CLI publish workflow (cli-artifacts.yml), after
   the built binaries have been downloaded and checksum-verified.

   Expected input layout: <binariesDir>/<assetPlatform>/<binName>, e.g.
   cli-binaries/Linux-x86_64/thru, cli-binaries/Windows-x86_64/thru.exe.

   Platforms listed in optionalPlatforms (e.g. win32-x64 while its build is
   best-effort) are skipped with a warning when their binary is missing; all
   other platforms are required and abort the publish when absent. */

function platformKey( entry ) {
  return `${entry.platform}-${entry.arch}`;
}

function platformPackageJson( entry, version ) {
  return {
    name: entry.packageName,
    version,
    description: `${entry.platform} ${entry.arch} native binary for the thru CLI`,
    license: "Apache-2.0",
    repository: {
      type: "git",
      url: "git+https://github.com/Unto-Labs/thru.git",
      directory: "web/packages/cli",
    },
    os: [ entry.platform ],
    cpu: [ entry.arch ],
    files: [ "bin" ],
    engines: {
      node: ">=18",
    },
    publishConfig: {
      access: "public",
    },
    preferUnplugged: true,
  };
}

function platformReadme( entry ) {
  return (
    `# ${entry.packageName}\n\n` +
    `This package contains the ${entry.platform}-${entry.arch} native binary for the ` +
    "[thru](https://www.npmjs.com/package/thru) CLI. It is installed automatically " +
    "as an optional dependency of `thru`; install `thru` instead of installing this " +
    "package directly.\n"
  );
}

export async function generatePlatformPackages( {
  version,
  binariesDir,
  outDir,
  optionalPlatforms = [],
  mainPackageJsonPath = path.join( packageRoot, "package.json" ),
  logger = console,
} ) {
  if( !version ) throw new Error( "version is required" );
  if( !binariesDir ) throw new Error( "binariesDir is required" );
  if( !outDir ) throw new Error( "outDir is required" );

  const optional = new Set( optionalPlatforms );
  for( const key of optional ) {
    if( !SUPPORTED_PLATFORMS.some( entry => platformKey( entry ) === key ) ) {
      throw new Error( `Unknown optional platform ${key}` );
    }
  }

  const generated = [];
  const skipped = [];

  for( const entry of SUPPORTED_PLATFORMS ) {
    const key = platformKey( entry );
    const binarySource = path.join( binariesDir, entry.assetPlatform, entry.binName );

    if( !existsSync( binarySource ) ) {
      if( optional.has( key ) ) {
        const warn = logger.warn || logger.log;
        warn.call( logger, `Skipping optional platform ${key}: ${binarySource} not found.` );
        skipped.push( entry.packageName );
        continue;
      }
      throw new Error( `Missing required binary for ${key}: ${binarySource}` );
    }

    const packageDir = path.join( outDir, entry.packageName );
    const binDir = path.join( packageDir, "bin" );
    const binaryDestination = path.join( binDir, entry.binName );

    await mkdir( binDir, { recursive: true } );
    await copyFile( binarySource, binaryDestination );
    await chmod( binaryDestination, 0o755 );
    await writeFile(
      path.join( packageDir, "package.json" ),
      `${JSON.stringify( platformPackageJson( entry, version ), null, 2 )}\n`,
    );
    await writeFile( path.join( packageDir, "README.md" ), platformReadme( entry ) );
    /* npm includes LICENSE files automatically even with a files whitelist;
       reuse the main package's copy of the repo license. */
    await copyFile( path.join( packageRoot, "LICENSE" ), path.join( packageDir, "LICENSE" ) );

    generated.push( entry.packageName );
    logger.log( `Generated ${entry.packageName}@${version} from ${binarySource}` );
  }

  if( generated.length === 0 ) {
    throw new Error( "No platform packages were generated" );
  }

  /* Pin the generated platform packages as optionalDependencies of the main
     package. This happens only in the publish checkout; the committed
     package.json deliberately has no optionalDependencies so development
     installs never try to resolve unpublished packages. */
  const mainPackageJson = JSON.parse( await readFile( mainPackageJsonPath, "utf8" ) );
  if( mainPackageJson.version !== version ) {
    throw new Error(
      `Main package version ${mainPackageJson.version} does not match release version ${version}; ` +
      "run the version sync step before generating platform packages.",
    );
  }
  mainPackageJson.optionalDependencies = Object.fromEntries(
    generated.sort().map( name => [ name, version ] ),
  );
  await writeFile( mainPackageJsonPath, `${JSON.stringify( mainPackageJson, null, 2 )}\n` );
  logger.log( `Pinned optionalDependencies in ${mainPackageJsonPath}: ${generated.join( ", " )}` );

  return { generated, skipped };
}

function parseArgs( argv ) {
  const args = { optionalPlatforms: [] };
  for( let idx = 0; idx < argv.length; idx++ ) {
    const arg = argv[idx];
    const next = () => {
      idx += 1;
      if( idx >= argv.length ) throw new Error( `Missing value for ${arg}` );
      return argv[idx];
    };

    if( arg === "--version" ) args.version = next();
    else if( arg === "--binaries-dir" ) args.binariesDir = next();
    else if( arg === "--out-dir" ) args.outDir = next();
    else if( arg === "--package-json" ) args.mainPackageJsonPath = next();
    else if( arg === "--optional" ) args.optionalPlatforms.push( ...next().split( "," ).filter( Boolean ) );
    else throw new Error( `Unknown argument ${arg}` );
  }
  return args;
}

if( process.argv[1] && import.meta.url === pathToFileURL( process.argv[1] ).href ) {
  try {
    await generatePlatformPackages( parseArgs( process.argv.slice( 2 ) ) );
  } catch( error ) {
    console.error( error.message );
    process.exit( 1 );
  }
}
