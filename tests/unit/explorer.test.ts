import { describe, expect, it } from 'vitest';
import type { KanjiCharacter, SkillState, VocabEntry } from '@/domain';
import { entryProgress, matchesEntry, unpracticedPrerequisites } from '@/features/characters/explorer';

const kanji = { id:'kanji:日', kind:'kanji', glyph:'日', meanings:['day', 'sun'], readings:['reading:nichi','reading:hi'] } as unknown as KanjiCharacter;
const word = { id:'vocab:日本', kind:'vocab', spelling:'日本', reading:'にほん', romaji:'nihon', meaning:'Japan', extraMeanings:[], requiresCharacters:['kanji:日','kanji:本'] } as unknown as VocabEntry;
const content = {readingsFor:()=>[{reading:'にち'}]} as unknown as Parameters<typeof matchesEntry>[2];
const state = (readingId:string|null, stage='retained', extra={}) => ({itemId:kanji.id,skill:'readingRecall',readingId,stage,dueAt:null,totalAttempts:4,...extra}) as unknown as SkillState;

describe('character explorer',()=>{
  it('searches kana-equivalent readings, meanings and mixed query terms',()=>{
    expect(matchesEntry(kanji,'ニチ sun',content)).toBe(true);
    expect(matchesEntry(word,'日本 JAPAN',content)).toBe(true);
    expect(matchesEntry(word,'ニホン',content)).toBe(true);
    expect(matchesEntry(kanji,'moon',content)).toBe(false);
  });
  it('does not hide an unpracticed reading behind a retained reading',()=>{
    expect(entryProgress(kanji,'readingRecall',[state('reading:nichi')]).stage).toBe('unseen');
    expect(entryProgress(kanji,'readingRecall',[state('reading:nichi'),state('reading:hi','learning')]).stage).toBe('learning');
  });
  it('keeps due and learning state separate without combining other skills',()=>{
    const states=[state('reading:nichi'),state('reading:hi','retained',{dueAt:'2026-01-01T00:00:00.000Z'})];
    expect(entryProgress(kanji,'readingRecall',states,'2026-02-01T00:00:00.000Z')).toEqual({stage:'retained',due:true});
    expect(entryProgress(kanji,'handwriting',states)).toEqual({stage:'unseen',due:false});
  });
  it('reports prerequisite practice without inferring mastery',()=>{
    expect(unpracticedPrerequisites(word,[state(null,'learning')])).toEqual(['kanji:本']);
    expect(unpracticedPrerequisites(word,[state(null,'unseen',{totalAttempts:0})])).toHaveLength(2);
  });
});
