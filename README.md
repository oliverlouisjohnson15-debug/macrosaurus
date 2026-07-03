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

## Backend

Auth and per-user data use Supabase (project `Macrosaurus`, table `user_state`,
row-level security so each user sees only their own data). The Supabase URL and
publishable key are embedded in the client, which is expected and safe; RLS is what
protects the data. AI photo features (label scan, meal estimate) use a Gemini key
each user pastes in Settings, stored in their account.
