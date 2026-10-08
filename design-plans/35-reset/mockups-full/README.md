# 35-reset · full mockup

Every screen of the overhauled app in one direction, in paper and dark. Open `index.html` (the gallery)
over http from the repo root (`python3 -m http.server 8142`, then
`http://localhost:8142/design-plans/35-reset/mockups-full/`). It has a Paper/Dark toggle, the new
sitemap at the top, and live 390×844 frames grouped by tab.

| File | What |
|---|---|
| `DESIGN.md` | the visual spec: tokens, type, window, HP meter, dialogue, icons |
| `../01-direction.md` | sitemap (current and new), content budget, logging counts, decisions |
| `metrics.md` | every check, before → after, and every screen's numbers |
| `system.css` | the one stylesheet (tokens + primitives) |
| `tools/kit.py` | the primitives as HTML functions; `tools/icons.py` the pixel icon family |
| `tools/screens_*.py` | the 74 screens, built only from the kit |
| `screens/` | generated: `<id>.html` (paper) and `<id>-dark.html` |
| `shots/` | generated 390×844 screenshots |

Rebuild and re-check (needs the repo root served on :8142, Playwright, and the Impeccable CLI):

```
python3 tools/build.py          # screens/ + screens.json
node tools/audit.mjs mock       # audit.json + shots/   (296 runs)
node tools/audit.mjs app        # before.json           (the current app, ?demo)
impeccable detect --json screens system.css > detect.json
python3 tools/report.py         # metrics.md + metrics.json
python3 tools/gallery.py        # index.html
```

Sprites are copied from `sprites/female/doux` and `web/egg.png`. The fonts are IBM Plex Sans and
Silkscreen (OFL), copied from @fontsource.
