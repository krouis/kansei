// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import type { PackIndex } from '@/domain';
import { CONTENT_CACHE } from '@/content/cacheNames';
import { sha256Hex } from '@/content/digest';
import { activateContentUpdate, checkContentUpdate, getActiveContentCacheName, prepareContentUpdate } from '@/content/updates';

function memoryCaches(): CacheStorage {
  const caches = new Map<string, Map<string, Response>>();
  return { open: async (name: string) => {
    if (!caches.has(name)) caches.set(name, new Map());
    const data = caches.get(name)!;
    return {
      match: async (url: string) => data.get(String(url))?.clone(),
      put: async (url: string, response: Response) => { data.set(String(url), response.clone()); },
      delete: async (url: string) => data.delete(String(url)),
    };
  } } as unknown as CacheStorage;
}
const crypto = webcrypto as unknown as Crypto;
const baseUrl = '/content/';
async function fixture() {
  const body = 'new recording';
  const index: PackIndex = { schemaVersion: 1, generatedAt: 'new', packs: [{
    id: 'audio', title: 'Audio', description: '', version: '2', required: true, dependsOn: [],
    totalBytes: body.length, files: [{ path: 'audio.ogg', bytes: body.length, sha256: await sha256Hex(new TextEncoder().encode(body), crypto), kind: 'audio' }],
    contents: { characters: 0, vocab: 0, audioClips: 1, strokeReferences: 0 },
    attributions: [{ asset: 'audio', source: 'test', url: '', license: 'CC0', licenseUrl: null, notes: null }],
  }] };
  const cacheStorage = memoryCaches();
  await (await cacheStorage.open(CONTENT_CACHE)).put(`${baseUrl}audio.ogg`, new Response('old recording'));
  const options = { cacheStorage, crypto, baseUrl };
  return { body, index, options };
}

describe('atomic content updates', () => {
  it('discovers upstream through an explicit network request without altering installed data', async () => {
    const { index, options } = await fixture();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(index))) as unknown as typeof fetch;
    expect(await checkContentUpdate({ ...index, generatedAt: 'old' }, { ...options, fetchImpl })).toEqual(index);
    expect(fetchImpl).toHaveBeenCalledWith('/content/index.json?kansei-update=1', expect.objectContaining({ cache: 'no-store' }));
    expect(await getActiveContentCacheName(options)).toBe(CONTENT_CACHE);
    expect(await checkContentUpdate(index, { ...options, fetchImpl })).toBeNull();
  });

  it('keeps old content intact after a bad checksum and can resume with correct bytes', async () => {
    const { index, body, options } = await fixture();
    const badFetch = vi.fn(async () => new Response('bad recording')) as unknown as typeof fetch;
    await expect(prepareContentUpdate(index, CONTENT_CACHE, () => {}, { ...options, fetchImpl: badFetch })).rejects.toThrow(/Checksum/);
    expect(await getActiveContentCacheName(options)).toBe(CONTENT_CACHE);
    const old = await options.cacheStorage.open(CONTENT_CACHE);
    expect(await (await old.match('/content/audio.ogg'))?.text()).toBe('old recording');

    const prepared = await prepareContentUpdate(index, CONTENT_CACHE, () => {}, {
      ...options, fetchImpl: vi.fn(async () => new Response(body)) as unknown as typeof fetch,
    });
    expect(await getActiveContentCacheName(options)).toBe(CONTENT_CACHE);
    expect(prepared.states[0]?.status).toBe('installed');
    await activateContentUpdate(prepared, options);
    expect(await getActiveContentCacheName(options)).toBe(prepared.cacheName);
    expect(await (await (await options.cacheStorage.open(prepared.cacheName)).match('/content/audio.ogg'))?.text()).toBe(body);
    expect(await (await old.match('/content/audio.ogg'))?.text()).toBe('old recording');
  });

  it('does not activate an interrupted download', async () => {
    const { index, options } = await fixture();
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => { controller.abort(); throw new DOMException('Interrupted', 'AbortError'); }) as unknown as typeof fetch;
    await expect(prepareContentUpdate(index, CONTENT_CACHE, () => {}, { ...options, fetchImpl, signal: controller.signal })).rejects.toThrow(/interrupted/i);
    expect(await getActiveContentCacheName(options)).toBe(CONTENT_CACHE);
    expect(await (await (await options.cacheStorage.open(CONTENT_CACHE)).match('/content/audio.ogg'))?.text()).toBe('old recording');
  });

  it('rejects incompatible indexes without publishing them', async () => {
    const { index, options } = await fixture();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ...index, schemaVersion: 999 }))) as unknown as typeof fetch;
    await expect(checkContentUpdate(index, { ...options, fetchImpl })).rejects.toThrow(/newer app/);
    expect(await getActiveContentCacheName(options)).toBe(CONTENT_CACHE);
  });
});
