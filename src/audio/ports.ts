import type { AudioRef } from '@/domain';

/**
 * Audio port.
 *
 * Only real recordings are played. There is no speech-synthesis fallback: if a
 * clip is missing the caller must not generate a listening question in the first
 * place, and `play` rejects rather than substituting anything.
 */
export interface AudioPlayer {
  /** Decode and cache a clip so the first play has no delay. */
  preload(ref: AudioRef): Promise<void>;
  play(ref: AudioRef): Promise<void>;
  stop(): void;
  readonly playing: boolean;
  /** Replays are counted per question, and are never treated as a hint. */
  subscribe(fn: (event: { type: 'play' | 'ended' | 'error'; ref: AudioRef | null }) => void): () => void;
  /**
   * Whether audio output is usable at all: some browsers block playback until a
   * user gesture, which the UI must explain rather than silently fail.
   */
  readonly unlocked: boolean;
  unlock(): Promise<boolean>;
}
