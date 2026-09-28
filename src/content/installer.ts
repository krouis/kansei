import type { OfflineReadiness, PackFile, PackId, PackIndex, PackInstallState, PackManifest } from '@/domain';
import type { PackStateStore } from '@/persistence/ports';
import type { InstallProgress, Installer } from './ports';
import { CONTENT_CACHE, DEFAULT_CONTENT_BASE_URL, PARTIAL_CACHE, SHELL_CACHE_PREFIX } from './cacheNames';
import { digestMatches } from './digest';
import { resolvePackUrl } from './packSource';
import type { ContentIssue } from './validate';
import { describe, parsePackIndex } from './validate';

/**
 * The pack installer.
 *
 * Contract, in the order it matters:
 *
 *  1. NOTHING UNVERIFIED IS EVER CACHED. Bytes are downloaded to memory, hashed
 *     with SHA-256, compared to the manifest, and only then written to the
 *     content cache. Everything downstream — the library, the service worker,
 *     `hasAudio`, "Ready offline" — treats a hit in that cache as proof the file
 *     is intact, and that guarantee is made here or nowhere.
 *
 *  2. INSTALLS RESUME. Per-file completion is persisted after every file, so a
 *     closed tab costs at most the file in flight. For files above
 *     `partialResumeMinBytes` the partly-received body is parked in a separate
 *     cache and an HTTP Range request continues it — but only when the server
 *     answers with a 206 whose Content-Range starts exactly where we stopped.
 *     Anything else and the file restarts from zero. See docs/OFFLINE.md.
 *
 *  3. FAILURES ARE PER FILE AND NAMED. One bad digest fails that file, not the
 *     pack, and lands in `PackInstallState.failures` with a reason a human can
 *     act on.
 */

/** Content-derived capability flags. See `CapabilityProbe`. */
export interface ContentCapabilities {
  hiragana: boolean;
  katakana: boolean;
  kanji: boolean;
  vocabulary: boolean;
  audio: boolean;
  strokeAnimation: boolean;
}

/**
 * How readiness learns what is actually usable.
 *
 * The installer knows which FILES verified; it deliberately does not know what
 * is inside them. Asking the library instead of pattern-matching pack ids is the
 * difference between "a pack called kanji is installed" and "there are kanji
 * characters we can actually render", and only the second is honest.
 */
export interface CapabilityProbe {
  probe(verifiedPaths: ReadonlySet<string>): Promise<ContentCapabilities>;
}

export interface InstallerOptions {
  /** Root-relative prefix the pack tree is served from. */
  baseUrl?: string;
  cacheName?: string;
  partialCacheName?: string;
  cacheStorage?: CacheStorage | undefined;
  fetchImpl?: typeof fetch | undefined;
  crypto?: Crypto | undefined;
  /** Where per-pack install state is persisted, so installs survive a reload. */
  state: PackStateStore;
  capabilities: CapabilityProbe;
  /**
   * Whether the app shell itself is cached. Injected because only the service
   * worker layer knows its shell cache; the default probes the shell caches.
   */
  navigationReady?: () => Promise<boolean>;
  /**
   * Files at or above this size get byte-level Range resume. Below it, resume is
   * per file: re-downloading 40 KB is cheaper than the bookkeeping.
   */
  partialResumeMinBytes?: number;
  now?: () => Date;
}

/** Thrown only when the index is reachable neither from cache nor network. */
export class ContentIndexUnavailableError extends Error {
  constructor(readonly issues: ContentIssue[], cause?: unknown) {
    super('The content index could not be loaded from storage or the network.');
    this.name = 'ContentIndexUnavailableError';
    this.cause = cause;
  }
}

/** The concrete installer: the port plus the extras the app wiring needs. */
export interface PackInstaller extends Installer {
  /** Pack-relative paths that verified, for building the content library. */
  verifiedPaths(): Promise<Set<string>>;
  /** Problems found while reading the index. */
  issues(): ContentIssue[];
}

const INDEX_PATH = 'index.json';

const CONTENT_TYPES: Record<string, string> = {
  json: 'application/json',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  woff2: 'font/woff2',
  svg: 'image/svg+xml',
  png: 'image/png',
};

function contentTypeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

const isAbortError = (err: unknown): boolean =>
  err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');

