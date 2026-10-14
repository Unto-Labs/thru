# Claude Code prompt — Activity detail as a bottom sheet (Thru Wallet PWA)

Copy everything below the line into Claude Code from the repo root. The design files are in `web/packages/design/mobile/design/` (drop the new ones from `handoff/activity-sheet/` there first): `Activity Sheet.dc.html` is the spec — §00 decisions, §01 phone, §02 desktop, §03 motion, §04 component map; it imports `Activity Detail Sheet.dc.html` (the sheet itself), `History Feed`, `History Row`, `History Detail`, `Wallet Home`.

---

You are working in the Thru monorepo. `design/` is `@thru/design`; the wallet is the React Native (Expo) app that runs on the web through react-native-web, built from `@thru/design/mobile`. The **Activity** feed and the full-screen **detail** (`/activity/<signature>`) from the previous PR exist, including `DetailHero`, `MetaTable` with copy, `Disclosure`, `IconTile`, `Badge` tones and the Technical details section that keeps every field of the old screen. This PR replaces the full-screen detail on phones with a **bottom sheet over the feed**, as designed in `Activity Sheet.dc.html`. Follow CLAUDE.md and CONTRIBUTING.md.

## 0. Read first

`@thru/design/mobile`: `theme.tsx`, `tokens.ts`, the kit `Sheet` (scrim, 12 pt top radius, 360 ms slide, two headers, two heights — no grabber, no drag, no intermediate height today), `Button`, `MetaTable`, `Disclosure`, `IconTile`, `StatusText`, `Skeleton`, `Icons.tsx`. Every pixel value below comes from the `.dc.html` files; §04 of the spec maps every element to a kit component or a labelled new primitive — build to that map. No raw hex; square corners except the sheet's top radius; 44 pt hits; hairlines not shadows (sheet shadow and scrim excepted).

## 1. Decisions already made (don't re-litigate)

