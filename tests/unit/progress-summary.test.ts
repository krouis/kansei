import {describe,it,expect} from 'vitest';
import {accuracyRows,delayedRecall,mondayOf,practiceSummary} from '@/features/progress/summary';
import type {AttemptRecord,DailyRecord} from '@/domain';
const attempt=(patch:Partial<AttemptRecord>)=>({itemId:'kana:a',skill:'readingRecall',readingId:null,at:'2026-09-01T10:00:00Z',localDate:'2026-09-01',attemptOrdinal:0,evidence:'strong',focusedPractice:false,hintsUsed:[],outcome:'correct',questionType:'character-to-typed-reading',...patch} as AttemptRecord);
describe('progress summaries',()=>{
 it('anchors weeks on Monday and excludes future local dates',()=>{
 expect(mondayOf('2026-09-27')).toBe('2026-09-21');
 const days=[{localDate:'2026-09-27',xp:20,activeMs:100},{localDate:'2026-09-28',xp:10,activeMs:200},{localDate:'2026-09-30',xp:99,activeMs:300}] as DailyRecord[];
 expect(practiceSummary(days,'2026-09-29')).toEqual({weekXp:10,monthXp:30,allXp:30,activeMs:300,lastSeven:2});
 });
 it('excludes retries and uncertain outcomes from scored accuracy',()=>{
 const rows=accuracyRows([attempt({}),attempt({outcome:'incorrect'}),attempt({outcome:'uncertain'}),attempt({attemptOrdinal:1})],'skill');
 expect(rows[0]).toMatchObject({correct:1,count:2,uncertain:1,value:0.5});
 });
 it('counts delayed incorrect recall and resets spacing after corrections',()=>{
 const rows=delayedRecall([attempt({}),attempt({at:'2026-09-02T10:00:00Z',localDate:'2026-09-02',outcome:'incorrect'}),attempt({at:'2026-09-02T10:01:00Z',localDate:'2026-09-02',attemptOrdinal:1}),attempt({at:'2026-09-03T10:00:00Z',localDate:'2026-09-03'})]);
 expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({correct:0,count:1,value:null});
 });
});
