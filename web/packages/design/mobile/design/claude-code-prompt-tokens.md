# Claude Code prompt — Tokens list, token screen, receive (Thru Wallet PWA)

Copy everything below the line into Claude Code from the repo root. Drop the files from `handoff/tokens/` into `web/packages/design/mobile/design/` first (next to the Activity files from the earlier handoffs). `Tokens.dc.html` is the spec — §01 Home, §02 Tokens screen, §03 token screen, §04 Receive, §05 two columns, §06 handoff note with the component map, rules and open questions. It imports `Wallet Home Tokens`, `Token List`, `Token Row`, `Tokens Screen`, `Token Screen`, `Receive Thru Sheet` and the existing `History Row`.

---

You are working in the Thru monorepo. `design/` is `@thru/design`; the wallet is the React Native (Expo) app that runs on the web through react-native-web, built from `@thru/design/mobile`. Replace Home's "Balances" row and the read-only "Token holdings" list with one **Tokens** list that opens a **token screen** per row, and give **Receive** two paths decided by the token. Build exactly what `Tokens.dc.html` shows. Follow CLAUDE.md and CONTRIBUTING.md. Only use the kit: `Cell`, `TokenMark`, `SectionLabel`, `Card`, `Badge`, `Skeleton`, `BalanceHero`, `Button`, `Sheet`, `AddressField`, `Callout`, `Snackbar`, `MetaTable`, `NavBar`, plus `InlineError`, `EmptyState` and `DesktopShell` from the Activity work. Three new kit parts are proposed in §6 — add them to `@thru/design/mobile` and say so in the PR.

## 1. Decisions already made

- **Home shows four rows** under a `SectionLabel` **Tokens**: THRUSD first, then the next three tokens by ticker A→Z. **VIEW ALL →** (mono 11 brick, 44 pt hit, accessible name "View all tokens") appears in the label row only when more exist and pushes the **Tokens** screen. Home must not scroll at 390×844: the stack is 619 px in a 631 px viewport — Tokens label 24 above / 8 below, Recent activity label 20 above, trailing spacer 4; Recent activity shows **two** rows when the token list is full (four rows) and three otherwise.
- **Row visual = today's Balances row**, applied to every token: `Cell` h64, `TokenMark` 28, ticker 15/500, subtitle mono 11 `fgMuted`, amount mono 14 right, hairlines inset 16, press `bgMuted`, **no chevron** — the whole row taps. THRUSD's subtitle is **"56 THRUSD"** (units + ticker) and its right value **$56.00**; every other row's subtitle is the **shortened mint** (`taZt…9Kq2`, 4…4, never uppercased) and its right value the **exact token amount**.
- **No prices.** The only dollar figure anywhere is THRUSD's ($1). No fiat for other tokens, no 24 h change, no portfolio total; the Home hero is labelled **Balance** and is the THRUSD balance.
- **Header top right is Settings** (sliders glyph, 44 pt), not scan. A small network badge (forest dot + ALPHANET / BETANET, mono 10 caps) sits beside the account chip — drop it if the existing header label already covers this.
- **Receive by token:** THRUSD, ETH, BTC → the existing Deposit sheet (Unifold) with the source pre-selected (THRUSD → USDC on Solana, ETH → ETH on Ethereum, BTC → BTC on Bitcoin); ETH and BTC show a `Callout` **"Arrives in your wallet as THRUSD"** before the handoff; THRUSD's path is plain. Any other token → the **Receive on Thru** sheet.
- Contrast and copy as the Activity handoff: `fgMuted` for secondary text (not `fgSubtle`), brick for errors, addresses 4…4 mono, U+2212 for minus.

## 2. Data

```ts
interface TokenHolding {
  mint: string;            // 46-char base58, "ta…"
  ticker: string | null;   // null → "Unknown token"
  decimals: number | null; // null → unsupported
  spendable: bigint;       // in this account
  other: bigint;           // in other token accounts the wallet owns (Send can't spend)
  frozen: boolean;
  isThrusd: boolean;
}
```
Sort: THRUSD first, then ticker A→Z (case-insensitive); duplicates keep mint order; "Unknown token" last. Format amounts in the token's own decimals (up to 9), thousands separators, no trailing zeros, never truncated — the title ellipsises first; at Dynamic Type XL a row whose amount exceeds 60 % of its width grows and stacks the amount under the title. Unknown decimals → the raw integer with "units". THRUSD comes from the chain and renders immediately; other tokens come from the indexer.