- **Phone (< 840): the detail is a half-height sheet** over the feed, not a pushed screen. Today's `/activity/<signature>` screen stays only as the ≥ 840 fallback described in §6.
- **Transaction details expand the sheet in place** — no second page, no back button. Tapping the row at half height raises the sheet to full and opens the section in one motion. Drag-up is a shortcut to the same state.
- **Kind in the header, amount + status as the hero.** The sheet header carries the IconTile 32 and the kind name ("Received"); the hero below is the amount 34/700 and the status line. No Status/Type rows.
- **View on ThruScan is pinned at the bottom** as an outline button; **Share is an icon in the header**. "View in explorer" becomes **"View on ThruScan"** → `https://scan.thru.org/tx/<signature>?network=alphanet`, new tab.
- **Header icon buttons are plain** 44 pt (the kit's sheet header), not outlined squares.
- **Desktop ≥ 1024: a 440 right-hand panel** beside the feed; **840–1023: the kit's centred 480 dialog**; the sheet's content in both.
- **Scrim 40 % at the half detent, 64 % at full**, interpolated with the drag. Send and Deposit keep the kit's 64 %.
- Contrast, copy and address rules as in the Activity PR: `fgMuted` secondary text, brick for failed, solid FAILED badge, addresses `ta7Q…x2Lp` in mono never uppercased, U+2212 minus.

## 2. The sheet (`Activity Detail Sheet.dc.html`)

Route stays `/activity/<signature>`; it renders as a modal layer **over the feed route**, which stays mounted at its scroll position. Opened cold from a link or a notification it renders over the feed (feed loading behind it). From Home's Recent activity it opens over Home — no tab change.

Top to bottom, phone layout:
1. **SheetGrabber** (new primitive): 16 pt zone, 36×4 pill `borderStrong`, centred. Decorative — the grabber zone and the header are both drag surfaces.
2. **Header** 52, hairline below, `padding 0 4 0 16`: IconTile 32 (glyph 18; tones as the row — incoming `forestSoft/forest`, pending `saffronSoft/saffron`, failed `brickSoft/brick`, else `bgMuted/fg`) · title 17/600 ellipsised ("Received", "Sent", "Signing session created") · IconButton 44 **Share** · IconButton 44 **Close**.
3. **Hero** (DetailHero compact variant): `padding 20 16 16`; amount 34/700, −0.75 px, line 40 (forest incoming, fg outgoing, `fgMuted` when pending or failed, no strikethrough); status line 14/500 with a 16 glyph — **Completed** forest ✓ · **Pending** saffron clock · **Failed** brick ✕ — then the plain-words reason 14 `fgMuted` ("Waiting for the network to confirm. Usually under a minute." / "Not enough $ in your account when it ran. Nothing left your account."). Account events: no amount; the hero is the status line alone, `padding 16`.
4. **MetaTable** rows 52 (label mono 11 caps 96 wide, value mono 13 right, hairlines): Date & time ("Oct 2, 2026 · 2:14:05 PM"), From, To (own address → **You**), Network ("thru-alphanet"), Signature — copy as IconCopy 16 in a 44 hit on addresses and the signature (copies the full string). Sessions add **Expires**, passkeys add **Device**.
5. **Transaction details** — `Disclosure` h56, 15/500 + chevron 18 (180° in 200 ms), collapsed by default, `aria-expanded`. At the half detent, activating it calls `onExpand` → the sheet rises to full and the section opens in the same 320 ms. Inside, in order: MetaTable **Program** (registry name · shortened address), **Fee payer**, **Slot**, **Instruction**, and **Error** by name in brick when failed ("InsufficientFunds (4)"); then **Decoded data** as **DataCards** (new primitive): 1 px border, 44 header on `bgMuted` with name mono 13/500 + meta mono 11 `fgMuted` ("transfer · instruction 0") + chevron 16, body a key/value grid mono 12/18 (keys `fgMuted`, values wrap anywhere) — **one card per instruction and per event, each expanding on its own, exactly as today's screen**; then **Raw instruction bytes** as a DataCard, collapsed, summary "1 instruction · 164 bytes", **Copy** mono 11 caps in a 44 hit separated by a hairline, body mono 12/18 — the only place hex appears. Keep every field the current Technical details shows; this is a restyle and a move, not a cut.
6. **SheetFooter** (new primitive): pinned below the scrolling body at every detent and scroll position — hairline, 12 above, 16 insets, **View on ThruScan** `Button outline md` 48 full width with ↗ 16, then the 34 safe area (16 in the panel). Live even while loading or after a failed load (the signature is in the URL).

## 3. Detents, drag, dismiss (Sheet · new `detents` variant)

- **Half** = `max(52 % of the screen height, 360)` → 440 on 390×844, 360 on the SE. Body `overflow: hidden`; a scroll gesture on the content drags the sheet. What fits at half: header, hero, Date & time, From, To (SE: Date & time, From); the next row begins under the footer and is the cue to drag.
- **Full** = top 70 (status bar + 16), as Send. Body scrolls; footer pinned.
- **Drag**: follows the finger 1:1 between detents; overdrag past full resists at 0.3×; the scrim tracks the sheet top 40 → 64 %. **Release** snaps to the nearest detent in 320 ms, `cubic-bezier(0.2, 0.8, 0.2, 1)`, no overshoot (the kit has no springs). Below 60 % of the half height, or downward faster than 0.5 px/ms → dismiss. Dragging down from full snaps to half; the section stays open, the body clips again, inner scroll position is kept.
- **Open**: 360 ms slide from the bottom to half; scrim 0 → 40 % over the first 200 ms. **Dismiss**: swipe down, scrim tap, Close, VoiceOver escape, Escape on the web — 360 ms slide out, scrim fades with it. The feed is where it was; focus returns to the row.
- **Live status**: a pending item that confirms or fails while open updates in place — tile tone, status glyph/text and amount colour cross-fade 200 ms, the reason line fades out; the row behind updates with it.
- **Reduce motion**: open/close are a 200 ms fade with no translate; detent changes jump with a 120 ms opacity dip; chevrons rotate instantly; no skeleton pulse.
- Implementation: `react-native-gesture-handler` + `react-native-reanimated` (already in the app) for the pan; on web make sure wheel/trackpad scrolling inside the body at full works and the pan doesn't hijack it. Expose `detent`, `onDetentChange`, `onDismiss`.

## 4. Loading and errors

- **Loading** (opened from a link before data): `DetailSkeleton` in the sheet's shape — header tile 32 + title 120×14; amount 160×30 + status 96×12; four rows 64×9 / 128×11; `bgInset`, 1.4 s pulse. ThruScan live.
- **Couldn't load**: header "Details" with a neutral tile; `InlineError` h44 — alert 16 + "Couldn't load this transaction." 13 brick + **TRY AGAIN** mono 11 caps in a 44 hit; the **Signature** row with copy (from the URL) stays; ThruScan works. Never render an empty body.

## 5. Feed and Home

- `ActivityRow` gains **`selected`**: `bgMuted` + a 2 px brick bar at left while its detail is open (visible behind the half-height sheet and beside the desktop panel).
- Home's Recent activity rows open the same sheet over Home.

## 6. Desktop (web)

- **≥ 1024 — `DetailPanel`** (new primitive): 440 wide, hairline left, the content area's full height, flush with the window's right edge; same header (no grabber), body scrolls, footer pinned with 16 below; `Disclosure` opens in place. The feed column narrows from 880 to the remaining width (656 at 1440) and keeps its header; Close returns it in 320 ms. The selected row is highlighted.
- **840–1023** — the kit's centred 480 dialog with the same content, 64 % scrim, Escape closes.
- Below 840 the phone sheet. Remove the standalone `/activity/<signature>` page once the panel and dialog cover ≥ 840; the URL keeps working everywhere.

## 7. Accessibility

- `role="dialog"`, `aria-modal`; the accessible name is one sentence — **"Sent, −$10.00, Completed"** (title, amount if any, status). Focus moves into the sheet on open (title, then Share, Close) and returns to the row on close. Close is always present at 44 pt; VoiceOver escape and Escape dismiss.
- Nothing requires the drag: the Transaction details row is the non-drag path to full height and announces "Transaction details, collapsed/expanded".
- Every icon-only control has a label (Share, Close, Copy signature, Copy raw instruction bytes); the loading state announces "Loading transaction".

## 8. New / extended components in `@thru/design/mobile` (call out in the PR)

`Sheet` detents variant (half/full, drag, snap, dismiss rules, scrim interpolation), `SheetGrabber`, `SheetFooter`, `DataCard`, `DetailPanel` (web), `DetailSkeleton` composition — new. `DetailHero` compact variant (title moved to the header). `ActivityRow.selected`. `Scrim` 40/64 variant. Reused as-is: `IconTile`, `MetaTable` + copy, `Disclosure`, `StatusText`, `Button`, `InlineError`, `Skeleton`.

## 9. Housekeeping

- Gallery/Storybook: every frame in §01 (9 phone states, light and dark, incl. SE 375×667 and from-Home), §02 (4 desktop), §03 (the three motion frames as stories at fixed progress).
- Tests: detent maths (52 %/360 min; full = top 70); snap and dismiss thresholds; the Disclosure at half calls `onExpand` and the sheet lands at full with the section open; focus moves in and returns to the row; the dialog label sentence; Technical details renders every field the old screen had and each DataCard toggles independently; loading/failed render ThruScan live; the URL opens the sheet over the feed and over Home; ≥ 1024 renders the panel, 840–1023 the dialog.
- Screenshots: half and expanded on 390×844 and 375×667, light and dark; the desktop panel; show them to me.
- Commit in steps: Sheet detents + grabber + footer → sheet content (hero, rows, details, DataCards) → states → feed/Home wiring + selected row → desktop panel/dialog → gallery + tests. PR title: `feat(wallet): Activity detail as a half-height sheet`. Open as a draft; description: the decisions in §1 with their one-line reasons, the detent/drag rules, and before/after screenshots of Technical details proving nothing was dropped.
