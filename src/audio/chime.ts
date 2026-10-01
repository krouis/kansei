/**
 * Short procedural UI chimes: a quick lift for a correct answer, a single
 * soft tone for an incorrect one, a three-note rise for finishing a session.
 *
 * Deliberately not part of the `AudioPlayer` port. That port's entire
 * contract is "only real recordings, never a synthesised stand-in" — exactly
 * right for pronunciation clips, exactly wrong here: a chime is UI feedback
 * like a notification sound, not content being taught, so it has no
 * recording to be a dishonest substitute for.
 */

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

function tone(ac: AudioContext, freq: number, startAt: number, duration: number, gain: number): void {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  // A short linear attack then an exponential decay, rather than a hard
  // on/off, so the tone reads as a soft chime instead of a click or beep.
  g.gain.setValueAtTime(0, startAt);
  g.gain.linearRampToValueAtTime(gain, startAt + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(g);
  g.connect(ac.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

function play(notes: Array<{ freq: number; delay: number; duration: number; gain?: number }>): void {
  const ac = getContext();
  if (!ac) return;
  // Chimes only ever play as a reaction to the learner's own answer, so this
  // is always close behind a real user gesture; if the browser still blocks
  // it, resume() rejects quietly and the chime is simply silent — never worth
  // surfacing as an error for a piece of pure embellishment.
  if (ac.state === 'suspended') void ac.resume().catch(() => undefined);
  const now = ac.currentTime;
  for (const n of notes) tone(ac, n.freq, now + n.delay, n.duration, n.gain ?? 0.08);
}

/** A quick, bright two-note lift — a graded answer came back correct. */
export function chimeCorrect(): void {
  play([
    { freq: 587.33, delay: 0, duration: 0.11 }, // D5
    { freq: 880.0, delay: 0.09, duration: 0.16 }, // A5
  ]);
}

/** One soft, low tone — different from correct, not a punishment. */
export function chimeIncorrect(): void {
  play([{ freq: 220.0, delay: 0, duration: 0.16, gain: 0.06 }]); // A3
}

/** A short three-note rise — once, on finishing a full session. */
export function chimeComplete(): void {
  play([
    { freq: 523.25, delay: 0, duration: 0.1 }, // C5
    { freq: 659.25, delay: 0.09, duration: 0.1 }, // E5
    { freq: 783.99, delay: 0.18, duration: 0.22 }, // G5
  ]);
}
