import type { CharacterEntry, LearningStage, Skill, SkillState, VocabEntry } from '@/domain';
import type { ContentLibrary } from '@/content/ports';

export type ExplorerEntry = CharacterEntry | VocabEntry;
const stages: LearningStage[] = ['unseen', 'learning', 'consolidating', 'retained'];
const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));

export function matchesEntry(entry: ExplorerEntry, query: string, content: Pick<ContentLibrary, 'readingsFor'>): boolean {
  const fields = entry.kind === 'vocab' ? [entry.spelling, entry.reading, entry.romaji, entry.meaning, ...entry.extraMeanings]
    : entry.kind === 'kana' ? [entry.glyph, entry.romaji, ...entry.inputVariants, entry.note ?? '']
    : [entry.glyph, ...entry.meanings, ...content.readingsFor(entry.glyph).map(r => r.reading)];
  return normalize(query).trim().split(/\s+/).every(term => fields.some(field => normalize(field).includes(term)));
}

/** Every taught reading must have evidence before its aggregate can advance. */
export function entryProgress(entry: ExplorerEntry, skill: Skill, states: SkillState[], now = new Date().toISOString()) {
  const relevant = states.filter(s => String(s.itemId) === entry.id && s.skill === skill);
  const readings = entry.kind === 'kanji' && skill === 'readingRecall' ? entry.readings : [];
  const observed = readings.length ? readings.map(id => relevant.find(s => s.readingId === id)?.stage ?? 'unseen')
    : [relevant.find(s => s.readingId === null)?.stage ?? 'unseen'];
  return {
    stage: stages[Math.min(...observed.map(stage => stages.indexOf(stage)))]!,
    due: relevant.some(s => s.dueAt !== null && s.dueAt <= now),
  };
}

export function unpracticedPrerequisites(word: VocabEntry, skills: SkillState[]): string[] {
  const practiced = new Set(skills.filter(s => s.totalAttempts > 0).map(s => String(s.itemId)));
  return word.requiresCharacters.filter(id => !practiced.has(id));
}
