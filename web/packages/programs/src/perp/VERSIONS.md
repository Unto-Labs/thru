# Perp ABI versions

The perp program changes its accounts, instructions and events from one
release to the next, and an upgrade happens in place (thru-perps/MIGRATION.md):
the same accounts are read by the old code, then by the new one. The SDK
treats every ABI release as a version of its own, so that:

- the indexer and the UI decode any deployment, old or new, into one domain
  model, and historical data keeps decoding after an upgrade;
- the UI can show or hide features per deployment;
- adding a release is mechanical.

## Pieces

| Piece | Where |
| --- | --- |
| Generated types of the current ABI | `abi/thru/program/perp/types.ts` (from `thru-perps/abi/tn_perp_program.abi.yaml`) |
| Current decoders, encoders, margin and funding math | `index.ts` |
| Domain model, version interfaces | `versions/model.ts` |
| One directory per older ABI with a different layout | `versions/v0_2/` (its yaml, its generated types, `decoder.ts`) |
| Decoders shared by versions with the current layout | `versions/current.ts` |
| Registry and feature flags | `versions/registry.ts` |
| Version detection | `versions/detect.ts` |
| Tests | `versions/versions.test.ts` |

A version (`PerpAbiVersion`) has:

- `id`: `perp-abi@<package-version>`, e.g. `perp-abi@0.4.0`. `package-version`
  is the `abi.package-version` field of the yaml; `abi-version` (the ABI file
  format) has been 1 throughout.
- `features`: `oracleMargin`, `liquidation`, `funding`, `settleFunding`,
  `crossMargin`, `sharedVaults`, `crossUpnlHaircut`, `lossWaterfall`,
  `tradingFees`.
- `layout`: byte sizes and offsets of its accounts.
- `instructions` and `events`: tags taken from the variants of
  `PerpInstruction` and `PerpEvent` in its generated types. They are never a
  hand-written list.
- `programHashes`: sha256 values of program builds known to implement it.
- `decode`: decoders for the exchange meta, the market header, seat arena,
  single seat entry, order arena, cbook, cbook header, margin account and
  events. Each decoder returns the domain model.

## Registered versions

| Version | Adds | Program builds |
| --- | --- | --- |
| 0.2.0 | oracle mark, margins, liquidation | `691a5046…` (Betanet until 2026-10-15), `aa1ca5cc…` (Alphanet demo, 2026-09-22) |
| 0.3.0 | hourly funding (`funding_update`, `market_set_funding`, `settle_funding`, `FUNDING_ROUND`) | none deployed; recognized by its ABI account |
| 0.4.0 | cross margin (margin accounts, `margin_*`, `market_set_vault`, `market_set_cross`, `MARGIN`) | `b1dc5aee…` (Betanet 2026-10-15), `26e47388…` (tm/perps-all), `1df993f3…` (Betanet since 2026-10-19) |
| 0.5.0 | the loss waterfall (`insurance_deposit`, `resolve_bad_debt`, `market_set_risk_params`, `LOSS`, `INSURANCE`, a market's risk state, loss charges in settlement, the bad debt freeze) and trading fees with builder codes (`market_set_fees`, `fee_claim`, `seat_set_fee_receiver`, `seat_set_builder_approval`, `FEE`, a market's fee rates, builder terms in market records and resting orders, fee seats and builder approvals in seat flags) | none deployed yet; recognized by its ABI account |

0.2.0 has its own generated types because its layout differs from 0.4.0:

- its market header is 320 bytes, with no funding and no haircut;
- its seats have no funding words;
- the last word of a seat is `non_nullable_reserved` instead of `flags`;
- its balances are unsigned.

0.4.0 has no generated module of its own either: 0.5.0 grew the market
header from 448 to 512 bytes into bytes 0.4.0 held at zero and renamed
reserved bytes, so a 0.4.0 market reads through the 0.5.0 layout with the
waterfall and fees off. `withoutLossWaterfall` in `current.ts` drops the
risk state, the fee rates, the seats' fee flag and builder approval and the
orders' builder codes, and refuses a `LOSS`, `INSURANCE` or `FEE` event.

0.3.0 has no generated module of its own. Its ABI is 0.4.0's without the
cross margin variants, and its bytes are what 0.4.0 reads: the flags word of
every seat is 1 and the haircut field is 0. `withoutCrossMargin` in
`current.ts` drops the cross fields from what it decodes and refuses a cross
seat or a `MARGIN` event.

## The domain model

The interfaces are the SDK's long-standing types, also exported under the
domain names:

| Domain name | Type | Notes |
| --- | --- | --- |
| `PerpMarketState` | `PerpMarket` | `funding` is absent before 0.3.0, `crossUpnlHaircutBps` before 0.4.0, `risk` and `fees` before 0.5.0 |
| `PerpSeat` | `PerpSeatEntry` | `cross` is always set (false before 0.4.0); the funding words are absent before 0.3.0; `feeReceiver` and `builderApproval` are set only when present (never before 0.5.0) |
| `PerpFundingState` | `PerpFunding` | |
| `PerpMarginAccountState` | `PerpMarginAccount` | |
| `PerpOrder` | `PerpOrderEntry` | `builder` is set only when the order carries a builder code (never before 0.5.0) |
| `PerpExchangeState` | `PerpExchangeMeta` | |
| (events) | `ParsedPerpEvent` | |

