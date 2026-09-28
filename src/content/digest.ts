/**
 * SHA-256 integrity checks for pack files.
 *
 * Digests are about detecting truncation and corruption — a half-written cache
 * entry, a proxy that mangled a response, a partially resumed download — not
 * about defending against an attacker who controls the origin. That is why a
 * plain string comparison is used rather than a constant-time one: there is no
 * secret here to leak through timing.
 */

/** Thrown when the platform has no usable WebCrypto digest. */
export class DigestUnavailableError extends Error {
  constructor() {
    super(
      'This browser does not expose crypto.subtle, so downloaded content cannot be ' +
        'verified. Kansei will not install content it cannot check.',
    );
    this.name = 'DigestUnavailableError';
  }
}

const HEX = '0123456789abcdef';

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // Manual hex rather than a template-literal padStart loop: this runs over
  // every installed file, and a preallocated character table measurably beats
  // repeated toString(16).padStart(2, '0') calls on large packs.
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i] as number;
    out += HEX[(b >> 4) & 0xf];
    out += HEX[b & 0xf];
  }
  return out;
}

function subtleOf(crypto: Crypto | undefined): SubtleCrypto {
  const subtle = crypto?.subtle;
  if (!subtle || typeof subtle.digest !== 'function') throw new DigestUnavailableError();
  return subtle;
}

/** Lowercase base16 SHA-256 of `bytes`. */
export async function sha256Hex(
  bytes: Uint8Array | ArrayBuffer,
  crypto: Crypto | undefined = globalThis.crypto,
): Promise<string> {
  const subtle = subtleOf(crypto);
  // Normalise to a standalone ArrayBuffer: a Uint8Array view over a larger
  // pooled buffer would otherwise hash the whole pool.
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const exact =
    view.byteOffset === 0 && view.byteLength === view.buffer.byteLength
      ? view.buffer
      : view.slice().buffer;
  return toHex(await subtle.digest('SHA-256', exact as ArrayBuffer));
}

/** True when `bytes` hashes to `expected`. Case- and whitespace-insensitive. */
export async function digestMatches(
  bytes: Uint8Array | ArrayBuffer,
  expected: string,
  crypto: Crypto | undefined = globalThis.crypto,
): Promise<{ ok: boolean; actual: string }> {
  const actual = await sha256Hex(bytes, crypto);
  return { ok: actual === expected.trim().toLowerCase(), actual };
}
