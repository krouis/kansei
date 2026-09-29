import { asItemId, itemKind, type KanjiCharacter, type Question } from '@/domain';
import type { GenerationContext, SelectedTarget } from '@/learning/ports';
import { baseEnvelope, emptyPrompt, reject } from '../support';
import { shuffle } from '../rng';

/** Source-backed visual decomposition, without invented component readings. */
export function generateComponentInKanjiChoice(target: SelectedTarget, ctx: GenerationContext) {
  if (itemKind(target.itemId) !== 'component') return reject('This format requires a component target.');
  const components = ctx.pool.components ?? [];
  const component = components.find((c) => String(c.id) === String(target.itemId));
  if (!component) return reject('Component is not installed.');
  const glyphs = new Set([component.glyph, ...component.variants]);
  const equivalentIds = new Set(components.filter((c) =>
    glyphs.has(c.glyph) || c.variants.some((v) => glyphs.has(v))).map((c) => String(c.id)));
  const kanji = ctx.pool.characters.filter((c): c is KanjiCharacter => c.kind === 'kanji');
  const contains = (k: KanjiCharacter) => k.components.some((id) => equivalentIds.has(String(id)));
  const examples = kanji.filter((k) => k.glyph !== component.glyph &&
    component.appearsIn.includes(k.id) && k.components.includes(component.id));
  const correct = examples.sort((a, b) => a.teachingOrder - b.teachingOrder)[0];
  if (!correct) return reject('No installed kanji demonstrates this component in its source decomposition.');
  const distractors = shuffle(kanji.filter((k) => !contains(k) && !glyphs.has(k.glyph)), ctx.random).slice(0, 3);
  if (distractors.length < 3) return reject('Not enough kanji exclude this component and its variants.');
  const question: Question = {
    ...baseEnvelope('component-in-kanji-choice', target, ctx.random),
    prompt: { ...emptyPrompt('Which kanji contains this recurring component?'), text: component.glyph, textIsJapanese: true },
    options: shuffle([correct, ...distractors], ctx.random).map((k, i) => ({
      key: 'ABCD'[i]!, display: k.glyph, itemId: asItemId(String(k.id)), correct: k.id === correct.id,
      distractorReason: k.id === correct.id ? null : 'source-decomposition-excludes-component',
    })),
    pairs: null, acceptedAnswers: [correct.glyph], canonicalAnswer: correct.glyph,
    alsoAcceptableNote: null,
    distinction: `${component.glyph} is a recurring shape in ${correct.glyph}. Components do not have one universal meaning or pronunciation.`,
  };
  return { question, rejected: null };
}

const glosses = (k: KanjiCharacter) => k.meanings.map((s) => s.toLowerCase().replace(/\([^)]*\)/g, '').trim()).filter(Boolean);

/** Meaning recognition remains possible when no safe word-reading mapping exists. */
export function generateMeaningToKanjiChoice(target: SelectedTarget, ctx: GenerationContext) {
  if (itemKind(target.itemId) !== 'kanji') return reject('This format requires a kanji target.');
  const kanji = ctx.pool.characters.filter((c): c is KanjiCharacter => c.kind === 'kanji');
  const entry = kanji.find((k) => String(k.id) === String(target.itemId));
  if (!entry?.meanings.length) return reject('No documented meaning for this kanji.');
  const meanings = glosses(entry);
  const distractors = shuffle(kanji.filter((k) => k.id !== entry.id &&
    !glosses(k).some((gloss) => meanings.some((m) => m.includes(gloss) || gloss.includes(m)))), ctx.random).slice(0, 3);
  if (distractors.length < 3) return reject('Not enough distinct non-overlapping meanings.');
  const question: Question = {
    ...baseEnvelope('meaning-to-kanji-choice', target, ctx.random), targetReadingId: null,
    prompt: { ...emptyPrompt('Choose the kanji associated with this meaning.'), text: entry.meanings[0]! },
    options: shuffle([entry, ...distractors], ctx.random).map((k, i) => ({
      key: 'ABCD'[i]!, display: k.glyph, itemId: asItemId(String(k.id)), correct: k.id === entry.id,
      distractorReason: k.id === entry.id ? null : 'different-documented-meaning',
    })),
    pairs: null, acceptedAnswers: [entry.glyph], canonicalAnswer: entry.glyph,
    alsoAcceptableNote: null, distinction: `${entry.glyph}: ${entry.meanings.join('; ')}. Readings depend on the word.`,
  };
  return { question, rejected: null };
}
