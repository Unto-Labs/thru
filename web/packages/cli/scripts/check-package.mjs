import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { SUPPORTED_PLATFORMS, packageRoot } from "./platform.mjs";

const packageJson = JSON.parse(
  await readFile( path.join( packageRoot, "package.json" ), "utf8" ),
);

if( packageJson.bin?.thru !== "./bin/thru.js" ) {
  throw new Error( "package.json must expose bin.thru as ./bin/thru.js" );
}

/* The whole point of the platform-package model is that installation never
   runs lifecycle scripts. Guard against postinstall sneaking back in. */
for( const script of [ "preinstall", "install", "postinstall" ] ) {
  if( packageJson.scripts?.[ script ] ) {
    throw new Error( `package.json must not define a ${script} script` );
  }
}

/* optionalDependencies are injected at publish time by
   make-platform-packages.mjs. When present (i.e. in a publish checkout) they
   must reference only the canonical platform packages, pinned to the exact
   package version. In the development tree they must be absent so that
   workspace installs do not try to resolve unpublished packages. */
const optional = packageJson.optionalDependencies ?? {};
const knownNames = new Set( SUPPORTED_PLATFORMS.map( entry => entry.packageName ) );
for( const [ name, version ] of Object.entries( optional ) ) {
  if( !knownNames.has( name ) ) {
    throw new Error( `optionalDependencies contains unknown platform package ${name}` );
  }
  if( version !== packageJson.version ) {
    throw new Error(
      `optionalDependencies entry ${name}@${version} must be pinned to package version ${packageJson.version}`,
    );
  }
}

for( const file of [ "bin/thru.js", "scripts/run.mjs", "scripts/platform.mjs", "README.md", "LICENSE" ] ) {
  await access( path.join( packageRoot, file ) );
}

for( const file of [ "bin", "scripts/run.mjs", "scripts/platform.mjs", "LICENSE" ] ) {
  if( !packageJson.files?.includes( file ) ) {
    throw new Error( `package.json files must include ${file}` );
  }
}
