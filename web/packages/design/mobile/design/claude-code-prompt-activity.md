# Claude Code prompt — Activity feed (History redesign) for Thru Wallet

Copy everything below the line into Claude Code from the repo root. Attach `History.dc.html` (the full spec: decisions, feed, row catalogue, states, detail, Home, desktop, component map), `History Feed.dc.html`, `History Row.dc.html`, `History Detail.dc.html`, `Wallet Home.dc.html` and `thru-mobile-tokens.css`.

---

You are working in the Thru monorepo. `design/` is `@thru/design`; the wallet is the React Native (Expo) app that also runs on the web through react-native-web, built from `@thru/design/mobile`. Redesign the **History** screen as a readable activity feed, plus the detail screen behind each row, exactly as designed in the attached files. Follow CLAUDE.md and CONTRIBUTING.md.

## 0. Read the design system first

Everything visual comes from `@thru/design/mobile`: `theme.tsx` colours, `tokens.ts` (`space`, `text`, `touch`, `font`), the kit components (`Cell`, `Badge`, `Segmented`, `SectionLabel`, `Card`, `MetaTable`, `SummaryRows`, `Skeleton`, `StatusText`, `Button`, `NavBar`, `TabBar`) and `Icons.tsx`. No raw hex; square corners; hairlines not shadows; 44 pt minimum hit target; cells 56 pt; separators inset 16. Inter Tight for text, JetBrains Mono for numbers, addresses, section labels, caps meta lines and button labels. Section 07 of `History.dc.html` maps every element to a kit component or a labelled new primitive — build to that map.

## 1. Decisions already made (don't re-litigate)

