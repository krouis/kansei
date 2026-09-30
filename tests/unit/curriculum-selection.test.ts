import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {buildItemIndex,type SelectionLibrary} from '@/learning/selection/items';
import {pickNewMaterial} from '@/learning/selection/newMaterial';
import {DEFAULT_SELECTION_TUNING} from '@/learning/selection/tuning';
import {DefaultSelector} from '@/learning/selection/selector';
import {defaultSettings} from '@/persistence/settingsStore';
import type {Skill,Settings} from '@/domain';
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const kana=read('data/kana.json'), kanji=read('public/content/data/kanji.json').kanji, components=read('data/components-ordered.json'), vocab=read('data/vocab.json'), readings=read('data/readings.json');
const library:SelectionLibrary={kana:script=>kana.filter((k:any)=>k.script===script),kanji:()=>kanji,components:()=>components,vocab:()=>vocab,lessons:()=>[...read('data/kana-lessons.json'),...read('data/kanji-lessons.json')],readingsFor:g=>readings.filter((r:any)=>r.kanji===g),hasAudio:()=>false,hasStrokes:()=>true};
const index=buildItemIndex(library);
const settings={...defaultSettings(),activeScripts:['kanji'] as Settings['activeScripts'],silentPractice:true,keyboardOnlyMode:true};
const allowedSkills=new Set<Skill>(['recognition','readingRecall']);
const pick=(started:string[],preferences=settings)=>pickNewMaterial({index,settings:preferences,allowedSkills,startedItems:new Set(started),attemptedPairs:new Set(),excludedItems:new Set(),tuning:DEFAULT_SELECTION_TUNING});
describe('curriculum selection',()=>{
 it('introduces useful components alongside real kanji',()=>{
  const group=pick([]).group;expect(group.some(x=>x.kind==='kanji')).toBe(true);expect(group.filter(x=>x.kind==='component').length).toBeLessThanOrEqual(2);
 });
 it('introduces vocabulary only after each required character, independently of lesson introduces arrays',()=>{
  const word=vocab.find((v:any)=>v.spelling==='いいえ');expect(word).toBeDefined();
  const prefs={...settings,activeScripts:['hiragana'] as Settings['activeScripts']};
  expect(pick([],prefs).group.some(x=>x.kind==='vocab')).toBe(false);
  const ready=pick(word.requiresCharacters,prefs).group.filter(x=>x.kind==='vocab');expect(ready.length).toBeGreaterThan(0);
  for(const v of ready)if(v.kind==='vocab')expect(v.requiresCharacters.every(id=>word.requiresCharacters.includes(id))).toBe(true);
 });
 it('does not select unsupported component or multi-character word handwriting',()=>{
  expect(index.applicable(components[0]).handwriting).toBe(false);expect(index.applicable(vocab[0]).handwriting).toBe(false);
 });
 it('always fills a first keyboard-only kanji series with ten eligible screens',async()=>{
  const selector=new DefaultSelector({library,skills:{all:async()=>[],due:async()=>[]},confusions:{top:async()=>[],markRepairScheduled:async()=>{}}});
  const selected=await selector.select({settings,now:new Date(),screens:10,policy:settings.selectionPolicy,focusItemId:null,allowedSkills:[...allowedSkills],exclude:[]});
  expect(selected.targets).toHaveLength(10);expect(selected.targets.some(x=>String(x.itemId).startsWith('kanji:'))).toBe(true);
 });
 it('does not let ready all-kana vocabulary crowd out a real kanji lesson once kana is finished',async()=>{
  // The realistic shape of a learner who turned kanji on after finishing kana:
  // every kana item already started, both scripts plus kanji active. Before the
  // fix, pickNewMaterial put ready vocabulary FIRST in its returned group, and
  // the selector's round-robin fill stops at the (default) 2-item new-material
  // quota — so with well over 100 all-kana words already eligible, an actual
  // kanji character would never win a "new" slot for dozens of series.
  const allKanaIds=kana.map((k:any)=>k.id);
  const prefs={...settings,activeScripts:['hiragana','katakana','kanji'] as Settings['activeScripts']};
  const group=pick(allKanaIds,prefs).group;
  expect(group.some(x=>x.kind==='kanji'||x.kind==='component')).toBe(true);
  // Mirror pick()'s manually-started set into the SkillState rows the real
  // selector reads: it derives its own `startedItems` from skills.all(), not
  // from anything passed directly, so a mock returning [] (as the other test
  // above uses) would make every kana look unstarted to the selector too.
  const states=allKanaIds.flatMap((itemId:string)=>(['recognition','readingRecall'] as const).map(skill=>({
   itemId,skill,readingId:null,stage:'retained',stability:30,difficulty:3,streak:3,spacedSuccesses:3,
   totalAttempts:3,unaidedFirstAttemptCorrect:3,aidedAttempts:0,lapses:0,firstSeenAt:new Date().toISOString(),
   lastReviewedAt:new Date().toISOString(),lastUnaidedSuccessAt:new Date().toISOString(),
   dueAt:new Date(Date.now()+30*86400000).toISOString(),lastIntervalDays:30,medianMsByInput:{},
   scaffoldLevel:0,strongestEvidencePassed:'strong',
  })));
  const selector=new DefaultSelector({library,skills:{all:async()=>states as any,due:async()=>[]},confusions:{top:async()=>[],markRepairScheduled:async()=>{}}});
  const selected=await selector.select({settings:prefs,now:new Date(),screens:10,policy:prefs.selectionPolicy,focusItemId:null,allowedSkills:[...allowedSkills],exclude:[]});
  expect(selected.targets.some(x=>String(x.itemId).startsWith('kanji:')||String(x.itemId).startsWith('comp:'))).toBe(true);
 });
});
