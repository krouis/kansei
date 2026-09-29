#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';
const read=async p=>JSON.parse(await readFile(p,'utf8')); const write=(p,x)=>writeFile(p,JSON.stringify(x)+'\n');
const raw=await read('data/kanji-top1000.json'), kana=await read('data/kana.json'), components=await read('data/components.json');
const entries=raw.entries, byGlyph=new Map(entries.map(x=>[x.glyph,x]));
const offset=Math.max(...kana.map(x=>x.teachingOrder));
// Containment is not a semantic prerequisite. Only strictly simpler standalone
// components are prerequisites; this removes self/recursive decompositions.
const rejected=[], deps=new Map(entries.map(x=>[x.id,[]]));
for(const c of components) for(const id of c.appearsIn){const child=entries.find(x=>x.id===id), parent=byGlyph.get(c.glyph); if(!parent||parent.id===id)continue; if(parent.strokeCount<child.strokeCount)deps.get(id).push(parent.id);else rejected.push({component:c.id,kanji:id,reason:'Not strictly fewer strokes; introduce as a shape alongside target instead.'});}
const pending=new Set(entries.map(x=>x.id)), ordered=[];
while(pending.size){const next=entries.filter(x=>pending.has(x.id)&&deps.get(x.id).every(id=>!pending.has(id))).sort((a,b)=>(a.frequencyRank+18*a.strokeCount)-(b.frequencyRank+18*b.strokeCount)||a.frequencyRank-b.frequencyRank)[0];if(!next)throw Error('Prerequisite cycle');pending.delete(next.id);ordered.push(next);}
const lessons=[];
for(let i=0;i<ordered.length;i++){const e=ordered[i];e.teachingOrder=offset+i+1;e.lessonId=`kanji-${String(Math.floor(i/4)+1).padStart(3,'0')}`;}
for(let i=0;i<ordered.length;i+=4){const group=ordered.slice(i,i+4), id=group[0].lessonId;lessons.push({id,title:`Kanji ${i+1}–${i+group.length}: ${group.map(x=>x.glyph).join(' ')}`,script:'kanji',introduces:group.map(x=>x.id),prerequisites:[...new Set(group.flatMap(x=>deps.get(x.id).map(id=>entries.find(e=>e.id===id).lessonId)))].filter(x=>x!==id),note:'Compare the recurring shapes, then learn readings through the example words. Component glosses are not fixed meanings or pronunciations.',order:1000+i/4});}
for(const c of components){const related=components.filter(v=>c.variants.includes(v.glyph)).flatMap(v=>v.appearsIn);const needed=ordered.filter(x=>c.appearsIn.includes(x.id)||related.includes(x.id)||(c.kangxiNumber!==null&&x.radicalClassicalNumber===c.kangxiNumber));const first=needed[0];if(first){c.teachingOrder=first.teachingOrder;c.lessonId=first.lessonId;lessons.find(x=>x.id===first.lessonId).introduces.unshift(c.id);}}
components.sort((a,b)=>a.teachingOrder-b.teachingOrder||a.strokeCount-b.strokeCount||a.id.localeCompare(b.id,'en'));
components.forEach((c,i)=>c.teachingOrder=i+1);
await write('data/kanji-ordered.json',ordered);await write('data/components-ordered.json',components);await write('data/kanji-lessons.json',lessons);await write('data/kanji-order.json',{algorithm:'frequencyRank + 18 × strokeCount; topological prerequisites only for strictly simpler standalone components',offset,order:ordered.map(x=>x.id),prerequisites:Object.fromEntries(deps),excludedContainmentEdges:rejected,meanFrequencyByDecile:Array.from({length:10},(_,i)=>ordered.slice(i*100,i*100+100).reduce((s,x)=>s+x.frequencyRank,0)/100)});
console.log(`Ordered ${ordered.length} kanji into ${lessons.length} lessons; ${rejected.length} containment edges excluded explicitly.`);