- Screen name **Activity** — page title, tab label (was History), desktop nav. Home's "Recent activity · VIEW ALL →" lands here.
- Filter presets **All · Deposits · Transfers · Account** in the kit `Segmented` (44 pt, fixed). No Failed filter.
- **Clock time** on rows under day labels ("Today", "Yesterday", "Sep 28"); no relative times.
- Failed items stay in the list with their kind and amount and a **FAILED badge**; pending items get a **PENDING badge**.
- Deposit rows are titled **Deposit**; the subline is the source (Card, Crypto · Base, Test tokens). One row type for all three.
- **Signing session** everywhere (Settings currently says "Session key" — change it in the same PR, list it in the description).
- Rows lead with a **per-kind icon** (IconTile), not the 8 pt status marker.
- Contrast: secondary text (sublines, times, day labels) uses `fgMuted`, not `fgSubtle` (2.5:1 on light). Failed uses `destructive` brick, not the validation red (3.4:1 on light). The FAILED badge is a **solid** brick fill with `bg` text (new Badge tone `error`); PENDING uses the existing `warn` tone.
- Addresses are 46-char base58 strings starting with `ta`; always shortened `ta7Q…x2Lp` (4 + … + 4) in mono, **never uppercased** (the old caps meta line printed a string you couldn't copy). The wallet's own address reads **You** in label/value rows.
- Amounts are the dollar token, shown as `$`. Signs: `+$25.00` incoming in `forest`, `−$10.00` outgoing in `fg` (U+2212 minus), pending and failed amounts in `fgMuted`, no strikethrough.

## 2. Data model — map chain events to row kinds

Replace instruction-named rows ("Validate passkey", "Transfer $", slot sublines, Executed/Failed badges) with a classifier that turns each signature into one `ActivityItem`:

```ts
type ActivityKind =
  | 'sent' | 'received' | 'deposit'
  | 'account_created' | 'signed_in'
  | 'session_created' | 'session_ended'
  | 'passkey_added' | 'passkey_removed'
  | 'other';
type ActivityStatus = 'done' | 'pending' | 'failed';
interface ActivityItem {
  id: string; signature: string; kind: ActivityKind; status: ActivityStatus;
  at: Date; title: string; sub?: string;           // sub: "to taB3…9kDe", "Safari on iPhone", "Expires Oct 6, 9:41 AM", "Card"
  amount?: { value: bigint; decimals: number; sign: '+' | '-' };
  counterparty?: string; device?: string; expiresAt?: Date; program?: string;
  failureReason?: string;                            // plain words, see §5
}
```
Rules: `sent`/`received` by direction relative to the wallet; `deposit` for card (Coinbase), crypto (Unifold) and test-token credits alike; `signed_in` with device/browser when the auth record has it ("Safari on iPhone"); `session_created` carries `expiresAt`; `passkey_added`/`removed` carry the device name when known; anything unrecognised is `other`, titled by the program's registry name or **"Unknown program"** with the shortened program address as the subline — never raw data. Pending = submitted, not yet confirmed (optimistic insert at the top of Today). Failed = confirmed with an error; keep the kind and the amount.

Filter mapping: Deposits → `deposit`; Transfers → `sent`, `received`; Account → `account_created`, `signed_in`, `session_*`, `passkey_*`; All → everything including `other`.

## 3. Feed (`History Feed.dc.html`, §01 and §03 of the spec)

Phone, top to bottom: status bar · large title **Activity** 28/700 (collapses to the 52 pt NavBar on scroll — NavBar large variant) · `Segmented` inset 16, 8 below · day groups: `SectionLabel` (mono 11 caps, `fgMuted`, 20 above / 8 below, sticky) + hairline + rows · **Load more** = `Button` ghost md 48, inset 16 (spinner while fetching the next page) · `TabBar` 56 + safe area, Activity active in brick. Pull-to-refresh at the top (kit, threshold 72).

**ActivityRow** (new primitive, extends `Cell`, h56, press `bgMuted`, separator inset 16):
- **IconTile** (new primitive): 32 pt square soft fill + 18 pt stroke glyph. Tones: neutral `bgMuted`/`fg`; incoming (received, deposit) `forestSoft`/`forest`; pending `saffronSoft`/`saffron`; failed `brickSoft`/`destructive`. Glyphs (add to `Icons.tsx`, 1.5 stroke, square caps, 24 viewBox — paths are in `History Row.dc.html`): arrow-out (sent), arrow-in (received), tray (deposit), wallet (account created), sign-in, clock (sessions), key (passkeys — a plain key, **not** the FIDO mark, which is reserved for ceremony buttons), code (other).
- Title 15/500 Inter Tight, one line, ellipsis · `Badge` PENDING (warn) / FAILED (error) after the title, 8 gap · sub mono 11 `fgMuted`, one line.
- Right column: amount mono 14/500 (omitted for account events) over time mono 11 `fgMuted` ("2:16 PM"); without an amount the time is vertically centred.
- Accessibility: the row is the control (`accessibilityRole="button"`), children hidden; one sentence label: **"Received $25.00 from ta7Q…x2Lp, 2:14 PM"**, **"Sent $10.00 to taB3…9kDe, pending, 2:16 PM"**, **"Signing session created, Expires Oct 6, 9:41 AM, 9:40 AM"**. Press → detail.

**States** (§03), each for every filter:
- **loading** — `Skeleton` composed as ActivityRowSkeleton (label 56×10; tile 32; lines 132×12 / 92×9; right 52×12 / 40×9; `bgInset`, opacity pulse 1.4 s, respects reduce-motion). The Segmented stays live; switching filters shows skeletons, never a flash of empty.
- **load failed, nothing loaded** — EmptyState (new primitive), error variant: "Couldn't load your transactions" (noun follows the filter: deposits / transfers / account activity) · body "Check your connection and try again." · `Button` outline md **Try again**. Centred in the list area, above the tab bar.
- **rows on screen, refresh failed** — InlineError (new primitive): one 44 pt line above the rows, alert glyph 16 + "Couldn't refresh — showing what loaded earlier." in brick + **RETRY** mono 11 caps in a 44 pt hit; `role=alert`; rows stay; clears on the next successful refresh.
- **empty** — "No transactions yet" / "No deposits yet" / "No transfers yet" / "No account activity yet" with the one-line bodies from the spec. **Empty is only ever rendered after a load that succeeded** — a failed load is never drawn as empty. Encode this in the state machine (`idle → loading → ready | failed`; `ready` with zero items is the only way to reach empty).

## 4. Home → Recent activity (`Wallet Home.dc.html`, §05)

Home's existing card shows the **three newest** `ActivityItem`s with the same ActivityRow (no day labels; the time column carries it). "VIEW ALL →" opens Activity. Remove the old dot-marker rows and the uppercased meta line.

## 5. Detail screen (`History Detail.dc.html`, §04)

Route `/activity/:signature`. NavBar 52 with back + "Details". Then:
- **DetailHero** (new primitive): IconTile 48 (glyph 24) · title 20/600 · amount 34/700 (omitted for account events) · status line 14/500 with a 16 pt glyph: **Completed** (forest, check) · **Pending** (saffron, clock) · **Failed** (brick, ✕) — followed by the reason in plain words, 14 `fgMuted`. Map program errors to sentences: `InsufficientFunds` → "Not enough $ in your account when it ran. Nothing left your account."; pending → "Waiting for the network to confirm. Usually under a minute."; unknown → "The network rejected it." Keep the raw code for the technical rows.
- **MetaTable** rows (h52, label mono 11 caps 96 wide, value mono 13 right, hairlines): Date & time ("Oct 2, 2026 · 2:14:05 PM"), From, To (own address → "You"), Network ("thru-alphanet"), Signature (shortened). Addresses and the signature get a copy affordance (`IconCopy` 16 in a 44 pt hit, copies the full string). Sessions add **Expires**; passkeys add **Device**. Account events use the same layout without amount rows.
- Actions: `Button` outline md × 2, paired 50/50, gutter 12 — **View in explorer** (↗) and **Share** (native share sheet / Web Share, copy fallback).
- **Technical details** — see §6.

## 6. Technical details — keep today's functionality, restyle it

**Do not drop what the current detail screen can do.** Today it shows Signature, Program and Fee payer, then expandable cards of decoded ABI data and raw hex. Keep every one of those fields and the ability to expand each decoded instruction / data card — the redesign only moves them behind one collapsed **Technical details** disclosure and restyles them in the kit's language. This applies on **both web and mobile**.

- **Disclosure** (new primitive): a 56 pt header "Technical details" 15/500 with an 18 pt chevron that rotates 180° (200 ms), `aria-expanded` / `accessibilityState.expanded`, **collapsed by default**, remembers nothing between items.
- Inside, in this order: a `MetaTable` with **Program** (registry name + shortened address), **Fee payer** (shortened, or You), **Slot**, **Instruction**, and the **Error** code when failed; then the existing **decoded data**, one expandable card per instruction/account section exactly as today — restyled as `Card` on `bgMuted`, mono 12/18 key/value grid (key `fgMuted`, value `fg`, wraps anywhere), each card's own header a 44 pt tappable row with a chevron so individual cards still expand and collapse; then the existing **raw hex** card, also collapsible, mono 12, with its Copy button. Nothing raw appears above the disclosure. The spec's expanded frames show the first decoded card open; use them for type and spacing, and keep the per-card expand/collapse behaviour from the current implementation.
- Mobile: the same Disclosure + cards inside the detail's ScrollView; long values wrap, never overflow; copy buttons are 44 pt.

## 7. Desktop (web ≥ 1024, §06)

**DesktopShell** (new primitive, web only): left sidebar 240 — lockup 64, nav rows 44 (icon 20 + 15/500; active `bgMuted` + 2 px brick bar at left) for **Home · Activity · Settings**, account row 64 at the bottom — and a page column centred with 40 px side padding, capped at **880** for the feed and **800** for the detail. Feed header: title 28/700 left, `Segmented` 440 wide right. Detail: "← Activity" mono 12 replaces the NavBar; the two action buttons sit at natural width, gutter 12. Below 1024 the phone layout renders unchanged.

## 8. Theming and accessibility

- Light and dark from `ThemeProvider`; check the IconTile soft fills, the solid FAILED badge, brick status text and the InlineError line in dark (values in the "Contrast and copy calls" card of §00).
- Dynamic type: titles and sublines may grow; rows grow in height rather than clipping below 56.
- Reduce motion: no skeleton pulse, instant chevron.
- Every icon-only control has a label; day labels are headers for assistive tech; the list announces "Loading activity" while loading.

## 9. New / extended components in `@thru/design/mobile` (call out in the PR)

`ActivityRow`, `IconTile`, `EmptyState`, `InlineError`, `DetailHero`, `Disclosure`, `DesktopShell` (web) — new. `Badge` gains tone `error` (solid brick, bg text). `NavBar` gains a large-title variant. `MetaTable` gains an optional per-row copy action. New glyphs in `Icons.tsx` as listed in §3. Reused as-is: `Segmented`, `SectionLabel`, `Cell`, `Card`, `Skeleton`, `StatusText`, `Button`, `TabBar`.

## 10. Housekeeping

- Gallery/Storybook: the row catalogue (§02: 10 kinds × done / pending / failed, light and dark), the four feed states for All and Deposits, the three detail screens with Technical details collapsed and expanded, and the two desktop frames.
- Tests: the classifier (one fixture per kind, plus pending and failed variants, plus an unknown program); filter mapping; the feed state machine (failed load never renders empty; refresh failure keeps rows); the row accessibility sentence; address shortening and the "You" substitution; Technical details keeps every field the current screen shows and each decoded/raw card still expands independently.
- Copy changes to list in the PR: tab label History → Activity; page title "Transaction History" → "Activity"; Settings "Session key" → "Signing session".
- Commit in steps: classifier + model → ActivityRow/IconTile/Badge → feed + states → detail + Technical details (keeping today's fields) → Home card → desktop shell → gallery + tests. PR title: `feat(wallet): Activity feed and detail on @thru/design/mobile`. Open as a draft.
