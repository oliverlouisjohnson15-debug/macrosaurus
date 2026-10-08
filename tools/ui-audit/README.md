# ui-audit

Measures screens for the 35-reset budget (`design-plans/35-reset/01-direction.md` §2, §6).

```bash
python3 -m http.server 8765 &                 # from the repo root
NODE_PATH=$(npm root -g) node tools/ui-audit/capture.mjs out 390 844 paper   # app in ?demo (paper|dark)
NODE_PATH=$(npm root -g) node tools/ui-audit/mock.mjs 390 844 light,dark out  # the mockups
```

`measure-lib.mjs` is the collector both scripts share. It reports outer and nested blocks (a ≥2px
frame on all sides, or a fill that differs from what's behind it, at least 120×36), controls,
controls under 44px, and help sentences (sentences of five or more words, outside buttons). The app
bar, the tab bar and anything `aria-hidden` are excluded, and sheets are measured inside the sheet.
Playwright resolves from the global install. Chromium is in `/opt/pw-browsers`.
