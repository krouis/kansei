# Build, verify, and deploy

Everything about producing and hosting a build. For what the app actually
does, start with the [README](../README.md) instead.

## Local build and preview

```sh
npm run build
npm run preview -- --host 127.0.0.1
```

Open `http://127.0.0.1:4173`, install the content, and wait for offline
readiness in Settings. Then disable networking and reopen the app at the
same address — `npm run dev`'s dev server does not cache the app shell, so
offline behaviour can only be checked against a production build. Progress
belongs to the browser origin (host + port); a different port is a different
origin and will not share it.

## Verification

```sh
npm run typecheck
npm test
npm run content:validate -- --runtime-only
npm run check:kana
npm run build
```

Then, having built once already:

```sh
npx playwright install chromium
npm run test:e2e
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE` can point at an existing Chromium executable
instead of installing one. The browser suite installs real content, takes
the placement check, completes a ten-question series for 20 XP, replaces the
service worker and confirms an update is blocked while another tab is open,
stages and activates a content update while diffing every learner/settings
store before and after, then cold-starts a new page fully offline and checks
audio, stroke references, and a phone-width layout. It does not yet cover
every exercise type offline, nor physical devices — see the
[README](../README.md#known-limits).

`npm run content:validate` (without `--runtime-only`) additionally checks
locally available upstream source archives against their committed
provenance hashes; the flag used in CI skips that, since it needs the
original downloaded archives and some upstream URLs are not stable day to
day. See [`docs/CONTENT.md`](CONTENT.md) before fetching fresh upstream
snapshots — they may differ from the pinned inputs the shipped data was
built from.

## Hosting requirements

The `dist/` directory is a static site with two requirements beyond "serve
the files":

- **HTTPS** (or `localhost`) — service workers and several storage APIs
  Kansei depends on refuse to run otherwise.
- **A navigation fallback to `index.html`**, and `sw.js` served without a
  long, immutable cache lifetime — the service worker itself is what decides
  when a new version is safe to activate (see the README's "Updating without
  losing progress"), and a CDN caching `sw.js` for a long time can delay a
  learner ever hearing about an update.

Content pack files under `public/content/` are verified against
`public/content/index.json`'s recorded SHA-256 and byte count at install
time; keep the generated paths and bytes intact when copying the build
output anywhere.

## GitHub Pages

[`.github/workflows/pages.yml`](../.github/workflows/pages.yml) is one
workflow, two jobs:

1. **`build-test`** — installs locked dependencies, runs `typecheck`, `test`,
   `content:validate --runtime-only`, `check:kana`, `build`, then installs
   Chromium and runs `test:e2e` against the real production build. This runs
   on every pull request AND on every push to `main`; a PR only ever runs
   these checks, it never publishes.
2. **`deploy`** — only on a push (or manual run) on `main`, and only after
   `build-test` passes: uploads the exact `dist/` that was just tested as
   the Pages artifact and publishes it via GitHub's OIDC-based
   `deploy-pages` action. No personal access token or repository secret is
   needed.

To turn this on for a fork or a new repository: in **Settings → Pages →
Build and deployment → Source**, choose **GitHub Actions**, then push to
`main` and watch the run under **Actions → Build, test and publish PWA**. The
deployment URL appears in that run's `github-pages` environment link.

The workflow builds and tests with `VITE_BASE_PATH=/kansei/` (a GitHub Pages
project site is served from `https://<user>.github.io/<repo>/`, not the
domain root, so every absolute asset/content/service-worker path needs that
prefix baked in at build time). If the repository is renamed, forked, or
moved to a custom domain, update `VITE_BASE_PATH` here and
`PLAYWRIGHT_BASE_PATH` together — they must always agree, since the E2E
suite navigates using the same prefix the production build was compiled
with. A local `npm run build` with neither variable set defaults to `/`.

## Updates, in the detail the README's summary leaves out

The README states the guarantee learners see; this is the mechanism.

- **App-shell updates** are checked on launch, on reconnect, and hourly
  while the tab is visible (`src/app/registerSW.ts`). A new worker installs
  and waits — it never calls `skipWaiting()` on its own. Activating one is
  deferred while a session is active or a save is in flight, and is refused
  outright if another Kansei tab/window is open (checked via a
  `BroadcastChannel`-style `postMessage` round trip,
  `registerSW.ts`'s `ensureSingleAppWindow`), so an update can never swap
  code out from under a learner mid-series in one tab while another tab is
  still relying on the old one. IndexedDB itself is untouched by a
  shell update — see `docs/DATA-MODEL.md`'s migration policy for what
  happens to the data across a schema change that ships alongside one.
- **Content updates** use the generation mechanism described in
  `docs/ARCHITECTURE.md`: downloaded and fully verified into a new,
  separately named cache before a single pointer write activates it, so a
  failed or interrupted download can never leave the active curriculum
  partially replaced. Old generations are not yet garbage-collected, which
  means an update costs extra storage until that is implemented — tracked
  in `WORK.md`, not hidden.

Both are validated by the same E2E spec described above: a real worker
replacement, a real staged content revision, and a full before/after diff of
every learner and settings store, run against the actual production build in
a real (if single) browser and device configuration. Report what was
actually tested, not what should logically hold — this project has not been
tested across the full matrix of browsers, physical devices, and migration
paths the finished product would need.
