# Macrosaurus 🦖

An adaptive body-composition and macro tracker. UK-first, mobile-friendly, with a
research-backed protein target and macros that retune themselves from weekly check-ins.

The deployed app is a single self-contained file: **`index.html`** at the repo root.
It loads React and Supabase from a CDN and needs no build step to serve.

## Deploy on Vercel (static, zero build)

1. Push this folder to a GitHub repo (see below).
2. In Vercel, click **Add New… → Project** and import the repo.
3. Settings when prompted:
   - **Framework Preset:** Other
   - **Build Command:** leave empty
   - **Output Directory:** leave empty (serves the repo root)
   - **Root Directory:** `.` (the repo root)
4. Deploy. Vercel serves `index.html` and auto-deploys on every push to the main branch.

## Push to GitHub (first time)

From this folder on your machine:

```bash
git remote add origin https://github.com/<you>/macrosaurus.git
git branch -M main
git push -u origin main
```

(The repo is already initialised and committed locally.)

## Editing the app

The app is built from source in `app/`:

- `app/src/app.jsx` — all UI (React, classic JSX)
- `app/src/styles.css` — theme + custom CSS
- `app/engine.js` — the adaptive nutrition engine (pure, unit-tested)
- `app/store.js` — default data shape + helpers
- `app/engine.test.cjs` — engine unit tests (`node app/engine.test.cjs`)

The root `index.html` is the built bundle. When source changes, rebuild it (Tailwind
compile + JSX transpile + inline vendors) and commit the new `index.html`.

## Running it locally

You need Node 22+ (`node -v`). On a Mac: `brew install node`.

```bash
npm install     # once
npm run dev     # http://localhost:5173
```

Save any file under `app/` and the browser reloads with the change. A `styles.css` or
`engine.js` edit rebuilds in well under a second; an `app.jsx` edit takes ~2s, since
that is a full Tailwind scan plus a JSX transpile of a very large file.

Flags (note the `--` so npm passes them through):

```bash
npm run dev -- --open        # open the browser on start
npm run dev -- --port 3000   # different port (default 5173, auto-bumps if taken)
npm run dev -- --host        # also serve on your LAN, to test on a phone
```

Two things worth knowing:

- **`npm run dev` never writes `index.html`.** It builds in memory, so a dev session
  leaves your working tree clean. Run `npm run build` when you want the deployable
  bundle updated for a commit.
- **The service worker is stubbed in dev.** The real `sw.js` caches the app shell,
  which would serve you a stale bundle; the dev server substitutes a no-op worker that
  clears any caches a previous real one left behind. Test service-worker behaviour
  against a real deploy, not locally.

If a build breaks, the page shows the error (with the source line) as an overlay and
keeps serving the last good bundle, so you can fix and save without losing your session.

```bash
npm test        # 317 unit tests, ~1s
npm run build   # rebuild index.html for committing
```

## Backend

Auth and per-user data use Supabase (project `Macrosaurus`, table `user_state`,
row-level security so each user sees only their own data). The Supabase URL and
publishable key are embedded in the client, which is expected and safe; RLS is what
protects the data. AI features (label scan, meal estimate, recipe import, buddy coaching)
run server-side through the `ai-proxy` edge function, which holds the Anthropic key and
enforces the free/premium tiers. No provider key ever reaches the client.