## 3. Home (`Wallet Home Tokens.dc.html`, `Token List.dc.html`, `Token Row.dc.html`)

- **Normal:** label row Tokens + VIEW ALL →, four rows, Recent activity two rows.
- **Loading:** THRUSD row at once; three `Skeleton` rows (disc 28; 72×12 / 96×9; 64×12; `bgInset`, 1.4 s pulse, none under reduce-motion); label right reads LOADING…; no VIEW ALL until the count is known.
- **Indexer unavailable:** THRUSD row, then `InlineError` h44 inside the group: alert 16 + "Couldn't load other tokens" 13 brick + **RETRY** mono 11 caps in a 44 pt hit, `role=alert`. Never render this as empty.
- **Empty (only THRUSD):** one row + a 13 `fgMuted` line "Other tokens you receive on Thru will show here." — only after a load that succeeded. Label right = 1 TOKEN.
- **Duplicate tickers:** two COOL rows told apart by their mint subtitles; the accessible name includes the mint. **Frozen** and **unsupported** tokens get a neutral `Badge` (FROZEN / UNSUPPORTED) after the ticker, 8 gap, and still open their screen.
- Accessible names: "THRUSD, $56.00, open"; "COOL, 1,250.5, taZt…9Kq2, open" for duplicates and unknowns; badges add "frozen" / "unsupported".

## 4. Tokens screen (`Tokens Screen.dc.html`)

Pushed from VIEW ALL →. `NavBar` 52 back / **Tokens**. The same `Token List` uncapped, label 20 above, count mono 11 caps right ("18 TOKENS"), pull-to-refresh, same states as Home. Edge cases must render: BONK 1,234,567,890.123456789; COOL × 2; ICE FROZEN; LONGTICKERNAME16 (fits at 15/500 — ellipsis only beyond that); Unknown token with a "?" mark and UNSUPPORTED, raw 12,000,000.

## 5. Token screen (`Token Screen.dc.html`)

