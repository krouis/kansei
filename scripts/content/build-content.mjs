#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const out = join(root, 'public/content');
const read = async (p) => JSON.parse(await readFile(join(root, p), 'utf8'));
const write = async (p, value) => writeFile(join(out, p), JSON.stringify(value) + '\n');
await mkdir(join(out, 'data'), { recursive: true });
const kana = await read('data/kana.json');
const lessons = await read('data/kana-lessons.json');
const audio = await read('public/content/audio/index.json');
const strokes = await read('public/content/strokes/index.json');
// Runtime audio keys are item IDs, while acquisition keys describe source clips.
const clips = Object.fromEntries(kana.flatMap((entry) => {
  const clip = audio.clips[entry.id.replaceAll(':', '/')];
  return clip ? [[entry.id, clip]] : [];
}));
await write('data/kana.json', { kana, lessons });
await write('data/kana-audio.json', { audio: clips });
const strokePaths = [...new Set(kana.flatMap((c) => [...c.glyph].map((glyph) => strokes.characters[glyph]?.file).filter(Boolean)))].map((p) => p.includes('/') ? p : `strokes/${p}`);
const strokeAttribution = { asset: 'Kana stroke paths and derived polylines', source: 'KanjiVG, Ulrich Apel and contributors', url: strokes.sourceUrl, license: 'CC-BY-SA-3.0', licenseUrl: strokes.licenseUrl, notes: 'Resampled into 24-point polylines; canonical forms only, not an exhaustive list of legitimate variants.' };
async function manifest(id, title, description, required, dependsOn, paths, contents, attributions) {
  const files = [];
  for (const [path, kind] of paths.sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    const bytes = await readFile(join(out, path));
    files.push({ path, kind, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return { id, title, description, required, dependsOn, version: createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 16), totalBytes: files.reduce((n, f) => n + f.bytes, 0), files, contents, attributions };
}
const packs = [await manifest('kana', 'Hiragana & katakana', '268 entries in 67 lessons; modern, extended and historical forms labelled separately.', true, [], [['data/kana.json', 'data'], ...strokePaths.map((p) => [p, 'strokes'])], { characters: kana.length, vocab: 0, audioClips: 0, strokeReferences: strokePaths.length }, [strokeAttribution])];
const uniqueClips = [...new Map(Object.values(clips).map((c) => [c.path, c])).values()];
packs.push(await manifest('audio-kana', 'Kana recordings', 'Real recordings for 71/104 modern sounds. No yoon recordings; missing audio never uses synthesis.', true, ['kana'], [['data/kana-audio.json', 'data'], ...uniqueClips.map((c) => [c.path, 'audio'])], { characters: 0, vocab: 0, audioClips: uniqueClips.length, strokeReferences: 0 }, uniqueClips.map((c) => ({ asset: c.path, source: `${c.attribution.source} — ${c.attribution.author}`, url: c.attribution.url, license: c.attribution.license, licenseUrl: c.attribution.licenseUrl, notes: 'Native-speaker status documented by source; recording quality has not had a human release review.' }))));
const ordered = await read('data/kanji-ordered.json');
const components = await read('data/components-ordered.json');
const readings = await read('data/readings.json');
const vocab = await read('data/vocab.json');
const kanjiLessons = await read('data/kanji-lessons.json');
const kanji = ordered.map(k => ({ id:k.id, kind:'kanji', script:'kanji', glyph:k.glyph, frequencyRank:k.frequencyRank, teachingOrder:k.teachingOrder, lessonId:k.lessonId, meanings:k.meanings, readings:readings.filter(r=>r.kanji===k.glyph).map(r=>r.id), components:components.filter(c=>c.appearsIn.includes(k.id)).map(c=>c.id), radical:components.find(c=>c.kangxiNumber===k.radicalClassicalNumber)?.id??null, strokeCount:k.strokeCount, jlptLevel:null, grade:k.grade, confusableWith:[], mnemonic:null, printVsHandwritten:null, tier:'modern-core' }));
// Vocabulary is gated by its required characters; it need not be an explicit
// lesson introduction to remain available in the learning engine.
await write('data/kanji.json', { kanji, components, readings, lessons:kanjiLessons });
await write('data/vocab.json', { vocab });
const vocabClips = Object.fromEntries(vocab.filter(v=>v.audio).map(v=>[v.id,v.audio]));
await write('data/vocab-audio.json', { audio:vocabClips });
const kanjiPaths = kanji.map(k=>`strokes/${strokes.characters[k.glyph].file}`);
const edrdg = { asset:'Kanji definitions, source readings and derived teaching sequence', source:'EDRDG KANJIDIC2', url:'https://www.edrdg.org/wiki/index.php/KANJIDIC_Project', license:'CC-BY-SA-4.0', licenseUrl:'https://www.edrdg.org/edrdg/licence.html', notes:'Source snapshot locked in SOURCES.lock.json. Selection and teaching sequence are Kansei adaptations; old JLPT values are not mapped to N1–N5.' };
packs.push(await manifest('kanji-1500', `${kanji.length.toLocaleString()} frequency-selected kanji`, '375 lessons; components and word-specific readings. Automated curriculum requires Japanese-language review.', true, ['kana'], [['data/kanji.json','data'],...kanjiPaths.map(p=>[p,'strokes'])], {characters:kanji.length,vocab:0,audioClips:0,strokeReferences:kanjiPaths.length}, [edrdg,{...strokeAttribution,asset:'Kanji stroke paths, polylines and component derivations'}]));
packs.push(await manifest('vocab', 'Vocabulary', `${vocab.length} priority-marked dictionary words, gated by required characters. Not a proficiency-certified syllabus.`, true, ['kana','kanji-1500'], [['data/vocab.json','data']], {characters:0,vocab:vocab.length,audioClips:0,strokeReferences:0}, [{...edrdg,asset:'Derived vocabulary selection, glosses and reading alignment',source:'EDRDG JMdict',url:'https://www.edrdg.org/jmdict/j_jmdict.html',notes:'Derived from JMdict; entry sequence IDs retained. No example sentences or full dictionary included.'}]));
const wordClips=[...new Map(Object.values(vocabClips).map(c=>[c.path,c])).values()];
packs.push(await manifest('audio-vocab','Vocabulary recordings', `${wordClips.length} spelling-matched recordings. Coverage incomplete; ambiguous dictionary readings excluded.`,true,['vocab'],[['data/vocab-audio.json','data'],...wordClips.map(c=>[c.path,'audio'])],{characters:0,vocab:0,audioClips:wordClips.length,strokeReferences:0},wordClips.map(c=>({asset:c.path,source:`${c.attribution.source} — ${c.attribution.author}`,url:c.attribution.url,license:c.attribution.license,licenseUrl:c.attribution.licenseUrl,notes:'Native-speaker documentation from source. Human listening review outstanding.'}))));
await write('index.json', { schemaVersion: 1, generatedAt: '2026-09-29T00:00:00.000Z', packs });
console.log(`Built curriculum: ${kanji.length} kanji, ${vocab.length} vocabulary entries, ${readings.length} word-linked readings; kana: ${kana.length} entries, ${lessons.length} lessons, ${strokePaths.length} stroke files, ${uniqueClips.length} recordings. ${packs.reduce((n,p)=>n+p.totalBytes,0)} bytes. Word audio: ${wordClips.length}.`);
