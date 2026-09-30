#!/usr/bin/env node
/** Conservative JMdict extraction. All decisions are reproducible; no network. */
import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
const read=async p=>JSON.parse(await readFile(p,'utf8')), write=(p,x)=>writeFile(p,JSON.stringify(x)+'\n');
const kana=await read('data/kana.json'), kanji=await read('data/kanji-ordered.json'), audio=(await read('public/content/audio/index.json')).clips;
const byGlyph=new Map([...kana,...kanji].map(c=>[c.glyph,c]));
const xml=gunzipSync(await readFile('data/sources/JMdict_e_examp.gz')).toString();
const entities=Object.fromEntries([...xml.matchAll(/<!ENTITY\s+(\S+)\s+"([^"]*)">/g)].map(m=>[m[1],m[2]]));
const decode=s=>s.replace(/&([^;]+);/g,(_,n)=>({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',...entities}[n]??`&${n};`));
const values=(s,t)=>[...s.matchAll(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${t}>`,'g'))].map(m=>decode(m[1].replace(/<[^>]+>/g,'')));
const blocks=(s,t)=>[...s.matchAll(new RegExp(`<${t}>([\\s\\S]*?)<\\/${t}>`,'g'))].map(m=>m[1]);
const hira=s=>s.replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-96));
const priorities=new Set(['ichi1','news1','spec1','gai1']);
const kanaSegments=[...kana].filter(x=>x.tier!=='historical').sort((a,b)=>b.glyph.length-a.glyph.length);
function characters(spelling){const result=[];for(let pos=0;pos<spelling.length;){const match=kanaSegments.find(c=>spelling.startsWith(c.glyph,pos))??byGlyph.get(spelling[pos]);if(!match)return null;result.push(match);pos+=match.glyph.length;}return [...new Map(result.map(x=>[x.id,x])).values()];}
// Syllabic Hepburn: preserve vowel sequences in lexical words, since collapsing
// every ei/ou into a macron would invent pronunciation across morpheme boundaries.
function romanize(reading){let out='',i=0;const s=hira(reading);while(i<s.length){if(s[i]==='っ'){const n=kanaSegments.find(c=>c.script==='hiragana'&&s.startsWith(c.glyph,i+1));if(!n)return null;out+=n.romaji.startsWith('ch')?'t':n.romaji[0];i++;continue;}if(s[i]==='ー'){const m=out.match(/[aeiou](?=[^aeiou]*$)/);if(!m)return null;out+=m[0];i++;continue;}const c=kanaSegments.find(c=>c.script==='hiragana'&&s.startsWith(c.glyph,i));if(!c)return null;out+=c.romaji;i+=c.glyph.length;if(c.glyph==='ん'&&/[あいうえおやゆよ]/.test(s[i]??''))out+="'";}return out;}
// Explicit pedagogical kana renderings of source readings. Entry IDs prevent
// homophones from silently selecting a different word/sense. These do not claim
// that JMdict recommends kana as the normal orthography.
const starterKana=new Map([['1467640','ねこ'],['1258330','いぬ'],['1302680','やま'],['1371260','みず'],['1358280','たべる'],['1588120','うたう'],['1578850','いく'],['1002430','おちゃ']]);
const candidates=[], dictionaryReadings=new Map();
const commonPriority=xs=>xs.some(x=>priorities.has(x));
const kanaOnly=s=>values(s,'misc').includes('word usually written using kana alone');
const acceptableSense=s=>!values(s,'field').some(x=>x!=='food, cooking')&&!values(s,'dial').length&&!values(s,'misc').some(m=>/archaic|obsolete|vulgar|derogatory|slang|rare term/.test(m))&&!values(s,'pos').some(p=>p.startsWith('auxiliary'))&&!values(s,'pos').every(p=>/^(prefix|suffix|auxiliary|particle|copula)/.test(p));
for(const entry of blocks(xml,'entry')){
 const seq=values(entry,'ent_seq')[0], ks=blocks(entry,'k_ele'), rs=blocks(entry,'r_ele');
 for(const [readingIndex,r] of rs.entries()){const reading=values(r,'reb')[0];if(!reading)continue;
 const restrictions=values(r,'re_restr');
 for(const k of ks){const spelling=values(k,'keb')[0];if(restrictions.length&&!restrictions.includes(spelling))continue;const set=dictionaryReadings.get(spelling)??new Set();set.add(reading);dictionaryReadings.set(spelling,set);}
 // Keep all source readings for audio ambiguity, even when excluded from lessons.
 if(values(r,'re_inf').some(x=>!x.startsWith('gikun')))continue;
 // A common spelling does not make every alternate reading common.
 if(rs.some(x=>commonPriority(values(x,'re_pri')))&&!commonPriority(values(r,'re_pri')))continue;
 let spellings=ks.filter(k=>!values(k,'ke_inf').length&&(!restrictions.length||restrictions.includes(values(k,'keb')[0]))).map(k=>({spelling:values(k,'keb')[0],pri:[...values(k,'ke_pri'),...values(r,'re_pri')],kanaVariant:false}));
 if(!ks.length||r.includes('<re_nokanji/>')||r.includes('<re_nokanji />'))spellings=[{spelling:reading,pri:values(r,'re_pri')}];
 // A kana spelling is eligible only if a matching sense explicitly says so.
 const senses=blocks(entry,'sense').filter(s=>!values(s,'stagr').length||values(s,'stagr').includes(reading));
 if(senses.some(kanaOnly))spellings.push({spelling:reading,pri:values(r,'re_pri'),kanaVariant:true});
 if(starterKana.get(seq)===reading)spellings.push({spelling:reading,pri:values(r,'re_pri'),starterKana:true});
 for(const {spelling,pri,kanaVariant,starterKana:starterAdaptation} of spellings){if(!pri.some(x=>priorities.has(x))||spelling.length>6||reading.length>10)continue;
 const chars=characters(spelling);if(!chars||chars.some(c=>c.tier==='historical'))continue;
 const sense=senses.find(s=>(!values(s,'stagk').length||values(s,'stagk').includes(spelling))&&(!kanaVariant||kanaOnly(s))&&acceptableSense(s));
 if(!sense)continue;const gloss=values(sense.replace(/<example>[\s\S]*?<\/example>/g,''),'gloss');if(!gloss.length)continue;
 let romaji=romanize(reading);if(!romaji)continue;
 // JMdict explicitly records the particle pronunciation in these greetings.
 if(values(sense,'s_inf').includes('は is pronounced as わ')&&reading.endsWith('は'))romaji=romaji.slice(0,-2)+'wa';
 const last=chars.reduce((a,b)=>a.teachingOrder>b.teachingOrder?a:b);
 candidates.push({id:`vocab:${spelling}`,kind:'vocab',spelling,reading,romaji,meaning:gloss[0],extraMeanings:gloss.slice(1,4),partOfSpeech:values(sense,'pos'),pitchAccent:null,requiresCharacters:chars.map(x=>x.id),demonstratesReadings:[],teachingOrder:last.teachingOrder,lessonId:last.lessonId,frequencyRank:null,source:`JMdict entry ${seq} (EDRDG, CC BY-SA 4.0)${starterAdaptation?'; pedagogical kana spelling of source reading':''}`,audio:null,tier:'modern-core',_priority:pri,_seq:seq,_readingIndex:readingIndex,_starterAdaptation:!!starterAdaptation});
 }
 }
}
// Beginner preference is an explicit product heuristic, not a proficiency label.
const score=v=>(v._starterAdaptation?-1000:0)+v.teachingOrder+20*v.reading.length+(v._priority.includes('ichi1')?-120:0)+(audio[`vocab/${v.spelling}`]?-100:0);
candidates.sort((a,b)=>score(a)-score(b)||Number(a._seq)-Number(b._seq)||a.spelling.localeCompare(b.spelling,'ja'));
// Prefer the dictionary's first eligible reading within an entry; length is
// useful for selecting words but must not select their pronunciation.
const preferred=candidates.slice().sort((a,b)=>Number(a._seq)-Number(b._seq)||a._readingIndex-b._readingIndex);
const preferredKeys=new Set(), preferredCandidates=preferred.filter(v=>{const key=`${v.spelling}:${v._seq}`;if(preferredKeys.has(key))return false;preferredKeys.add(key);return true;});
preferredCandidates.sort((a,b)=>score(a)-score(b)||Number(a._seq)-Number(b._seq));
const unique=[...new Map(preferredCandidates.slice().reverse().map(v=>[v.spelling,v])).values()].sort((a,b)=>score(a)-score(b)||a.id.localeCompare(b.id,'ja'));
// Cover each taught character when an eligible common word exists, then fill.
const selected=new Map();
const starterWords=['ねこ','いぬ','やま','みず','たべる','うたう','いく','おちゃ','ありがとう','コーヒー','テレビ','パン','ケーキ','水','食べる','おはよう','こんにちは','さようなら','すみません','はい','いいえ','お茶','学校','先生','学生','本','人','日','月','火','木','金','土','日本','名前','今日','明日','昨日','見る','聞く','話す','読む','書く'];
for(const spelling of starterWords){const v=unique.find(v=>v.spelling===spelling);if(v)selected.set(v.id,v);}
for(const k of kanji){const v=unique.find(v=>v.requiresCharacters.includes(k.id));if(v)selected.set(v.id,v);}for(const v of unique){if(selected.size>=1600)break;selected.set(v.id,v);}
const vocab=[...selected.values()].sort((a,b)=>a.teachingOrder-b.teachingOrder||a.id.localeCompare(b.id,'ja'));
// Segment the whole reading against kana and dictionary stems. Ambiguous paths
// are discarded; irregular/jukujikun words remain valid whole-word exercises.
const voiced={'か':'が','き':'ぎ','く':'ぐ','け':'げ','こ':'ご','さ':'ざ','し':'じ','す':'ず','せ':'ぜ','そ':'ぞ','た':'だ','ち':'ぢ','つ':'づ','て':'で','と':'ど','は':'ば','ひ':'び','ふ':'ぶ','へ':'べ','ほ':'ぼ'};
// KANJIDIC2 genuinely double-lists a few kanji's bare reading as BOTH on and kun
// (気="キ"/on and "き"/kun; also 医, 死, 画, 差…), so the same kana surface can
// come from two rows above with no note. Left alone, the segmenter below sees
// that as two different solutions and calls the word ambiguous, even though the
// character boundaries are identical and only the on/kun LABEL is unsettled.
// followedByKana resolves the label with the ordinary textbook signal — kun
// readings carry okurigana, on readings appear in bare kanji compounds — rather
// than inventing a reading; a same-surface on/kun pair collapses to whichever
// label that signal picks, and only when neither entry carries a derived
// voicing/gemination note (a real phonological difference must not be merged).
function options(g,ctx){const k=byGlyph.get(g);if(!k?.on)return [{surface:hira(g),type:null,note:null}];const out=[];for(const type of ['on','kun'])for(const raw of k[type]){const stem=hira(raw.replaceAll('-','').split('.')[0]);if(!stem)continue;out.push({surface:stem,type,note:null});if(voiced[stem[0]])out.push({surface:voiced[stem[0]]+stem.slice(1),type,note:`Voicing (rendaku) of ${stem} in this word.`});if(/[つくき]$/.test(stem))out.push({surface:stem.slice(0,-1)+'っ',type,note:`Gemination of ${stem} in this word.`});}
 // Stage 1, unchanged from before: fold to one entry per surface+type (a kanji
 // can list an on-reading that is itself already another on-reading's voiced
 // form, e.g. 分's ブン beside フン's rendaku ぶん — last one written wins, same
 // as always, so that dormant same-type coincidence stays exactly as settled).
 const byTypeAndSurface=new Map();
 for(const o of out)byTypeAndSurface.set(`${o.surface}:${o.type}`,o);
 // Stage 2, new: KANJIDIC2 genuinely double-lists a few kanji's bare reading as
 // BOTH on and kun (気="キ"/on and "き"/kun; also 医, 死, 画, 差…), so the same
 // kana surface can survive stage 1 under both types with no note. That is a
 // label disagreement, not a different segmentation, so collapse it using the
 // ordinary textbook signal — kun readings carry okurigana, on readings appear
 // in bare kanji compounds — rather than inventing a reading. Restricted to
 // note===null on both sides so a genuine phonological difference (like the
 // stage-1 case above) is never merged.
 const preferredType=ctx?.followedByKana?'kun':'on', bySurface=new Map();
 for(const o of byTypeAndSurface.values()){const prior=bySurface.get(o.surface);if(!prior||(o.note===null&&prior.note===null&&o.type===preferredType))bySurface.set(o.surface,o);}
 return [...bySurface.values()];}
const readings=new Map();let ambiguous=0,unaligned=0,aligned=0;const unmatched=[];
for(const v of vocab){const glyphs=[...v.spelling], target=hira(v.reading), solutions=[];function walk(i,p,parts){if(solutions.length>1)return;if(i===glyphs.length){if(p===target.length)solutions.push(parts);return;}
 // Okurigana (kana right after this glyph in the SPELLING, not the reading) is
 // the ordinary signal that a kun reading, not an on reading, is in play here.
 const followedByKana=i+1<glyphs.length&&!byGlyph.get(glyphs[i+1])?.on;
 for(const o of options(glyphs[i],{followedByKana}))if(target.startsWith(o.surface,p)){if(o.note?.startsWith('Gemination')&&!/^[かきくけこさしすせそたちつてとぱぴぷぺぽ]/.test(target.slice(p+o.surface.length)))continue;walk(i+1,p+o.surface.length,[...parts,{glyph:glyphs[i],...o}]);}}walk(0,0,[]);
 if(glyphs.some(g=>byGlyph.get(g)?.on)){if(solutions.length===0){unaligned++;unmatched.push(v.id);}else if(solutions.length>1){ambiguous++;unmatched.push(v.id);}else {aligned++;for(const part of solutions[0].filter(x=>x.type)){const id=`reading:${part.glyph}:${part.surface}:${v.spelling}`;let record=readings.get(id);if(record&&record.type!==part.type){continue;}if(!record){record={id,kanji:part.glyph,reading:part.surface,type:part.type,exampleVocab:[],frequencyShare:null,notes:part.note};readings.set(id,record);}if(!record.exampleVocab.includes(v.id))record.exampleVocab.push(v.id);if(!v.demonstratesReadings.includes(id))v.demonstratesReadings.push(id);}}}
 // A spelling with multiple dictionary readings cannot safely be assigned an
 // isolated recording by filename alone. Those clips await listening review.
 const possible=dictionaryReadings.get(v.spelling)??new Set([v.reading]);if(possible.size===1&&possible.has(v.reading))v.audio=audio[`vocab/${v.spelling}`]??null;
 delete v._priority;delete v._seq;delete v._readingIndex;delete v._starterAdaptation;
}
const report={starterWordsUnavailable:starterWords.filter(s=>!vocab.some(v=>v.spelling===s)),selected:vocab.length,candidates:unique.length,alignedWords:aligned,ambiguousWords:ambiguous,unalignedWords:unaligned,unmatchedWords:unmatched,readings:readings.size,withAudio:vocab.filter(v=>v.audio).length,kanjiWithoutVocabulary:kanji.filter(k=>!vocab.some(v=>v.requiresCharacters.includes(k.id))).map(k=>k.glyph),kanjiWithoutAlignedReading:kanji.filter(k=>![...readings.values()].some(r=>r.kanji===k.glyph)).map(k=>k.glyph),notes:['Dictionary priority is not an independently reviewed beginner syllabus.','Whole-word readings are retained even when per-character alignment is ambiguous.','Audio matches source spelling and unique selected dictionary reading; human listening review remains required.','Long vowels retain kana vowel sequences in displayed syllabic Hepburn, not inferred macrons.']};
await write('data/vocab.json',vocab);await write('data/readings.json',[...readings.values()]);await write('data/vocab-report.json',report);console.log(JSON.stringify({...report,unmatchedWords:report.unmatchedWords.length}));
