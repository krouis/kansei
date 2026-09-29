import { useEffect, useState } from 'react';
import type { Services } from '@/app/services';
import { LEARNING_STAGE_LABELS, LEARNING_STAGE_MARK, SKILLS, SKILL_LABELS } from '@/domain';
import type { AttemptRecord, CapturedStroke, ItemId, Skill, SkillState, StrokeReference } from '@/domain';
import { Button, Card } from '@/ui/primitives';
import { Writing } from '@/features/practice/Writing';
import { entryProgress, matchesEntry, unpracticedPrerequisites, type ExplorerEntry } from './explorer';

type View = 'hiragana' | 'katakana' | 'kanji' | 'vocabulary';
export function CharactersPage({services:s, skills, busy, focus}: {services:Services; skills:SkillState[]; busy:boolean; focus:(id:ItemId)=>void}) {
  const [view,setView] = useState<View>('hiragana');
  const [query,setQuery] = useState('');
  const [skill,setSkill] = useState<Skill>('recognition');
  const [order,setOrder] = useState<'teaching'|'frequency'>('teaching');
  const [selected,setSelected] = useState<ExplorerEntry>();
  const [reference,setReference] = useState<StrokeReference|null>(null);
  const [strokes,setStrokes] = useState<CapturedStroke[]>([]);
  const [trace,setTrace] = useState(true);
  const [history,setHistory] = useState<AttemptRecord[]>([]);
  const [error,setError] = useState('');
  const [page,setPage] = useState(0);
  useEffect(() => {
    let current = true; setReference(null); setStrokes([]); setHistory([]); setError('');
    if (selected) {
      if (selected.kind !== 'vocab') void s.content.strokes(selected.glyph).then(r => { if(current)setReference(r??null); }).catch(e => {if(current)setError(String(e));});
      void s.db.transact('readonly',tx => tx.attempts.forItem(selected.id as unknown as ItemId, 12)).then(rows => {if(current)setHistory(rows);}).catch(e => {if(current)setError(String(e));});
    }
    return () => {current=false;};
  },[selected,s]);
  const entries: ExplorerEntry[] = view === 'kanji' ? s.content.kanji() : view === 'vocabulary' ? s.content.vocab() : s.content.kana(view);
  const filtered = entries.filter(e => matchesEntry(e,query,s.content)).sort((a,b) => {
    if(order==='frequency' && a.kind!=='kana' && b.kind!=='kana') return (a.frequencyRank??Infinity)-(b.frequencyRank??Infinity) || a.teachingOrder-b.teachingOrder;
    return a.teachingOrder-b.teachingOrder;
  });
  const pageSize = 100;
  const paginated = view==='kanji'||view==='vocabulary';
  const visible = paginated ? filtered.slice(page*pageSize,(page+1)*pageSize) : filtered;
  const groups = [...new Set(visible.map(e => e.kind==='kana'?`${e.tier} / ${e.group}`:e.kind==='kanji'?`${order==='frequency'?'Frequency':'Teaching'} positions ${Math.floor(((order==='frequency'?e.frequencyRank:e.teachingOrder)-1)/100)*100+1}–${Math.ceil((order==='frequency'?e.frequencyRank:e.teachingOrder)/100)*100}`:`Words in ${order==='frequency'?'frequency':'teaching'} order`))];
  const groupFor = (e:ExplorerEntry) => e.kind==='kana'?`${e.tier} / ${e.group}`:e.kind==='kanji'?`${order==='frequency'?'Frequency':'Teaching'} positions ${Math.floor(((order==='frequency'?e.frequencyRank:e.teachingOrder)-1)/100)*100+1}–${Math.ceil((order==='frequency'?e.frequencyRank:e.teachingOrder)/100)*100}`:`Words in ${order==='frequency'?'frequency':'teaching'} order`;
  const words = selected ? selected.kind==='vocab' ? [selected] : s.content.vocabFor(selected.id) : [];
  const play = (entry:ExplorerEntry) => {const audio=s.content.audio(entry.id)??(entry.kind==='vocab'?entry.audio:null);if(audio)void s.audio.play(audio).catch(e=>setError(String(e)));};
  const hasAudio = (entry:ExplorerEntry) => Boolean(s.content.audio(entry.id)??(entry.kind==='vocab'?entry.audio:null));
  return <>
    <header><p className="eyebrow">Your character collection</p><h1>Look a little closer.</h1></header>
    <div className="actions" role="group" aria-label="Writing system">{(['hiragana','katakana','kanji','vocabulary'] as const).map(v=><Button key={v} aria-pressed={view===v} onClick={()=>{setView(v);setSelected(undefined);setPage(0);setQuery('');}}>{v}</Button>)}</div>
    <div className="two-col"><label className="field">Search<input value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}} placeholder="Character, word, meaning or reading"/></label><label className="field">Progress by skill<select value={skill} onChange={e=>setSkill(e.target.value as Skill)}>{SKILLS.map(x=><option key={x} value={x}>{SKILL_LABELS[x]}</option>)}</select></label></div>
    {paginated&&<><label className="field">Order<select value={order} onChange={e=>{setOrder(e.target.value as typeof order);setPage(0);}}><option value="teaching">Teaching order</option><option value="frequency">Frequency rank</option></select></label><p>Frequency is a corpus ranking; teaching order introduces useful components and words. Vocabulary glosses and reading alignments are generated from dictionary data and still need editorial review. Rare or specialized words may appear.</p></>}
    {!entries.length&&<Card><p>This content is not installed. Install or verify content in Settings.</p></Card>}
    {error&&<p role="alert">{error}</p>}
    {selected&&<Card className="stack"><Button onClick={()=>setSelected(undefined)}>Close revision</Button><div className="prompt jp" lang="ja">{selected.kind==='vocab'?selected.spelling:selected.glyph}</div>
      {selected.kind==='kana'?<><h2>{selected.romaji}</h2><p>{selected.note}</p><p>Accepted inputs: {selected.inputVariants.join(', ')}</p></>:selected.kind==='kanji'?<><h2>{selected.meanings.join('; ')}</h2><p>Teaching position {selected.teachingOrder} · Frequency rank {selected.frequencyRank} · {selected.strokeCount} strokes</p><h3>Readings through words</h3>{s.content.readingsFor(selected.glyph).map(r=><p key={r.id}><span lang="ja">{r.reading}</span> ({r.type}) — {r.exampleVocab.map(id=>s.content.vocab().find(v=>v.id===id)).filter(v=>!!v).map(v=>`${v.spelling} (${v.reading}): ${v.meaning}`).join('; ')}{r.notes&&` · ${r.notes}`}</p>)}{!selected.readings.length&&<p>No verified word-linked reading is available yet. Recognition and writing do not imply a universal pronunciation.</p>}<h3>Recurring components</h3>{selected.components.map(id=>{const c=s.content.component(id);return c?<p key={id}><span className="jp" lang="ja">{c.glyph}</span> · {c.glosses.join('; ')||'Shape component'}{c.meaningIsUnreliable?' · Meaning contribution is unreliable.':''}{c.roles.includes('standalone')?' · Also occurs as a standalone kanji.':''}</p>:null;})}<p>Dictionary indexing radical: {selected.radical?s.content.component(selected.radical)?.glyph??'not available':'not specified'}. A recurring shape need not be the dictionary radical and has no universal meaning or reading.</p>{selected.mnemonic&&<p>{selected.mnemonic.kind==='memory-aid'?'Memory aid (not etymology)':'Documented origin'}: {selected.mnemonic.text}</p>}</>:<><h2><span lang="ja">{selected.reading}</span> · {selected.meaning}</h2><p>{selected.romaji} · {selected.partOfSpeech.join(', ')}</p><p>{unpracticedPrerequisites(selected,skills).length ? `Not yet practiced: ${unpracticedPrerequisites(selected,skills).map(id=>s.content.character(id)?.glyph??id).join(' · ')}. Normal lessons introduce prerequisite characters first; focused practice lets you explore this word now.`:'All prerequisite characters have practice records; this does not imply mastery.'}</p><p>Source: {selected.source}</p></>}
      {selected.kind!=='vocab'&&selected.printVsHandwritten&&<p>{selected.printVsHandwritten}</p>}
      {hasAudio(selected)?<Button onClick={()=>play(selected)}>Play recording</Button>:<p>No recording available for this entry.</p>}
      {reference?<><label><input type="checkbox" checked={trace} onChange={e=>setTrace(e.target.checked)}/> Show trace guide</label><Writing key={selected.id} reference={reference} strokes={strokes} guides={trace} onChange={setStrokes}/><p>Revision drawing is ungraded. Use focused practice for local assessment.</p></>:selected.kind!=='vocab'&&<p>No single-glyph writing reference for this entry.</p>}
      {selected.kind!=='vocab'&&<p>Common confusions: {selected.confusableWith.map(id=>s.content.character(id)?.glyph).filter(Boolean).join(' · ')||'None listed'}</p>}
      {selected.kind!=='vocab'&&words.length>0&&<><h3>Example vocabulary</h3>{words.slice(0,12).map(w=><Button key={w.id} onClick={()=>setSelected(w)}><span lang="ja">{w.spelling} ({w.reading})</span> · {w.meaning}</Button>)}</>}
      <h3>Progress by skill</h3>{SKILLS.map(sk=>{const p=entryProgress(selected,sk,skills);return <p key={sk}>{SKILL_LABELS[sk]}: {LEARNING_STAGE_MARK[p.stage]} {LEARNING_STAGE_LABELS[p.stage]}{p.due?' · Due for review':''}</p>;})}
      {selected.kind==='kanji'&&<><p>Reading recall summarizes the weakest taught reading, including readings not yet practiced.</p>{s.content.readingsFor(selected.glyph).map(r=>{const state=skills.find(x=>String(x.itemId)===selected.id&&x.skill==='readingRecall'&&x.readingId===r.id);return <p key={r.id}><span lang="ja">{r.exampleVocab.map(id=>s.content.vocab().find(v=>v.id===id)?.spelling).filter(Boolean).join(', ')} ({r.reading})</span>: {LEARNING_STAGE_LABELS[state?.stage??'unseen']}</p>;})}</>}
      <Button variant="primary" disabled={busy} onClick={()=>focus(selected.id as unknown as ItemId)}>Practice this {selected.kind==='vocab'?'word':'character'}</Button><p>Focused recognition provides weaker evidence because the target is already known.</p>
      <details><summary>Recent review history ({history.length})</summary>{history.length?history.map(a=><p key={a.id}>{new Date(a.at).toLocaleString()} · {SKILL_LABELS[a.skill]} · {a.outcome} · {a.attemptOrdinal===0?'First attempt':'Correction'}{a.focusedPractice?' · Focused':''}{a.hintsUsed.length?' · Assisted':''}{a.readingId?` · ${s.content.reading(a.readingId)?.reading??a.readingId}`:''}</p>):<p>No recorded attempts.</p>}</details>
    </Card>}
    <p role="status">{filtered.length} matching entries{paginated&&filtered.length?` · Showing ${page*pageSize+1}–${Math.min((page+1)*pageSize,filtered.length)}`:''}</p>
    {groups.map(group=><section key={group}><h2 className="group-title">{group.replaceAll('-',' ')}</h2><div className="character-grid" style={view==='vocabulary'?{gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))'}:undefined}>{visible.filter(e=>groupFor(e)===group).map(e=>{const p=entryProgress(e,skill,skills);const label=e.kind==='vocab'?e.spelling:e.glyph;const subtitle=e.kind==='kana'?e.romaji:e.kind==='kanji'?e.meanings[0]:e.reading;return <button key={e.id} className={`character stage-${p.stage}`} onClick={()=>setSelected(e)} aria-label={`${label}, ${subtitle}, ${LEARNING_STAGE_LABELS[p.stage]}${p.due?', due for review':''}`}><span className="jp" lang="ja" style={{overflowWrap:'anywhere',maxWidth:'100%'}}>{label}</span><small>{subtitle}</small><small>{LEARNING_STAGE_MARK[p.stage]} {LEARNING_STAGE_LABELS[p.stage]}</small>{p.due&&<small>↻ Due</small>}</button>;})}</div></section>)}
    {paginated&&<div className="actions"><Button disabled={page===0} onClick={()=>setPage(page-1)}>Previous entries</Button><Button disabled={(page+1)*pageSize>=filtered.length} onClick={()=>setPage(page+1)}>Next entries</Button></div>}
  </>;
}
