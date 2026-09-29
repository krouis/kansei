import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.VITE_BASE_PATH || '/';
if (!base.startsWith('/') || !base.endsWith('/') || base.includes('..')) throw new Error('VITE_BASE_PATH must be an absolute path ending in /.');

export default defineConfig({
  base,
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [
    react(),
    {
      name: 'static-pages-entrypoints',
      async writeBundle(options) {
        const out = resolve(options.dir ?? 'dist');
        const html = await readFile(resolve(out, 'index.html'), 'utf8');
        // Pages has no SPA rewrite rule. Real section entrypoints also work
        // before a service worker has been installed.
        for (const section of ['practice', 'characters', 'progress', 'settings', 'about']) {
          await mkdir(resolve(out, section), { recursive: true });
          await writeFile(resolve(out, section, 'index.html'), html);
        }
        const manifest = JSON.parse(await readFile('public/manifest.webmanifest', 'utf8'));
        const atBase = (path: string) => base + path.replace(/^\//, '');
        manifest.id = base;
        manifest.scope = base;
        manifest.start_url = atBase(manifest.start_url);
        for (const icon of manifest.icons) icon.src = atBase(icon.src);
        for (const shortcut of manifest.shortcuts) {
          shortcut.url = atBase(shortcut.url);
          for (const icon of shortcut.icons) icon.src = atBase(icon.src);
        }
        await writeFile(resolve(out, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));
        await writeFile(resolve(out, '.nojekyll'), '');
      },
    },
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: null,
      manifest: false,
      injectManifest: {
        // The app shell + fonts are precached. Content packs are fetched on
        // demand by the installer and cached by the service worker, so they are
        // deliberately excluded from the precache manifest.
        globPatterns: ['**/*.{js,css,html,woff2,svg,png,ico,webmanifest}'],
        globIgnores: ['**/content/**'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
      devOptions: { enabled: false, type: 'module' },
    }),
  ],
  build: { target: 'es2022', sourcemap: true, assetsInlineLimit: 0 },
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
