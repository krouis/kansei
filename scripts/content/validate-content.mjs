#!/usr/bin/env node
/** Cross-dataset acceptance checks, not merely schema shape checks. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url)), read=async p=>JSON.parse(await readFile(join(root,p),'utf8'));
const check=(ok,message)=>{if(!ok)throw Error(message);};
const index=await read('public/content/index.json'), {kana,lessons:kanaLessons}=await read('public/content/data/kana.json'), {kanji,components,readings,lessons:kanjiLessons}=await read('public/content/data/kanji.json'), {vocab}=await read('public/content/data/vocab.json');
const lessons=[...kanaLessons,...kanjiLessons], characters=[...kana,...kanji], items=[...characters,...components,...readings,...vocab];
const map=xs=>new Map(xs.map(x=>[x.id,x]));const itemMap=map(items), charMap=map(characters), lessonMap=map(lessons), readingMap=map(readings), vocabMap=map(vocab), componentMap=map(components);
check(itemMap.size===items.length,'Duplicate item IDs');check(lessonMap.size===lessons.length,'Duplicate lesson IDs');check(kanji.length===1500,'Must cover 1,500 kanji');
function refs(ids,label,lookup=itemMap){for(const id of ids)check(lookup.has(id),`${label}: missing ${id}`);}
for(const item of items){check(item.id===item.id.normalize('NFC'),`Non-NFC ID ${item.id}`);if(item.glyph)check(item.glyph===item.glyph.normalize('NFC'),`Non-NFC glyph ${item.id}`);if(item.lessonId)check(lessonMap.has(item.lessonId),`Missing lesson ${item.id}`);}
const order=characters.map(c=>c.teachingOrder).sort((a,b)=>a-b);check(order.every((n,i)=>n===i+1),'Character teaching order must be dense and unique');
for(const c of kana)refs([...c.derivesFrom,...c.confusableWith],c.id,charMap);
for(const k of kanji){refs(k.readings,k.id,readingMap);refs(k.components,k.id,componentMap);if(k.radical)refs([k.radical],k.id,componentMap);for(const c of k.components)check(lessonMap.get(componentMap.get(c).lessonId).order<=lessonMap.get(k.lessonId).order,`Late component ${c} for ${k.id}`);}
for(const c of components)refs(c.appearsIn,c.id,charMap);
for(const l of lessons){refs(l.introduces,l.id);refs(l.prerequisites,l.id,lessonMap);for(const p of l.prerequisites)check(lessonMap.get(p).order<l.order,`Late/cyclic prerequisite ${p}`);}
const orderReport=await read('data/kanji-order.json');for(const [id,dependencies] of Object.entries(orderReport.prerequisites))for(const p of dependencies)check(charMap.get(p).teachingOrder<charMap.get(id).teachingOrder,`Kanji prerequisite ${p} after ${id}`);
for(const v of vocab){refs(v.requiresCharacters,v.id,charMap);refs(v.demonstratesReadings,v.id,readingMap);check(v.requiresCharacters.length>0,`Ungated word ${v.id}`);const gate=Math.max(...v.requiresCharacters.map(id=>charMap.get(id).teachingOrder));check(v.teachingOrder>=gate,`Premature word ${v.id}`);check(lessonMap.get(v.lessonId).order>=Math.max(...v.requiresCharacters.map(id=>lessonMap.get(charMap.get(id).lessonId).order)),`Premature word lesson ${v.id}`);check(v.spelling===v.spelling.normalize('NFC')&&v.reading===v.reading.normalize('NFC'),`Non-NFC word ${v.id}`);for(const r of v.demonstratesReadings)check(readingMap.get(r).exampleVocab.includes(v.id),`Missing reciprocal reading ${v.id}`);}
for(const r of readings){check(r.exampleVocab.length>0,`Empty reading ${r.id}`);refs(r.exampleVocab,r.id,vocabMap);check(characters.some(c=>c.glyph===r.kanji),`Missing reading kanji ${r.id}`);for(const v of r.exampleVocab)check(vocabMap.get(v).spelling.includes(r.kanji)&&vocabMap.get(v).demonstratesReadings.includes(r.id),`Invalid reading example ${r.id}`);}
let files=0;const paths=new Map(),packs=new Set(index.packs.map(p=>p.id));
for(const p of index.packs){check(p.totalBytes===p.files.reduce((n,f)=>n+f.bytes,0),`Incorrect bytes ${p.id}`);refs(p.dependsOn,p.id,packs);check(p.attributions.length>0,`Missing credits ${p.id}`);for(const f of p.files){check(!f.path.startsWith('/')&&!f.path.includes('\\')&&!f.path.split('/').some(x=>['..','.',''].includes(x)),`Unsafe path ${f.path}`);const bytes=await readFile(join(root,'public/content',f.path));check(bytes.length===f.bytes,`Bytes ${f.path}`);check(createHash('sha256').update(bytes).digest('hex')===f.sha256,`Digest ${f.path}`);if(f.kind==='strokes'){const ref=JSON.parse(bytes),entry=characters.find(c=>c.glyph===ref.glyph);if(entry)check(entry.strokeCount===ref.strokes.length,`Stroke count ${entry.id}`);}paths.set(f.path,f);files++;}}
const audio={...(await read('public/content/data/kana-audio.json')).audio,...(await read('public/content/data/vocab-audio.json')).audio};
for(const [id,clip] of Object.entries(audio)){check(itemMap.has(id),`Audio target ${id}`);const file=paths.get(clip.path);check(file,`Unpacked audio ${id}`);check(file.sha256===clip.sha256&&file.bytes===clip.bytes,`Audio digest mismatch ${id}`);check(clip.attribution.url&&clip.attribution.license&&clip.attribution.author&&clip.attribution.nativeSpeakerDocumented,`Missing audio attribution ${id}`);}
for(const v of vocab)if(v.audio)check(audio[v.id]?.path===v.audio.path,`Missing word audio index ${v.id}`);
if (!process.argv.includes('--runtime-only')) for(const source of Object.values((await read('data/sources/SOURCES.lock.json')).files)){const bytes=await readFile(join(root,source.file));check(bytes.length===source.bytes&&createHash('sha256').update(bytes).digest('hex')===source.sha256,`Source lock mismatch ${source.file}`);}
const report=await read('data/vocab-report.json');
console.log(`Content validation passed: ${kana.length} kana, ${kanji.length} kanji, ${components.length} components, ${vocab.length} words, ${readings.length} readings, ${lessons.length} lessons; ${files} verified pack files. ${report.kanjiWithoutVocabulary.length} kanji without vocabulary; ${report.kanjiWithoutAlignedReading.length} without confidently aligned per-character readings. Human content/audio/handwriting review remains outstanding.`);

if (process.argv.includes('--runtime-only')) console.log('Runtime-only validation: upstream source archive hashes were not checked.');
