#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';
const read=async p=>JSON.parse(await readFile(p,'utf8')); const write=(p,x)=>writeFile(p,JSON.stringify(x)+'\n');
const raw=await read('data/kanji-top1500.json'), kana=await read('data/kana.json'), components=await read('data/components.json');
const entries=raw.entries, byGlyph=new Map(entries.map(x=>[x.glyph,x]));
const offset=Math.max(...kana.map(x=>x.teachingOrder));
// Pedagogical tier is the PRIMARY sequencing signal, ahead of frequency. Raw
// newspaper frequency (see docs/content/KANJI-FREQUENCY.md §2) puts kanji like
// 氏 ("Mr./Ms.", old-JLPT level 1 — the hardest pre-2010 tier) inside the first
// 40 taught, purely because news articles say "Yamada-shi" constantly; no
// beginner course does that. jlptOldLevel (4=elementary..1=advanced) is a far
// better predictor of what a beginner needs soon, so it now gates the order:
// every old-level-4 kanji is taught before any old-level-3 one, and so on.
// Frequency + stroke count remain the tie-breaker WITHIN a tier — that part of
// the original heuristic is sound, it was just never allowed to matter first.
// Where KANJIDIC2 has no jlptOldLevel (rare in the top 1500 — mostly name/rare
// kanji), MEXT's jōyō school grade stands in, banded to the same four tiers.
const tier=e=>e.jlptOldLevel!=null?4-e.jlptOldLevel:e.grade==null?3:e.grade<=2?0:e.grade<=4?1:e.grade<=6?2:3;
// Containment is not a semantic prerequisite. Only strictly simpler standalone
// components are prerequisites; this removes self/recursive decompositions.
// It must also never run BACKWARDS against tier: without this, an elementary
// kanji like 年 (year, N5) gets stuck waiting on 干 (N3/N2, a rare standalone
// kanji that happens to be a sub-shape of 年/午/南 with fewer strokes) purely
// because 干 is visually simpler — deferring basic vocabulary behind an
// advanced "shape" prerequisite defeats the whole point of tiering. A
// prerequisite is only kept when the parent is no harder a tier than the
// child; the rest are excluded and recorded, the same as a non-strictly-
// simpler edge always was.
const rejected=[], deps=new Map(entries.map(x=>[x.id,[]]));
for(const c of components) for(const id of c.appearsIn){const child=entries.find(x=>x.id===id), parent=byGlyph.get(c.glyph); if(!parent||parent.id===id)continue; if(parent.strokeCount>=child.strokeCount)rejected.push({component:c.id,kanji:id,reason:'Not strictly fewer strokes; introduce as a shape alongside target instead.'});else if(tier(parent)>tier(child))rejected.push({component:c.id,kanji:id,reason:`Component parent (tier ${tier(parent)}) is a harder pedagogical tier than the child (tier ${tier(child)}); shape recognition deferred, not required.`});else deps.get(id).push(parent.id);}
const pending=new Set(entries.map(x=>x.id)), ordered=[];
while(pending.size){const next=entries.filter(x=>pending.has(x.id)&&deps.get(x.id).every(id=>!pending.has(id))).sort((a,b)=>tier(a)-tier(b)||(a.frequencyRank+18*a.strokeCount)-(b.frequencyRank+18*b.strokeCount)||a.frequencyRank-b.frequencyRank)[0];if(!next)throw Error('Prerequisite cycle');pending.delete(next.id);ordered.push(next);}
const lessons=[];
for(let i=0;i<ordered.length;i++){const e=ordered[i];e.teachingOrder=offset+i+1;e.lessonId=`kanji-${String(Math.floor(i/4)+1).padStart(3,'0')}`;}
for(let i=0;i<ordered.length;i+=4){const group=ordered.slice(i,i+4), id=group[0].lessonId;lessons.push({id,title:`Kanji ${i+1}–${i+group.length}: ${group.map(x=>x.glyph).join(' ')}`,script:'kanji',introduces:group.map(x=>x.id),prerequisites:[...new Set(group.flatMap(x=>deps.get(x.id).map(id=>entries.find(e=>e.id===id).lessonId)))].filter(x=>x!==id),note:'Compare the recurring shapes, then learn readings through the example words. Component glosses are not fixed meanings or pronunciations.',order:1000+i/4});}
for(const c of components){const related=components.filter(v=>c.variants.includes(v.glyph)).flatMap(v=>v.appearsIn);const needed=ordered.filter(x=>c.appearsIn.includes(x.id)||related.includes(x.id)||(c.kangxiNumber!==null&&x.radicalClassicalNumber===c.kangxiNumber));const first=needed[0];if(first){c.teachingOrder=first.teachingOrder;c.lessonId=first.lessonId;lessons.find(x=>x.id===first.lessonId).introduces.unshift(c.id);}}
components.sort((a,b)=>a.teachingOrder-b.teachingOrder||a.strokeCount-b.strokeCount||a.id.localeCompare(b.id,'en'));
components.forEach((c,i)=>c.teachingOrder=i+1);
await write('data/kanji-ordered.json',ordered);await write('data/components-ordered.json',components);await write('data/kanji-lessons.json',lessons);await write('data/kanji-order.json',{algorithm:'pedagogical tier (jlptOldLevel, or grade where jlptOldLevel is absent) primary; frequencyRank + 18 × strokeCount as the tie-breaker within a tier; topological prerequisites only for strictly simpler standalone components',offset,order:ordered.map(x=>x.id),prerequisites:Object.fromEntries(deps),excludedContainmentEdges:rejected,tierCountsByHundred:Array.from({length:Math.ceil(ordered.length/100)},(_,i)=>{const slice=ordered.slice(i*100,i*100+100),counts={};for(const x of slice)counts[tier(x)]=(counts[tier(x)]??0)+1;return counts;}),meanFrequencyByDecile:Array.from({length:10},(_,i)=>{const size=Math.ceil(ordered.length/10),slice=ordered.slice(i*size,i*size+size);return slice.reduce((s,x)=>s+x.frequencyRank,0)/slice.length;})});
console.log(`Ordered ${ordered.length} kanji into ${lessons.length} lessons; ${rejected.length} containment edges excluded explicitly.`);