function emptyState(packId: PackId, now: string): PackInstallState {
  return {
    packId, status: 'not-installed', filesVerified: 0, filesTotal: 0, bytesDownloaded: 0,
    bytesTotal: 0, pending: [], failures: [], installedVersion: null, lastAttemptAt: now,
  };
}

/**
 * Parse a `Content-Range` response header and return the first byte offset.
 *
 * A 206 whose range does not start where we asked means the server is answering
 * a different question; we treat that as "no resume" rather than splicing bytes
 * at the wrong offset and failing the digest much later with a confusing error.
 */
export function contentRangeStart(header: string | null): number | null {
  if (!header) return null;
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(header.trim());
  if (!match) return null;
  return Number(match[1]);
}

export function createInstaller(options: InstallerOptions): PackInstaller {
  const baseUrl = options.baseUrl ?? DEFAULT_CONTENT_BASE_URL;
  const cacheName = options.cacheName ?? CONTENT_CACHE;
  const partialCacheName = options.partialCacheName ?? PARTIAL_CACHE;
  const cacheStorage = options.cacheStorage ?? globalThis.caches;
  const fetchImpl = options.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
  const cryptoImpl = options.crypto ?? globalThis.crypto;
  const store = options.state;
  const probe = options.capabilities;
  const minResume = options.partialResumeMinBytes ?? 512 * 1024;
  const now = options.now ?? (() => new Date());
  const issues: ContentIssue[] = [];

  const urlFor = (path: string): string => resolvePackUrl(baseUrl, path);
  /** Partial keys are namespaced by digest so a pack update orphans them. */
  const partialKeyFor = (file: PackFile): string => `${urlFor(file.path)}?kansei-partial=${file.sha256}`;

  const openCache = async (name: string): Promise<Cache | undefined> => {
    if (!cacheStorage) return undefined;
    try {
      return await cacheStorage.open(name);
    } catch {
      return undefined;
    }
  };

  /* ---------------------------------------------------------------------- */
  /* Index                                                                  */
  /* ---------------------------------------------------------------------- */

  let indexCache: PackIndex | null = null;

  const index = async (): Promise<PackIndex> => {
    if (indexCache) return indexCache;
    const cache = await openCache(cacheName);
    const url = urlFor(INDEX_PATH);

    const cached = await cache?.match(url);
    if (cached) {
      const parsed = parsePackIndex(await cached.text());
      if (parsed.index) {
        issues.push(...parsed.issues);
        indexCache = parsed.index;
        return parsed.index;
      }
      // A corrupt cached index is reported and then bypassed: falling back to
      // the network is the only way out, and pretending there is no content at
      // all would be worse than trying again.
      issues.push(...parsed.issues);
    }

    if (!fetchImpl) throw new ContentIndexUnavailableError(issues.slice());
    let text: string;
    try {
      const response = await fetchImpl(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      text = await response.text();
    } catch (err) {
      throw new ContentIndexUnavailableError(issues.slice(), err);
    }
    const parsed = parsePackIndex(text);
    issues.push(...parsed.issues);
    if (!parsed.index) throw new ContentIndexUnavailableError(issues.slice());
    // The index is the one file with no digest to check it against — there is
    // nothing outside it that describes it. Its shape is validated instead, and
    // that limitation is stated in docs/OFFLINE.md.
    await cache?.put(url, new Response(text, { headers: { 'content-type': 'application/json' } }));
    indexCache = parsed.index;
    return parsed.index;
  };

  const manifestFor = async (packId: PackId): Promise<PackManifest | undefined> =>
    (await index()).packs.find((p) => p.id === packId);

  /* ---------------------------------------------------------------------- */
  /* Presence and verification                                              */
  /* ---------------------------------------------------------------------- */

  /** Cheap check: is the file in the content cache at all? */
  const isPresent = async (cache: Cache | undefined, file: PackFile): Promise<boolean> => {
    if (!cache) return false;
    return (await cache.match(urlFor(file.path))) !== undefined;
  };

  /** Full check: is it in the cache AND does it still hash correctly? */
  const isIntact = async (
    cache: Cache | undefined,
    file: PackFile,
  ): Promise<{ ok: true } | { ok: false; reason: string }> => {
    if (!cache) return { ok: false, reason: 'Storage is unavailable in this browser.' };
    const response = await cache.match(urlFor(file.path));
    if (!response) return { ok: false, reason: 'Not downloaded.' };
    let bytes: ArrayBuffer;
    try {
      bytes = await response.arrayBuffer();
    } catch (err) {
      return { ok: false, reason: `Could not be read back: ${describe(err)}` };
    }
    if (bytes.byteLength !== file.bytes) {
      return { ok: false, reason: `Wrong size: expected ${file.bytes} bytes, found ${bytes.byteLength}.` };
    }
    const { ok, actual } = await digestMatches(bytes, file.sha256, cryptoImpl);
    return ok ? { ok: true } : { ok: false, reason: `Checksum mismatch (found ${actual.slice(0, 12)}…).` };
  };

  const stateFrom = (
    manifest: PackManifest,
    verifiedPathSet: Set<string>,
    failures: Array<{ path: string; reason: string }>,
    status: PackInstallState['status'] | null,
  ): PackInstallState => {
    const pending = manifest.files
      .map((f) => f.path)
      .filter((p) => !verifiedPathSet.has(p) && !failures.some((f) => f.path === p));
    const bytesDownloaded = manifest.files
      .filter((f) => verifiedPathSet.has(f.path))
      .reduce((n, f) => n + f.bytes, 0);
    const resolved: PackInstallState['status'] =
      status ??
      (failures.length > 0
        ? 'failed'
        : pending.length === 0
          ? 'installed'
          : verifiedPathSet.size === 0
            ? 'not-installed'
            : 'partial');
    return {
      packId: manifest.id,
      status: resolved,
      filesVerified: verifiedPathSet.size,
      filesTotal: manifest.files.length,
      bytesDownloaded,
      bytesTotal: manifest.totalBytes,
      pending,
      failures,
      // A version is only claimed when every file is present: a half-installed
      // pack must never look like a complete one of that version.
      installedVersion: resolved === 'installed' ? manifest.version : null,
      lastAttemptAt: now().toISOString(),
    };
  };

  const verify = async (packId: PackId): Promise<PackInstallState> => {
    const manifest = await manifestFor(packId);
    if (!manifest) {
      const state = emptyState(packId, now().toISOString());
      state.failures = [{ path: '(pack)', reason: 'This pack is not in the content index.' }];
      state.status = 'failed';
      await store.put(state);
      return state;
    }
    const cache = await openCache(cacheName);
    const verified = new Set<string>();
    const failures: Array<{ path: string; reason: string }> = [];
    for (const file of manifest.files) {
      const result = await isIntact(cache, file);
      if (result.ok) verified.add(file.path);
      else if (result.reason !== 'Not downloaded.') failures.push({ path: file.path, reason: result.reason });
    }
    const state = stateFrom(manifest, verified, failures, null);
    await store.put(state);
    return state;
  };

  /* ---------------------------------------------------------------------- */
  /* Download                                                               */
  /* ---------------------------------------------------------------------- */

  interface DownloadContext {
    partialCache: Cache | undefined;
    signal: AbortSignal | undefined;
    /** Bytes received so far for this file, reported live. */
    onBytes: (receivedForThisFile: number) => void;
  }

  type DownloadResult = { ok: true; bytes: Uint8Array } | { ok: false; reason: string };

  const readPartial = async (
    ctx: DownloadContext,
    file: PackFile,
  ): Promise<Uint8Array | null> => {
    if (file.bytes < minResume || !ctx.partialCache) return null;
    const stored = await ctx.partialCache.match(partialKeyFor(file));
    if (!stored) return null;
    try {
      const buffer = new Uint8Array(await stored.arrayBuffer());
      // A partial claiming to be complete (or longer) is nonsense; discard it
      // rather than trusting a byte count we cannot explain.
      return buffer.length > 0 && buffer.length < file.bytes ? buffer : null;
    } catch {
      return null;
    }
  };

  const savePartial = async (ctx: DownloadContext, file: PackFile, bytes: Uint8Array): Promise<void> => {
    if (file.bytes < minResume || !ctx.partialCache || bytes.length === 0) return;
    try {
      await ctx.partialCache.put(
        partialKeyFor(file),
        // Wrapped in a Blob rather than passed as a raw Uint8Array: TypeScript's
        // DOM lib types BodyInit's BufferSource branch (and BlobPart) against a
        // plain ArrayBuffer, which a generic Uint8Array<ArrayBufferLike> (TS
        // 5.7+) no longer structurally satisfies since ArrayBufferLike also
        // admits SharedArrayBuffer. The cast is safe: these bytes always come
        // from fetch() or crypto.subtle, never from a SharedArrayBuffer view.
        new Response(new Blob([bytes as BlobPart]), { headers: { 'content-type': 'application/octet-stream' } }),
      );
    } catch {
      // Losing a partial costs a re-download, never correctness. Never let it
      // fail the install.
    }
  };

  const dropPartial = async (ctx: DownloadContext, file: PackFile): Promise<void> => {
    try {
      await ctx.partialCache?.delete(partialKeyFor(file));
    } catch {
      /* see savePartial */
    }
  };

  const download = async (file: PackFile, ctx: DownloadContext): Promise<DownloadResult> => {
    if (!fetchImpl) return { ok: false, reason: 'This browser cannot download content (no fetch).' };
    const url = urlFor(file.path);
    const resumeFrom = await readPartial(ctx, file);
    const chunks: Uint8Array[] = [];
    let received = 0;

    const init: RequestInit = {};
    if (ctx.signal) init.signal = ctx.signal;
    if (resumeFrom) init.headers = { Range: `bytes=${resumeFrom.length}-` };

    let response: Response;
    try {
      response = await fetchImpl(url, init);
    } catch (err) {
      if (isAbortError(err)) throw err;
      return { ok: false, reason: `Download failed: ${describe(err)}` };
    }

    if (resumeFrom) {
      const start = contentRangeStart(response.headers.get('content-range'));
      if (response.status === 206 && start === resumeFrom.length) {
        chunks.push(resumeFrom);
        received = resumeFrom.length;
      } else if (response.status === 200) {
        // The server ignored Range (or a proxy stripped it). Restart cleanly —
        // this is exactly the "per-file granularity" fallback documented in
        // docs/OFFLINE.md, not a silent byte-level resume we cannot honour.
        await dropPartial(ctx, file);
      } else if (response.status === 416) {
        await dropPartial(ctx, file);
        return { ok: false, reason: 'The server rejected the resume request; the download will restart.' };
      } else {
        await dropPartial(ctx, file);
        return { ok: false, reason: `Unexpected response while resuming: HTTP ${response.status}.` };
      }
    } else if (!response.ok) {
      return { ok: false, reason: `Download failed: HTTP ${response.status}.` };
    }

    ctx.onBytes(received);

    const body = response.body;
    if (body && typeof body.getReader === 'function') {
      const reader = body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            received += value.length;
            ctx.onBytes(received);
          }
        }
      } catch (err) {
        // Save what we have before propagating: this is what makes a cancelled
        // or dropped download resumable at all.
        await savePartial(ctx, file, concat(chunks, received));
        if (isAbortError(err)) throw err;
        return { ok: false, reason: `Download interrupted: ${describe(err)}` };
      }
    } else {
      // Streaming is unavailable (older browsers, and most fetch test doubles).
      // Byte-level progress is simply not observable here, so the file reports
      // 0 then complete rather than faking intermediate numbers.
      try {
        const buffer = new Uint8Array(await response.arrayBuffer());
        chunks.push(buffer);
        received += buffer.length;
        ctx.onBytes(received);
      } catch (err) {
        if (isAbortError(err)) throw err;
        return { ok: false, reason: `Download failed while reading the body: ${describe(err)}` };
      }
    }

    const bytes = concat(chunks, received);
    if (bytes.length !== file.bytes) {
      // Keep the partial: a short read is the case resume exists for.
      if (bytes.length < file.bytes) await savePartial(ctx, file, bytes);
      return { ok: false, reason: `Incomplete download: expected ${file.bytes} bytes, got ${bytes.length}.` };
    }
    return { ok: true, bytes };
  };

  /* ---------------------------------------------------------------------- */
  /* Install                                                                */
  /* ---------------------------------------------------------------------- */

  const install = async (
    packId: PackId,
    onProgress: (p: InstallProgress) => void,
    signal?: AbortSignal,
  ): Promise<PackInstallState> => {
    const manifest = await manifestFor(packId);
    if (!manifest) {
      const state = emptyState(packId, now().toISOString());
      state.status = 'failed';
      state.failures = [{ path: '(pack)', reason: 'This pack is not in the content index.' }];
      await store.put(state);
      onProgress({
        packId, phase: 'failed', filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0,
        currentPath: null, error: 'This pack is not in the content index.',
      });
      return state;
    }

    // Dependencies are not installed implicitly: a caller that wants two packs
    // should say so, and a silent extra download on a metered connection is a
    // hostile surprise.
    for (const dep of manifest.dependsOn) {
      const depState = await store.get(dep);
      if (depState?.status !== 'installed') {
        const state = stateFrom(manifest, new Set(), [
          { path: '(dependency)', reason: `Requires the “${dep}” pack, which is not installed yet.` },
        ], 'failed');
        await store.put(state);
        onProgress({
          packId, phase: 'failed', filesDone: 0, filesTotal: manifest.files.length, bytesDone: 0,
          bytesTotal: manifest.totalBytes, currentPath: null,
          error: `Requires the “${dep}” pack, which is not installed yet.`,
        });
        return state;
      }
    }

    const cache = await openCache(cacheName);
    const partialCache = await openCache(partialCacheName);
    const prior = await store.get(packId);

    /* Resume set. A recorded verification is trusted, but presence in the cache
     * is re-checked: the browser can evict a cache entry at any time, and
     * trusting the record alone would leave a hole the library finds later. The
     * digest itself is NOT recomputed here — that is verify()'s job, and doing it
     * on every resume would re-read the whole pack from disk. */
    const verified = new Set<string>();
    const priorPending = new Set(prior?.pending ?? []);
    const priorFailed = new Set(prior?.failures.map((f) => f.path) ?? []);
    const versionMatches = prior?.installedVersion === null || prior?.installedVersion === manifest.version;
    /* Only a recorded attempt makes a cached file trustworthy. A file sitting in
     * the cache with no matching state record was never digest-checked by this
     * installer, so it is re-downloaded rather than counted as verified. */
    const resumable =
      prior !== undefined && versionMatches && (prior.filesVerified > 0 || prior.pending.length > 0);
    if (resumable) {
      for (const file of manifest.files) {
        if (priorPending.has(file.path) || priorFailed.has(file.path)) continue;
        if (await isPresent(cache, file)) verified.add(file.path);
      }
    }
    if (prior !== undefined && !versionMatches) {
      issues.push({
        where: manifest.id,
        message: `A new version of ${manifest.title} (${manifest.version}) replaces the installed one.`,
        severity: 'warning',
      });
    }

    const verifiedBytes = (): number =>
      manifest.files.filter((f) => verified.has(f.path)).reduce((n, f) => n + f.bytes, 0);

    const failures: Array<{ path: string; reason: string }> = [];
    let currentPath: string | null = null;
    let currentBytes = 0;

    const report = (phase: InstallProgress['phase'], error: string | null = null): void => {
      onProgress({
        packId,
        phase,
        filesDone: verified.size,
        filesTotal: manifest.files.length,
        bytesDone: verifiedBytes() + currentBytes,
        bytesTotal: manifest.totalBytes,
        currentPath,
        error,
      });
    };

    const persist = async (status: PackInstallState['status'] | null): Promise<PackInstallState> => {
      const state = stateFrom(manifest, verified, failures, status);
      await store.put(state);
      return state;
    };

    report(verified.size === manifest.files.length ? 'verifying' : 'downloading');

    const ctx: DownloadContext = {
      partialCache,
      signal,
      onBytes: (n) => {
        currentBytes = n;
        report('downloading');
      },
    };

    for (const file of manifest.files) {
      if (verified.has(file.path)) continue;
      if (signal?.aborted) {
        const state = await persist('partial');
        currentPath = null;
        currentBytes = 0;
        report('paused');
        return state;
      }
      currentPath = file.path;
      currentBytes = 0;
      report('downloading');

      let result: DownloadResult;
      try {
        result = await download(file, ctx);
      } catch (err) {
        if (isAbortError(err)) {
          // Progress so far is already persisted per completed file; record the
          // pack as partial so the next install() call resumes.
          currentPath = null;
          currentBytes = 0;
          const state = await persist('partial');
          report('paused');
          return state;
        }
        result = { ok: false, reason: describe(err) };
      }

      if (!result.ok) {
        failures.push({ path: file.path, reason: result.reason });
        currentBytes = 0;
        await persist(null);
        report('downloading', result.reason);
        continue;
      }

      currentPath = file.path;
      report('verifying');
      const { ok, actual } = await digestMatches(result.bytes, file.sha256, cryptoImpl);
      if (!ok) {
        // Hard failure for this file. The bytes are discarded, never cached:
        // a wrong file in the content cache would be indistinguishable from a
        // right one to everything downstream.
        await dropPartial(ctx, file);
        failures.push({
          path: file.path,
          reason: `Checksum mismatch: expected ${file.sha256.slice(0, 12)}…, got ${actual.slice(0, 12)}….`,
        });
        currentBytes = 0;
        await persist(null);
        report('downloading', 'A downloaded file did not match its checksum and was discarded.');
        continue;
      }

      if (!cache) {
        failures.push({ path: file.path, reason: 'Storage is unavailable, so content cannot be saved.' });
        await persist('failed');
        report('failed', 'Storage is unavailable, so content cannot be saved.');
        return stateFrom(manifest, verified, failures, 'failed');
      }

      try {
        await cache.put(
          urlFor(file.path),
          // See the Blob note above: avoids a generic-Uint8Array/BlobPart clash.
          new Response(new Blob([result.bytes as BlobPart]), {
            headers: {
              'content-type': contentTypeFor(file.path),
              'content-length': String(result.bytes.length),
            },
          }),
        );
      } catch (err) {
        // Quota is the common case here, and it must be said plainly.
        const reason = `Could not be saved to storage: ${describe(err)}`;
        failures.push({ path: file.path, reason });
        await persist('failed');
        report('failed', reason);
        return stateFrom(manifest, verified, failures, 'failed');
      }

      await dropPartial(ctx, file);
      verified.add(file.path);
      currentBytes = 0;
      // Persisted per file: this line is what makes an interrupted install cost
      // one file instead of the whole pack.
      await persist(null);
      report('downloading');
    }

    currentPath = null;
    currentBytes = 0;
    const state = await persist(null);
    report(state.status === 'installed' ? 'done' : 'failed', failures[0]?.reason ?? null);
    return state;
  };

  /* ---------------------------------------------------------------------- */
  /* Status, removal, readiness                                             */
  /* ---------------------------------------------------------------------- */

  const status = async (): Promise<PackInstallState[]> => {
    const stored = await store.all();
    let packs: PackManifest[] = [];
    try {
      packs = (await index()).packs;
    } catch {
      // Offline with no cached index: the stored states are all we can honestly
      // report, and they are reported as-is.
      return stored;
    }
    const byId = new Map(stored.map((s) => [s.packId, s]));
    return packs.map((manifest) => {
      const existing = byId.get(manifest.id);
      if (!existing) return { ...emptyState(manifest.id, now().toISOString()), filesTotal: manifest.files.length, bytesTotal: manifest.totalBytes, pending: manifest.files.map((f) => f.path) };
      return { ...existing, filesTotal: manifest.files.length, bytesTotal: manifest.totalBytes };
    });
  };

  const remove = async (packId: PackId): Promise<void> => {
    const manifest = await manifestFor(packId);
    const cache = await openCache(cacheName);
    const partialCache = await openCache(partialCacheName);
    if (manifest && cache) {
      for (const file of manifest.files) {
        await cache.delete(urlFor(file.path));
        await partialCache?.delete(partialKeyFor(file));
      }
    }
    await store.put(emptyState(packId, now().toISOString()));
  };

  const verifiedPaths = async (): Promise<Set<string>> => {
    const out = new Set<string>();
    for (const state of await store.all()) {
      if (state.status !== 'installed' && state.status !== 'partial') continue;
      const manifest = await manifestFor(state.packId).catch(() => undefined);
      if (!manifest) continue;
      const failed = new Set(state.failures.map((f) => f.path));
      const pending = new Set(state.pending);
      for (const file of manifest.files) {
        if (!pending.has(file.path) && !failed.has(file.path)) out.add(file.path);
      }
    }
    return out;
  };

  const installedBytes = async (): Promise<number> => {
    let total = 0;
    for (const state of await store.all()) {
      const manifest = await manifestFor(state.packId).catch(() => undefined);
      if (!manifest) continue;
      const pending = new Set(state.pending);
      const failed = new Set(state.failures.map((f) => f.path));
      for (const file of manifest.files) {
        if (!pending.has(file.path) && !failed.has(file.path)) total += file.bytes;
      }
    }
    return total;
  };

  /** Default shell probe: is anything in a Kansei shell cache able to answer a navigation? */
  const defaultNavigationReady = async (): Promise<boolean> => {
    if (!cacheStorage) return false;
    try {
      const names = await cacheStorage.keys();
      for (const name of names) {
        if (!name.startsWith(SHELL_CACHE_PREFIX)) continue;
        const cache = await cacheStorage.open(name);
        for (const candidate of ['/index.html', '/', 'index.html']) {
          if (await cache.match(candidate)) return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  };
  const navigationReady = options.navigationReady ?? defaultNavigationReady;

  const readiness = async (): Promise<OfflineReadiness> => {
    const navigation = await navigationReady();
    const missing: string[] = [];
    const add = (text: string): void => {
      if (!missing.includes(text)) missing.push(text);
    };
    if (!navigation) add('The app itself is not stored for offline use yet — open Kansei once while online.');

    let packs: PackManifest[];
    try {
      packs = (await index()).packs;
    } catch {
      add('The list of available content has not been downloaded yet.');
      return {
        ready: false,
        capabilities: {
          navigation,
          hiragana: false, katakana: false, kanji: false, vocabulary: false,
          audio: false, strokeAnimation: false, handwritingAssessment: false,
          aboutAndScience: navigation,
        },
        missing,
      };
    }

    const cache = await openCache(cacheName);
    const stored = new Map((await store.all()).map((s) => [s.packId, s]));
    const verified = new Set<string>();
    let requiredOk = true;

    for (const manifest of packs) {
      const state = stored.get(manifest.id);
      const complete =
        state !== undefined &&
        state.status === 'installed' &&
        state.installedVersion === manifest.version &&
        state.pending.length === 0 &&
        state.failures.length === 0;

      // Presence is re-checked against storage because eviction happens without
      // telling us. Digests are not recomputed here — readiness runs at every
      // app start, and re-hashing the whole library would cost seconds. verify()
      // is the full check, and docs/OFFLINE.md says exactly this.
      let present = complete;
      if (complete) {
        for (const file of manifest.files) {
          if (!(await isPresent(cache, file))) {
            present = false;
            break;
          }
        }
      }

      if (present) {
        for (const file of manifest.files) verified.add(file.path);
      } else if (manifest.required) {
        requiredOk = false;
        add(
          state === undefined || state.status === 'not-installed'
            ? `${manifest.title} is not installed.`
            : `${manifest.title} is only partly installed.`,
        );
      }
    }

    const content = await probe.probe(verified);
    const capabilities = {
      navigation,
      hiragana: content.hiragana,
      katakana: content.katakana,
      kanji: content.kanji,
      vocabulary: content.vocabulary,
      audio: content.audio,
      strokeAnimation: content.strokeAnimation,
      // Assessment needs stroke references; the assessor itself ships in the
      // shell, so those two are the whole dependency.
      handwritingAssessment: content.strokeAnimation && navigation,
      // Static explanatory text lives in the app bundle, not in a pack.
      aboutAndScience: navigation,
    };

    if (!capabilities.hiragana) add('Hiragana characters.');
    if (!capabilities.katakana) add('Katakana characters.');
    if (!capabilities.kanji) add('Kanji characters.');
    if (!capabilities.vocabulary) add('Vocabulary words.');
    if (!capabilities.audio) add('Audio recordings — listening practice is unavailable.');
    if (!capabilities.strokeAnimation) add('Stroke-order data — animation, tracing and handwriting feedback are unavailable.');

    return { ready: navigation && requiredOk && missing.length === 0, capabilities, missing };
  };

  return {
    index,
    status,
    install,
    verify,
    remove,
    readiness,
    installedBytes,
    verifiedPaths,
    issues: () => issues.slice(),
  };
}
