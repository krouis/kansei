import type { AudioRef } from '@/domain';
import { resolvePackUrl } from '@/content/packSource';
const audioUrl = (ref: AudioRef) => resolvePackUrl('/content/', ref.path);
import type { AudioPlayer } from './ports';

/**
 * The audio player.
 *
 * Plays only real, bundled recordings. There is no speech-synthesis fallback
 * anywhere in this file: `play()` on a clip that fails to decode or fetch
 * rejects with a clear error rather than substituting anything, because a
 * synthesised voice standing in for a missing recording would be exactly the
 * kind of silent, undisclosed downgrade the product must never do.
 *
 * Web Audio (`AudioContext` + decoded `AudioBuffer`s) is used when available,
 * because it gives instant, gapless playback for a decoded clip and lets
 * replays never re-fetch. `HTMLAudioElement` is the fallback for the rare
 * environment without `AudioContext` (or where it is blocked entirely).
 */

const DECODE_CACHE_LIMIT = 64;

type Listener = (event: { type: 'play' | 'ended' | 'error'; ref: AudioRef | null }) => void;

export function createAudioPlayer(fetchImpl: typeof fetch = fetch): AudioPlayer {
  let ctx: AudioContext | null = null;
  let currentSource: AudioBufferSourceNode | null = null;
  let currentElement: HTMLAudioElement | null = null;
  let playing = false;
  let unlocked = false;
  const listeners = new Set<Listener>();
  // LRU-ish: insertion order is eviction order, which is close enough for a
  // cache whose purpose is "don't re-decode the last N clips played".
  const decoded = new Map<string, AudioBuffer>();

  const emit: Listener = (event) => {
    for (const l of listeners) l(event);
  };

  function getContext(): AudioContext | null {
    if (ctx) return ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    return ctx;
  }

  async function fetchBytes(ref: AudioRef): Promise<ArrayBuffer> {
    const res = await fetchImpl(audioUrl(ref));
    if (!res.ok) throw new Error(`Could not load audio for ${ref.path}: HTTP ${String(res.status)}.`);
    return res.arrayBuffer();
  }

  async function decode(ref: AudioRef): Promise<AudioBuffer> {
    const cached = decoded.get(ref.path);
    if (cached) return cached;
    const audioCtx = getContext();
    if (!audioCtx) throw new Error('Web Audio is not available in this environment.');
    const bytes = await fetchBytes(ref);
    const buffer = await audioCtx.decodeAudioData(bytes);
    if (decoded.size >= DECODE_CACHE_LIMIT) {
      const oldest = decoded.keys().next().value;
      if (oldest !== undefined) decoded.delete(oldest);
    }
    decoded.set(ref.path, buffer);
    return buffer;
  }

  function stopWebAudio(): void {
    if (currentSource) {
      try {
        currentSource.onended = null;
        currentSource.stop();
      } catch {
        // Already stopped or never started; not an error worth surfacing.
      }
      currentSource = null;
    }
  }

  function stopElement(): void {
    if (currentElement) {
      currentElement.onended = null;
      currentElement.onerror = null;
      currentElement.pause();
      currentElement = null;
    }
  }

  return {
    async preload(ref: AudioRef): Promise<void> {
      if (getContext()) {
        await decode(ref);
      }
      // With the HTMLAudioElement fallback there is nothing meaningful to
      // preload beyond what the browser's own network cache already does.
    },

    async play(ref: AudioRef): Promise<void> {
      this.stop();
      const audioCtx = getContext();

      if (audioCtx) {
        try {
          const buffer = await decode(ref);
          if (audioCtx.state === 'suspended') {
            await audioCtx.resume().catch(() => undefined);
          }
          unlocked = audioCtx.state === 'running';
          const source = audioCtx.createBufferSource();
          source.buffer = buffer;
          source.connect(audioCtx.destination);
          currentSource = source;
          playing = true;
          emit({ type: 'play', ref });
          await new Promise<void>((resolve, reject) => {
            source.onended = () => {
              playing = false;
              currentSource = null;
              emit({ type: 'ended', ref });
              resolve();
            };
            try {
              source.start(0);
            } catch (cause) {
              playing = false;
              currentSource = null;
              reject(cause instanceof Error ? cause : new Error(String(cause)));
            }
          });
          return;
        } catch (cause) {
          playing = false;
          emit({ type: 'error', ref });
          throw cause instanceof Error ? cause : new Error(String(cause));
        }
      }

      // Fallback: a plain <audio> element.
      await new Promise<void>((resolve, reject) => {
        const el = new Audio(audioUrl(ref));
        currentElement = el;
        el.onended = () => {
          playing = false;
          currentElement = null;
          unlocked = true;
          emit({ type: 'ended', ref });
          resolve();
        };
        el.onerror = () => {
          playing = false;
          currentElement = null;
          emit({ type: 'error', ref });
          reject(new Error(`Could not play audio for ${ref.path}.`));
        };
        playing = true;
        emit({ type: 'play', ref });
        el.play().catch((cause: unknown) => {
          playing = false;
          currentElement = null;
          emit({ type: 'error', ref });
          reject(cause instanceof Error ? cause : new Error(String(cause)));
        });
      });
    },

    stop(): void {
      stopWebAudio();
      stopElement();
      playing = false;
    },

    get playing() {
      return playing;
    },

    get unlocked() {
      return unlocked;
    },

    async unlock(): Promise<boolean> {
      const audioCtx = getContext();
      if (!audioCtx) {
        // No Web Audio: the HTMLAudioElement path only truly unlocks once a
        // real play() has succeeded from a user gesture, which callers do by
        // calling play() itself. Report honestly rather than guessing yes.
        return unlocked;
      }
      try {
        if (audioCtx.state === 'suspended') await audioCtx.resume();
        unlocked = audioCtx.state === 'running';
      } catch {
        unlocked = false;
      }
      return unlocked;
    },

    subscribe(fn: Listener): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
