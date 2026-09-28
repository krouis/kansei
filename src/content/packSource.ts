import { CONTENT_CACHE, DEFAULT_CONTENT_BASE_URL } from './cacheNames';

/**
 * Reading pack files back out of storage.
 *
 * The library and the installer both need "give me the bytes of pack file X",
 * and both must prefer the verified copy in Cache Storage over the network. This
 * module is the single place that knows how a pack-relative path becomes a URL
 * and a cache key, so the service worker, the installer and the library cannot
 * drift apart on it.
 */

export interface PackFileSource {
  /** The URL (and cache key) a pack-relative path maps to. */
  url(path: string): string;
  /**
   * Cache-first read. Resolves `undefined` when the file is not in the cache and
   * either the network is not allowed or the network does not have it.
   *
   * A network response is deliberately NOT written into the content cache here:
   * the content cache is a promise that everything inside it matched its digest,
   * and only the installer is allowed to make that promise.
   */
  read(path: string): Promise<Response | undefined>;
  /** Cache-only read, used when we must not silently reach the network. */
  readCached(path: string): Promise<Response | undefined>;
}

export interface PackFileSourceOptions {
  /** Root-relative prefix the pack tree is served from. Must end with '/'. */
  baseUrl?: string;
  cacheName?: string;
  cacheStorage?: CacheStorage | undefined;
  fetchImpl?: typeof fetch | undefined;
  /**
   * Whether a cache miss may fall through to the network. False in the offline
   * paths that must report a missing file rather than appear to work.
   */
  allowNetwork?: boolean;
}

/** Join a base prefix and a pack-relative path without producing '//' or '..'. */
export function resolvePackUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  let rel = path.trim();
  while (rel.startsWith('./')) rel = rel.slice(2);
  while (rel.startsWith('/')) rel = rel.slice(1);
  return base + rel;
}

/**
 * Reject paths that could escape the pack root.
 *
 * Pack manifests are content we downloaded, so a manifest with '../../' in a
 * path must not be able to make us write to an unrelated cache key.
 */
export function isSafePackPath(path: string): boolean {
  if (path.length === 0 || path.length > 512) return false;
  if (path.startsWith('/') || path.includes('\\')) return false;
  if (path.includes('//') || path.includes('?') || path.includes('#')) return false;
  return !path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..');
}

export function createPackFileSource(options: PackFileSourceOptions = {}): PackFileSource {
  const baseUrl = options.baseUrl ?? DEFAULT_CONTENT_BASE_URL;
  const cacheName = options.cacheName ?? CONTENT_CACHE;
  const cacheStorage = options.cacheStorage ?? globalThis.caches;
  const fetchImpl = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
  const allowNetwork = options.allowNetwork ?? true;

  const url = (path: string): string => resolvePackUrl(baseUrl, path);

  const readCached = async (path: string): Promise<Response | undefined> => {
    if (!cacheStorage) return undefined;
    try {
      const cache = await cacheStorage.open(cacheName);
      return (await cache.match(url(path))) ?? undefined;
    } catch {
      // A browser with Cache Storage disabled (private mode in some builds) is a
      // legitimate state: report "not available" rather than crashing the app.
      return undefined;
    }
  };

  const read = async (path: string): Promise<Response | undefined> => {
    const cached = await readCached(path);
    if (cached) return cached;
    if (!allowNetwork || !fetchImpl) return undefined;
    try {
      const response = await fetchImpl(url(path));
      return response.ok ? response : undefined;
    } catch {
      return undefined;
    }
  };

  return { url, read, readCached };
}
