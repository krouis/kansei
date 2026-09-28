/**
 * Cache Storage names shared by the installer and the service worker.
 *
 * These live in their own module with no DOM or app imports because the service
 * worker bundle (src/sw.ts) imports them too, and pulling the installer into the
 * worker would drag the whole content layer in with it.
 *
 * The invariant these names protect: verified content and the app shell live in
 * DIFFERENT caches. A shell update replaces the shell cache and must never touch
 * the content cache, because re-downloading hundreds of megabytes of packs is
 * exactly the thing an offline-first app must not do to a learner on mobile data.
 */

/** Prefix for every cache this app owns. Anything else is left alone. */
export const CACHE_PREFIX = 'kansei-';

/**
 * Shell cache. The suffix is bumped only when the *caching strategy* changes;
 * per-deploy busting comes from the build revision appended at runtime in sw.ts,
 * not from editing this constant.
 */
export const SHELL_CACHE_PREFIX = `${CACHE_PREFIX}shell-`;

/**
 * Content pack cache. Only digest-verified bytes are ever written here — the
 * service worker reads from it but never populates it, so a cache hit is
 * always a hit on bytes that matched their SHA-256 at install time.
 */
export const CONTENT_CACHE = `${CACHE_PREFIX}content-v1`;

/**
 * Where partially-downloaded large files are parked between attempts.
 *
 * Kept out of CONTENT_CACHE deliberately: a consumer that finds a response in
 * the content cache is entitled to assume it is complete and verified, and a
 * half-downloaded body sitting under the real URL would silently break that.
 */
export const PARTIAL_CACHE = `${CACHE_PREFIX}content-partial-v1`;

/** Default URL prefix the content pack tree is served from. */
export const DEFAULT_CONTENT_BASE_URL = '/content/';

/** Caches that a shell activation is allowed to delete. */
export function isDisposableCacheName(name: string, keepShellCache: string): boolean {
  if (!name.startsWith(CACHE_PREFIX)) return false; // not ours
  if (name === keepShellCache) return false;
  if (name === CONTENT_CACHE || name === PARTIAL_CACHE) return false; // never on a shell update
  return true;
}
