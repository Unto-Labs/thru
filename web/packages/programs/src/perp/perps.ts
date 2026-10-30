/* @thru/programs/perps (and its alias @thru/programs/perp): the perps
   protocol layer and SDK.

   - index.ts: the program's instruction encoders, account and event
     parsers, margin and funding math (generated from the current ABI);
   - versions/: every ABI version, its feature flags and decoders into the
     version-independent domain model, and version detection (VERSIONS.md);
   - sdk/: transaction builders (isolated and cross seats), signers,
     sending, errors, units, the client and its agent tool catalog
     (README.md).

   index.ts never imports versions/ or sdk/ (they import it), so module
   initialization has no cycle. */
export * from './index';
export * from './versions';
export * from './sdk';
