# Activity redesign — design files

Drop this folder's contents into `web/packages/design/mobile/design/` (keep the `assets/` subfolder next to the HTML files).

Open `History.dc.html` in a browser — it is the spec: 00 decisions, 01 feed, 02 row catalogue, 03 feed states, 04 detail, 05 Home, 06 desktop, 07 component map. It imports `History Feed`, `History Row`, `History Detail` and `Wallet Home` from the same folder, plus `thru-mobile-tokens.css`, `support.js`, `browser-window.jsx` and `assets/`. Nothing else is needed; fonts load from Google Fonts.

`claude-code-prompt-activity.md` is the implementation brief.

## Activity detail sheet

`Activity Sheet.dc.html` is the spec for the follow-up that turns the detail into a half-height sheet on phones and a right-hand panel on desktop: 00 decisions, 01 phone, 02 desktop, 03 motion, 04 component map. It imports `Activity Detail Sheet.dc.html` (the sheet itself) and the Activity files above; `History Feed` and `History Row` gained the selected-row state. `claude-code-prompt-activity-sheet.md` is its implementation brief.