Route `/token/<mint>`, pushed from a row; back returns to the list it came from.
- `NavBar` 52: back / ticker 17/600 / 44 pt spacer.
- Header: `TokenMark` 48 (ThruUsdLogo for THRUSD; fg disc with the ticker's first two letters mono 16/600; "?" sans 22/600 when unknown) + ticker 20/600 + name line 13 `fgMuted` ("Dollars on Thru" / "Token on Thru" / the shortened mint when the ticker is unknown).
- **AddressRow** (new kit part, §6): the full 46-char mint, mono 12/18 wrapping (two lines at 390), in a 1 px `border` box with a 44 pt **Copy** attached at the right behind a hairline. Copies the full string; confirm with the kit `Snackbar`.
- `BalanceHero` **Spendable**: 34/700 amount + ticker mono 15 `fgMuted` (THRUSD shows $56.00, no unit). When `other > 0`, a secondary line mono 13 `fgMuted` **"+ 120.5 in other accounts"** with an info glyph 14, as a 44 pt button with `aria-expanded`; it toggles a `Callout` `bgMuted` 13/19: "Send spends from this account only. 120.5 COOL sits in other token accounts you own on Thru. Move it into this account to send it."
- Actions: `Button` primary **Send** + secondary **Receive**, h48, gutter 12, 50/50.
  - Send opens the existing Send flow with this token pre-selected (pass the mint; don't redesign Send).
  - Disabled with a reason line under the pair (info 14 + 13 `fgMuted`, 10 below; Send at 40 % opacity, `aria-disabled`, `aria-describedby` the reason): **"Nothing to send"** (spendable 0), **"This token is frozen"**, **"Unsupported token"** (unknown decimals). Receive stays live.
  - Receive: see §1 — Deposit handoff for THRUSD/ETH/BTC (ETH/BTC show the "Arrives in your wallet as THRUSD" `Callout` with body "ETH you deposit is converted on the way in and lands as dollars."), Receive on Thru sheet for everything else.
- Details `MetaTable` rows 52: **Decimals** (or "Unknown"), **Network** ("thru-alphanet"), **Receive via** ("Deposit · USDC on Solana" / "Deposit · ETH on Ethereum" / "Thru Alphanet"). No history list in this ticket.
- **Not found** (token not held or bad link): `NavBar` "Token" + `EmptyState`: "?" disc 48 `bgMuted`, "This token isn't in your wallet" 17/600, "It may sit in another account, or the link is out of date." 14 `fgMuted`, `Button` secondary **Back to Home**.

## 6. Receive on Thru sheet (`Receive Thru Sheet.dc.html`)

Kit `Sheet`, content height on phones (58 below = 24 + home indicator), the centred 480 dialog ≥ 640 (24 below, radius 12, 64 % scrim, Escape closes). Leading title **"Receive COOL"** + Close 44. Then, centred, 16 gaps:
- **QRCard** (new kit part): 200 box, 1 px `#B6CECE`, 10 pad, modules `#181B1B` on `#F9FBFB` **in both themes** (dark-on-light always), error correction H, the Thru mark 32 knocked out on a 3 px `#F9FBFB` pad. Encodes the bare address. `aria-label` "QR code of your address".
- Copy line 15/500: **"Send COOL to this address on Thru Alphanet"** (ticker mono).
- **AddressCard** (new kit part): the full address mono 13/1.5 centred in a 1 px `borderStrong` box; an attached 44 pt row below with **Copy address** | **Share**, hairline between, `bgMuted`. Copy → **"Copied"** with a check in forest for 1.2 s, `aria-live`. Share = Web Share with the address, copy fallback.
- `Callout` warn (`saffronSoft`, triangle 16 saffron): **"Only Thru Alphanet transfers arrive here."** + "Tokens sent from any other network can't be recovered." 13 `fgMuted`.
Network name follows the active network (Alphanet / Betanet).

New kit parts (nothing in the kit fits): **AddressRow** (read-only address + copy — `AddressField` is an input), **QRCard**, **AddressCard**. Reused: everything else, incl. `InlineError`, `EmptyState`, `DesktopShell` from Activity.

## 7. Layouts and platform

- Phone 390×844 with safe areas (62 top in the installed app, 34 home indicator). Light and dark from the provider — letter marks invert (fg disc, bg glyph); the ThruUSD mark keeps brick; the QR stays dark-on-light.
- **≥ 640:** the phone stack centred; sheets become the 480 dialog.
- **≥ 1024 (web):** `DesktopShell` sidebar 240 (lockup + network badge, nav 44, account); **Tokens column 440** — Balance 34/700 + the full `Token List`, the open token highlighted (`bgMuted` + 2 px brick bar; add `selected` to the row); the **token screen column capped at 640**, 40 side padding, "Details" without a NavBar. Receive on Thru opens as the dialog.
- 44 pt hit targets everywhere; Dynamic Type up to XL without truncating amounts; every row and button has the accessible name above; the explainer and VIEW ALL are real buttons/links.

## 8. Housekeeping

- Gallery/Storybook: Home × 5 states, Tokens screen × 3, token screen × 7 (incl. ETH/BTC handoff notes), Receive on Thru phone + dialog + copied, two-column light and dark — matching §01–§05 of the spec.
- Tests: sort order (THRUSD first, ticker A→Z, duplicates by mint, unknown last); amount formatting incl. 9 decimals and raw units; Home cap = 4 and VIEW ALL only when more exist; Recent activity 2 vs 3 rows; failed indexer never renders empty; accessible-name strings; Send disabled reasons; Receive routing per token (THRUSD/ETH/BTC → Deposit with the right source, others → Receive on Thru); QR encodes the address; Copy/Share fallbacks; not-found route.
- Screenshots: Home normal/loading/error, Tokens screen scrolled, token screen COOL with the explainer open, Receive on Thru phone and dialog — light and dark; show them to me.
- Commit in steps: data + sort/format → Token Row/List + Home → Tokens screen → token screen → Receive on Thru + new kit parts → two-column → gallery + tests. PR title: `feat(wallet): Tokens list, token screen and Receive on Thru`. Open as a draft; the description lists the three new kit parts, the no-chevron decision, and the open questions from §06 of the spec (Spendable vs Balance label, header network badge, THRUSD Receive default).
