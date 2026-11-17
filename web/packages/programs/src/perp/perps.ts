/* @thru/programs/perps (and its alias @thru/programs/perp): the perps
   protocol layer and SDK.

   - index.ts: the program's instruction encoders, account and event
     parsers, margin and funding math (generated from the current ABI, the
     only decoder);
   - sdk/: transaction builders (isolated and cross seats), signers,
     sending, errors, units, the client and its agent tool catalog
     (README.md).

   index.ts never imports sdk/ (sdk/ imports it), so module initialization
   has no cycle. */
export * from './index';
export * from './sdk';
