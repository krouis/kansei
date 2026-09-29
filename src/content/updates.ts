import type { PackIndex, PackInstallState } from '@/domain';
import { CONTENT_CACHE, DEFAULT_CONTENT_BASE_URL } from './cacheNames';
import { sha256Hex } from './digest';
import { createInstaller } from './installer';
import type { InstallProgress } from './ports';
import { resolvePackUrl } from './packSource';
import { parsePackIndex } from './validate';

export const CONTENT_CONTROL_CACHE = `${CONTENT_CACHE}-control`;
export interface ContentUpdateOptions {
  cacheStorage?: CacheStorage;
  fetchImpl?: typeof fetch;
  crypto?: Crypto;
  baseUrl?: string;
  signal?: AbortSignal;
}
export interface PreparedContentUpdate { cacheName: string; states: PackInstallState[] }
const generationPrefix = `${CONTENT_CACHE}-generation-`;
const base = (o: ContentUpdateOptions) => o.baseUrl ?? DEFAULT_CONTENT_BASE_URL;
const storage = (o: ContentUpdateOptions) => o.cacheStorage ?? globalThis.caches;
const pointer = (o: ContentUpdateOptions) => resolvePackUrl(base(o), 'active-generation');

/** One pointer write selects a complete generation; no learner records are touched. */
export async function getActiveContentCacheName(options: ContentUpdateOptions = {}): Promise<string> {
  const cached = await (await storage(options).open(CONTENT_CONTROL_CACHE)).match(pointer(options));
  if (!cached) return CONTENT_CACHE;
  const value: unknown = await cached.json();
  if (typeof value !== 'object' || value === null || !('cacheName' in value) ||
      typeof value.cacheName !== 'string' || !new RegExp(`^${generationPrefix}[a-f0-9]{64}$`).test(value.cacheName)) {
    throw new Error('The installed content generation record is invalid. Saved learning data has not been changed.');
  }
  return value.cacheName;
}

function networkFetch(options: ContentUpdateOptions): typeof fetch {
  const fetcher = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  return (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return fetcher(`${url}${url.includes('?') ? '&' : '?'}kansei-update=1`, {
      ...init, cache: 'no-store', signal: options.signal ?? init?.signal,
    });
  };
}
function checkedIndex(raw: unknown, schemaVersion: number): PackIndex {
  const parsed = parsePackIndex(raw);
  if (!parsed.index || parsed.issues.length || parsed.index.schemaVersion !== schemaVersion || !parsed.index.packs.length) {
    throw new Error('The available content index is invalid or needs a newer app.');
  }
  const ids = parsed.index.packs.map(p => p.id);
  if (new Set(ids).size !== ids.length) throw new Error('The content index repeats a pack identifier.');
  const files = new Map<string, string>();
  for (const pack of parsed.index.packs) for (const file of pack.files) {
    const signature = `${file.sha256}:${file.bytes}`;
    if (files.has(file.path) && files.get(file.path) !== signature) {
      throw new Error('Content packs disagree about a shared file.');
    }
    files.set(file.path, signature);
  }
  return parsed.index;
}

/** Network-only discovery never replaces the installed index. */
export async function checkContentUpdate(currentIndex: PackIndex, options: ContentUpdateOptions = {}): Promise<PackIndex | null> {
  const response = await networkFetch(options)(resolvePackUrl(base(options), 'index.json'));
  if (!response.ok) throw new Error(`Content update check failed: HTTP ${response.status}.`);
  const candidate = checkedIndex(await response.text(), currentIndex.schemaVersion);
  return JSON.stringify(candidate) === JSON.stringify(currentIndex) ? null : candidate;
}

/** Stage a full generation. A failed download leaves the active pointer and cache untouched. */
export async function prepareContentUpdate(
  candidate: PackIndex, currentCache: string, onProgress: (progress: InstallProgress) => void,
  options: ContentUpdateOptions = {},
): Promise<PreparedContentUpdate> {
  const index = checkedIndex(candidate, candidate.schemaVersion);
  const serialized = JSON.stringify(index);
  const hash = await sha256Hex(new TextEncoder().encode(serialized), options.crypto ?? globalThis.crypto);
  const cacheName = `${generationPrefix}${hash}`;
  if (cacheName === currentCache) throw new Error('This content generation is already installed.');
  const caches = storage(options);
  const staged = await caches.open(cacheName);
  const previous = await caches.open(currentCache);
  await staged.put(resolvePackUrl(base(options), 'index.json'), new Response(serialized));
  // A copy is only trusted after verify() checks its size and digest. No writes
  // touch the previous generation, even when source URLs are unchanged.
  for (const pack of index.packs) for (const file of pack.files) {
    options.signal?.throwIfAborted();
    const url = resolvePackUrl(base(options), file.path);
    if (await staged.match(url)) continue;
    const old = await previous.match(url);
    if (old) await staged.put(url, old);
  }
  const states = new Map<string, PackInstallState>();
  const installer = createInstaller({
    baseUrl: base(options), cacheName, cacheStorage: caches,
    fetchImpl: networkFetch(options), crypto: options.crypto,
    state: { get: async id => states.get(id), put: async state => { states.set(state.packId, state); }, all: async () => [...states.values()] },
    capabilities: { probe: async () => ({ hiragana: false, katakana: false, kanji: false, vocabulary: false, audio: false, strokeAnimation: false }) },
  });
  const pending = new Map(index.packs.map(pack => [pack.id, pack]));
  while (pending.size) {
    const ready = [...pending.values()].find(pack => pack.dependsOn.every(id => states.get(id)?.status === 'installed'));
    if (!ready) throw new Error('Content dependencies are missing or circular.');
    options.signal?.throwIfAborted();
    await installer.verify(ready.id);
    const installed = await installer.install(ready.id, onProgress, options.signal);
    if (installed.status !== 'installed') throw new Error(installed.failures[0]?.reason ?? 'Content update was interrupted.');
    const verified = await installer.verify(ready.id);
    if (verified.status !== 'installed') throw new Error('Staged content could not be verified.');
    pending.delete(ready.id);
  }
  return { cacheName, states: [...states.values()] };
}

/** Call only after user confirmation and while no practice session or other tab is active. */
export async function activateContentUpdate(prepared: PreparedContentUpdate, options: ContentUpdateOptions = {}): Promise<void> {
  options.signal?.throwIfAborted();
  if (!new RegExp(`^${generationPrefix}[a-f0-9]{64}$`).test(prepared.cacheName) ||
      !prepared.states.length || prepared.states.some(state => state.status !== 'installed')) {
    throw new Error('Only a complete verified content generation can be activated.');
  }
  await (await storage(options).open(CONTENT_CONTROL_CACHE)).put(pointer(options), new Response(JSON.stringify({ cacheName: prepared.cacheName })));
}
