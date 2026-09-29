# Kansei

An offline-first Japanese learning PWA. **Current status: usable kana practice
preview, not the complete production application described in the project brief.**

## Run locally

Requires Node 20 or newer and npm.

```sh
npm ci
npm run dev
```

Open the localhost URL printed by Vite. Choose your preferences and install the
learning material inside the app. Development mode does not cache the app shell.
To test offline behavior, use the production build:

```sh
npm run build
npm run preview -- --host 127.0.0.1
```

Open http://127.0.0.1:4173, install the content, and wait for offline readiness.
Then disable networking and reopen the app at the same address. Progress belongs
to that browser origin; different ports do not share it. Export a backup before
clearing browser storage. There is no account or automatic cross-device sync.

Deploy the `dist` directory on HTTPS with navigation fallback to `index.html`.
Serve `sw.js` without a long immutable cache lifetime. Curriculum files are
verified against their manifests; retain the generated paths and bytes.

## GitHub Pages

The [Pages workflow](.github/workflows/pages.yml) installs locked dependencies,
checks TypeScript, runs unit/integration tests, validates shipped content and
kana, builds the production PWA, and runs Chromium offline acceptance tests.
Pull requests to `main` run these checks without publishing. Successful pushes
to `main`, or manual runs on `main`, publish the exact tested `dist` artifact.

In the GitHub repository, select **Settings → Pages → Build and deployment →
Source → GitHub Actions**. Push the workflow to `main` and inspect its run under
**Actions → Build, test and publish PWA**. The deployment URL appears in that
run and in the `github-pages` environment; for this repository it is
https://krouis.github.io/kansei/. No personal access token or deployment secret
is required. See GitHub's [custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

The workflow builds and tests with `VITE_BASE_PATH=/kansei/`. If the repository
is renamed or moved to a custom domain, update this and `PLAYWRIGHT_BASE_PATH`
in the workflow together. Local builds default to `/`.

CI validates the committed curriculum, every packaged file's size and SHA-256,
and cross-dataset references with `content:validate -- --runtime-only`. It does
not download or regenerate upstream dictionaries: those ignored archives have
pinned provenance hashes, while some upstream download URLs change daily.
Full source-archive validation remains a separate local reproduction check.

## What works

- Ten-screen kana sessions, feedback, guided retries, keyboard matching, reading
  entry with IME handling, and local stroke-aware handwriting assessment.
- Skill-specific scheduling, transactional answers and feedback-gated XP:
  1 XP per acknowledged screen plus a single 10 XP series bonus.
- Local progress, charts, backup import/export, reminders and calendar export.
- Offline content installation, real available recordings, reference animation,
  bundled fonts, themes, and About & Science explanations.

## Known limits

Kanji and vocabulary packs contain generated draft data (1,000 kanji and 1,600
words); their explorer and complete course integration remain unfinished.
Placement is not implemented. Kana has recordings for 71 of 104 modern sounds;
yōon recordings are absent. Only 67 selected vocabulary entries have recordings.
Editorial and listening review remain outstanding. Handwriting has synthetic
validation, not representative human finger/stylus/mouse validation. Drawing
and answer drafts are tab-local, whereas submitted answers persist in IndexedDB.
Browser viewport tests do not establish physical-device compatibility.

See [WORK.md](WORK.md) for the itemized remaining work and
[content inventory](docs/CONTENT.md) for provenance, licenses and reproduction.

## Verification

```sh
npm run typecheck
npm test
npm run content:validate -- --runtime-only
npm run check:kana
npm run build
```

To run the browser test, build first as above. Playwright starts its own
production preview on port 4174:

```sh
npx playwright install chromium
npm run test:e2e
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE` can point to an existing Chromium executable.
The browser test installs content, completes ten questions for 20 XP, opens a
new page offline, checks audio and reference availability, and checks phone-width
layout. It does not yet cover every exercise offline or service-worker upgrades.

To additionally validate locally available source archives against their
committed provenance hashes, run `npm run content:validate` without the
`--runtime-only` flag. See the content documentation before downloading fresh
upstream snapshots; they may differ from the original pinned inputs.
