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
npm run content:validate
npm run check:kana
npm run build
```

With the production preview already running on port 4173:

```sh
npx playwright install chromium
npx playwright test
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE` can point to an existing Chromium executable.
The browser test installs content, completes ten questions for 20 XP, opens a
new page offline, checks audio and reference availability, and checks phone-width
layout. It does not yet cover every exercise offline or service-worker upgrades.