Every margin function (`perpEquity`, `perpCrossTotals`, `perpSettleFunding`
and the rest) takes these types, so it runs on data of any version. A field a
version lacks reads as "feature off": no funding settles nothing, and a seat
that is not cross is isolated.

## Detecting a deployment's version

`fetchPerpAbiVersion(thru, { programAddress })` and
`detectPerpAbiVersion({ programHash | programCode, abiYaml | abiAccountData })`
check these sources in order:

1. **Program code hash.** This is the sha256 of the program account's data,
   which is the program binary. It is authoritative. A build the SDK does not
   know is added with `registerPerpProgramHash(hash, 'perp-abi@0.4.0')`.
2. **ABI account.** This is the program's official ABI account in
   abi-manager (`deriveProgramABIAddresses(program).abiAccountAddress`, or
   `deployment.perpAbi`). Its yaml carries `package: thru.program.perp` and
   `package-version`. It is only a hint, because an upgrade can skip it:
   Betanet kept the 0.2.0 ABI account under 0.4.0 code. When the hash and the
   ABI account disagree, the hash wins and `abiAccountStale` is set.
3. **Fallback.** An explicit fallback version, or `assumeLatest`. Without
   either, detection throws.

Account data cannot identify the version:

- the exchange meta's `version` is 1 in every release;
- markets and seats carry no version, and an upgrade reads the old bytes in
  place;
- a margin account's `version` byte (`PERP_MARGIN_ACCOUNT_VERSION`, 1) only
  exists from 0.4.0 on, and the 0.4.0 decoder checks it.

## How to add an ABI version

Take a new release, say 0.5.0.

1. **Program and ABI.**
   - Change the program and bump `abi.package-version` in
     `thru-perps/abi/tn_perp_program.abi.yaml` to `0.5.0`.
   - Check the yaml:
     `cd rpc/abi && cargo run -p abi_cli --release -- analyze -f ../../thru-perps/abi/tn_perp_program.abi.yaml -i type-library`.
     The binary is `target/release/abi`.
2. **If the layout of an existing account changes, keep the old version's
   types.** 0.4.0 becomes an old version:
   ```sh
   mkdir -p web/packages/programs/src/perp/versions/v0_4
   git show <0.4.0 commit>:thru-perps/abi/tn_perp_program.abi.yaml \
     > web/packages/programs/src/perp/versions/v0_4/tn_perp_program.abi.yaml
   cd rpc/abi && cargo run -p abi_cli --release -- codegen \
     -f ../../web/packages/programs/src/perp/versions/v0_4/tn_perp_program.abi.yaml \
     -i type-library -l typescript \
     -o ../../web/packages/programs/src/perp/versions/v0_4/abi
   ```
   Then write `versions/v0_4/decoder.ts`, which maps 0.4.0's views onto the
   domain model; `versions/v0_2/decoder.ts` shows the pattern. Point
   `PERP_ABI_V0_4.decode`, `.layout` and its tag sets at the new module.

   If nothing 0.4.0 has changes and 0.5.0 only adds, skip this step: 0.4.0
   keeps reading through the current layout, the way 0.3.0 does. Use
   `withoutCrossMargin` as the model for hiding what it does not have.
3. **Regenerate the current types:**
   ```sh
   cd rpc/abi && cargo run -p abi_cli --release -- codegen \
     -f ../../thru-perps/abi/tn_perp_program.abi.yaml -i type-library -l typescript \
     -o ../../web/packages/programs/src/perp/abi
   ```
   Then update the parsers and encoders in `index.ts` (they are the current
   decoders) and the `PERP_*` constants. Add any new field to the domain types
   as optional, documented as absent before 0.5.0.
4. **Register the version** in `versions/registry.ts`:
   - add `PERP_ABI_V0_5` with its features (add a flag to `PerpFeatureFlags`
     for a new capability), `layout` (`PERP_CURRENT_LAYOUT`), its tags from
     the generated `PerpInstruction` and `PerpEvent`, and
     `decode: currentPerpDecoder`;
   - add it to the registration loop;
   - make it `PERP_ABI_LATEST`.
5. **Program hashes.** Add the sha256 of every build you deploy
   (`sha256sum thru-perps/build/thruvm/bin/tn_perp_program.bin` is what the
   program account holds). Deployments of other builds call
   `registerPerpProgramHash` or rely on the ABI account.
6. **Upgrade the on-chain ABI account with the program**
   (`PERPS_UPGRADE=1 pnpm run deploy` in web/perps/tools, without
   `PERPS_SKIP_ABI`). Detection works without this step, but the ABI account
   is the second source.
7. **Tests.** In `versions/versions.test.ts`:
   - decode a fixture of the new layout and one of the previous layout into
     the same domain model;
   - test the feature flags and the tag sets;
   - add the new hash to the detection tests.

   Then run the package tests, typecheck perps-common, perps-tools,
   perps-app and the indexer packages, and run the LiteVM suite
   (`env -u NIX_ENFORCE_NO_NATIVE make -C thru-perps test`).
8. **Consumers:**
   - The indexer names its projection after `version.id`. It keeps
     decoding older slots with the version that was live then (the program
     hash at that slot), so an upgrade does not need a new namespace when the
     domain model is unchanged.
   - The UI gates features on `version.features`.
