import { useEffect, useRef, useState } from 'react';
import type { DailyRecord, ItemId, KanaCharacter, SessionState, Settings, SkillState } from '@/domain';
import { localDateIn, resolveTimeZone } from '@/domain';
import type { BackupFile, ImportPlan } from '@/persistence/ports';
import { createServices, type Services } from './services';
import { RouterProvider, useRouter, Link } from './router';
import { ThemeProvider } from './theme';
import { Shell } from './Shell';
import { Button, Card } from '@/ui/primitives';
import { Exercise } from '@/features/practice/Exercise';
import { SCIENCE_REFERENCES, formatCitation } from '@/features/about/references.data';
import { CONTENT_SOURCES } from '@/features/about/sources.data';
import { serviceWorker } from './swState';
import { ContentUpdates } from './ContentUpdates';
import { UpdateNotice } from './UpdateNotice';
import { ProgressPage } from '@/features/progress/ProgressPage';
import { RemindersSettings, ReminderNotice } from '@/features/reminders/Reminders';
import { CharactersPage } from '@/features/characters/CharactersPage';
import { InkFlourish } from './InkFlourish';
import { chimeComplete } from '@/audio/chime';

const message = (e: unknown) => e instanceof Error ? e.message : String(e);
const title = { practice: 'Practice', characters: 'Characters', progress: 'Progress', settings: 'Settings', about: 'About & Science' };

/**
 * The glyph shown on the practice home screen. Real and current rather than a
 * fixed placeholder: whatever is actually due for review comes first (it is
 * the truest answer to "what should I practise"), then the next character the
 * learner has not started yet in teaching order, so the home screen reflects
 * this learner's own progress instead of always showing あ regardless of how
 * far they've come.
 */
function pickHeroGlyph(s: Services, skills: SkillState[]): string {
  const now = new Date().toISOString();
  const kana = [...s.content.kana('hiragana'), ...s.content.kana('katakana')];
  const dueIds = new Set(skills.filter(k => k.dueAt !== null && k.dueAt <= now && k.stage !== 'unseen').map(k => String(k.itemId)));
  const due = kana.find(c => dueIds.has(String(c.id)));
  if (due) return due.glyph;
  const startedIds = new Set(skills.filter(k => k.stage !== 'unseen').map(k => String(k.itemId)));
  const next = [...kana].sort((a, b) => a.teachingOrder - b.teachingOrder).find(c => !startedIds.has(String(c.id)));
  return next?.glyph ?? 'あ';
}

/** A specific, honest account of what a just-finished session covered — not generic praise. */
function summarizeSession(session: SessionState, s: Services): { correct: number; total: number; glyphs: string[]; perfect: boolean } {
  const screens = session.series.flatMap(series => series.screens);
  const correct = screens.filter(sc => sc.result?.grade.outcome === 'correct').length;
  const glyphs = [...new Set(screens.map(sc => s.content.character(sc.question.targetItemId)?.glyph).filter((g): g is string => Boolean(g)))];
  // Right, unaided, first try, on every single screen — not merely "all
  // correct" (a guided correction after a miss still counts as a miss here).
  const perfect = screens.length > 0 && screens.every(sc => sc.result?.grade.unaidedFirstAttempt === true);
  return { correct, total: screens.length, glyphs, perfect };
}

/** Consecutive correct screens ending at the most recently answered one, across the whole session. */
export function currentStreak(session: SessionState | undefined): number {
  if (!session) return 0;
  const screens = session.series.flatMap(series => series.screens).filter(sc => sc.result);
  let streak = 0;
  for (let i = screens.length - 1; i >= 0; i -= 1) {
    if (screens[i]!.result!.grade.outcome !== 'correct') break;
    streak += 1;
  }
  return streak;
}

export function addDays(localDate: string, delta: number): string {
  const [y, m, d] = localDate.split('-').map(Number);
  const date = new Date(y!, m! - 1, d! + delta);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Consecutive calendar days with any completed practice, counting back from today (or yesterday, if today hasn't happened yet). */
export function dailyStreak(daily: DailyRecord[], today: string): number {
  const practiced = new Set(daily.filter(d => d.xp > 0).map(d => d.localDate));
  let cursor = practiced.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (practiced.has(cursor)) { streak += 1; cursor = addDays(cursor, -1); }
  return streak;
}
let boot: ReturnType<typeof createServices> | undefined;
export function App() {
  const [services, setServices] = useState<Services>(); const [error,setError] = useState('');
  useEffect(() => { boot ??= createServices(); void boot.then(setServices).catch(e => setError(message(e))); }, []);
  if (error) return <main className="welcome"><h1>Kansei couldn’t open</h1><p role="alert">{error}</p><p>Local storage and a secure connection (HTTPS or localhost) are required. Your progress has not been reset.</p><Button onClick={() => location.reload()}>Try again</Button></main>;
  if (!services) return <main className="welcome" role="status"><div className="seal-large">感</div><InkFlourish/><h1>Opening your notebook…</h1><p>Checking local content and progress.</p></main>;
  return <RouterProvider><Workspace services={services} /></RouterProvider>;
}
function Workspace({services:s}:{services:Services}) {
  const {route,navigate}=useRouter();
  const [resumed,setResumed]=useState(false);
  const [settings,setSettings]=useState(s.settings); const [session,setSession]=useState<SessionState>();
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [install,setInstall]=useState('');
  const [installed,setInstalled]=useState(s.content.kana('hiragana').length>0);
  const [ready,setReady]=useState(false); const [offline,setOffline]=useState(!navigator.onLine);
  const [sw,setSw]=useState(serviceWorker.getState());
  const [stats,setStats]=useState<{xp:number;total:number;due:number;skills:SkillState[];daily:DailyRecord[];sessions:SessionState[]}>({xp:0,total:0,due:0,skills:[],daily:[],sessions:[]});
  const [intro,setIntro]=useState(false);
  const [placementOffer,setPlacementOffer]=useState(false);
  const onboardingDone=Boolean(settings.onboardingCompletedAt);
  async function refresh() {
    const today=localDateIn(new Date(),resolveTimeZone());
    const data=await s.db.transact('readonly',async tx=>({xp:await tx.xp.totalForDate(today),total:await tx.xp.total(),due:(await tx.skills.due(new Date().toISOString())).length,skills:await tx.skills.all(),daily:await tx.daily.all(),sessions:await tx.sessions.recent(100)}));
    setStats(data);setReady((await s.installer.readiness()).ready);
  }
  useEffect(()=>{void s.engine.resume().then(x=>{setSession(x);setResumed(true);}).catch(e=>setError(message(e)));void refresh().catch(e=>setError(message(e)));return serviceWorker.subscribe(setSw);},[s]);
  useEffect(()=>{const update=()=>setOffline(!navigator.onLine);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};},[]);
  useEffect(()=>{if(sw.controlled)void refresh().catch(e=>setError(message(e)));},[sw.controlled]);
  const chimedSession=useRef<string|null>(null);
  useEffect(()=>{
    if(session?.status!=='completed'||chimedSession.current===session.id)return;
    chimedSession.current=session.id;
    if(!settings.silentPractice&&settings.playChimes!==false)chimeComplete();
  },[session,settings.silentPractice,settings.playChimes]);
  async function act(fn:()=>Promise<void>, propagate = false) {if(busy||serviceWorker.getState().applying)return;setBusy(true);setError('');try{await fn();await refresh();}catch(e){setError(message(e));if(propagate)throw e;}finally{setBusy(false);}}
  async function save(next:Settings){await s.saveSettings(next);setSettings({...next});}
  const run=(fn:()=>Promise<void>)=>{void act(fn);};
  async function installPacks() {
    for(const pack of s.index.packs){const status=await s.installer.install(pack.id,p=>setInstall(`${pack.title}: ${p.filesDone}/${p.filesTotal} files · ${(p.bytesDone/1e6).toFixed(1)} MB`));if(status.status!=='installed')throw new Error(status.failures.map(f=>`${f.path}: ${f.reason}`).join('\n')||'Installation paused. Try again to resume.');}
    await s.reloadContent();setInstalled(true);setInstall('Content verified.');
    // Onboarding is not marked complete yet: the learner still gets to choose
    // between starting fresh and an optional placement check (see below).
    setPlacementOffer(true);
  }
  async function finishOnboarding(){await save({...settings,onboardingCompletedAt:new Date().toISOString()});setPlacementOffer(false);}
  async function start(id?:ItemId){const state=await s.engine.start({kind:id?'focused':settings.seriesPerSession>1?'linked':'standard',seriesCount:settings.seriesPerSession,focusItemId:id,now:new Date()});setSession(structuredClone(state));setIntro(!id&&state.series[0]?.cursor===0&&!state.series[0]?.screens[0]?.result);navigate('/practice');}
  async function startPlacement(){const state=await s.engine.start({kind:'placement',seriesCount:1,now:new Date()});setSession(structuredClone(state));setPlacementOffer(false);navigate('/practice');}
  const series=session?.series[session.activeSeriesIndex];const screen=series?.screens[series.cursor];
  const today=localDateIn(new Date(),resolveTimeZone());const goal=stats.daily.find(d=>d.localDate===today)?.goalXp??settings.dailyGoalXp;
  return <ThemeProvider theme={settings.theme} motion={settings.reducedMotion} jpScale={settings.japaneseTextScale} onChange={p=>run(()=>save({...settings,theme:p.theme??settings.theme,reducedMotion:p.motion??settings.reducedMotion,japaneseTextScale:p.jpScale??settings.japaneseTextScale}))}>
    <Shell title={title[route.section]} xp={{today:stats.xp,goal}} dueCount={stats.due} offline={offline}>
      <UpdateNotice updater={serviceWorker} state={sw} active={!resumed||session?.status==='active'} busy={busy} settings={route.section==='settings'}/>
      {installed&&onboardingDone&&<ContentUpdates services={s} active={!resumed||session?.status==='active'} busy={busy||sw.applying} settings={route.section==='settings'} run={run}/>}
      {error&&<div className="notice error" role="alert"><p>{error}</p><Button onClick={()=>setError('')}>Dismiss</Button></div>}
      {!installed?<div className="stack welcome"><p className="eyebrow">A little practice, every day</p><div className="seal-large">感</div><h1>Your Japanese notebook.</h1><p>Learn to recognise, read and write kana. Ten focused questions. Your progress stays on this device.</p><Card><h2>Make it yours</h2><label className="field">Daily goal (XP)<input type="number" min="1" max="10000" value={settings.dailyGoalXp} onChange={e=>setSettings({...settings,dailyGoalXp:Math.max(1,Number(e.target.value)||20)})}/></label><label className="field">Start with<select value={settings.activeScripts[0]} onChange={e=>setSettings({...settings,activeScripts:[e.target.value as 'hiragana'|'katakana']})}><option value="hiragana">Hiragana</option><option value="katakana">Katakana</option></select></label><label><input type="checkbox" checked={settings.keyboardOnlyMode} onChange={e=>setSettings({...settings,keyboardOnlyMode:e.target.checked})}/> Keyboard-only practice (no handwriting)</label><label><input type="checkbox" checked={settings.silentPractice} onChange={e=>setSettings({...settings,silentPractice:e.target.checked})}/> Silent practice</label><label><input type="checkbox" checked={settings.activeScripts.includes('kanji')} onChange={e=>setSettings({...settings,activeScripts:e.target.checked?[...settings.activeScripts,'kanji']:settings.activeScripts.filter(x=>x!=='kanji')})}/> Also include kanji &amp; vocabulary (draft content, not yet reviewed)</label></Card><Card className="notebook-lines"><h2>Bring your lessons on board</h2><p>{(s.index.packs.reduce((n,p)=>n+p.totalBytes,0)/1e6).toFixed(1)} MB · 268 kana entries · 1,500 kanji · 1,600 draft vocabulary entries.</p><p>Everything below is checked and stored on this device, so practice keeps working with no connection at all. Yōon audio and most vocabulary recordings are unavailable. Kanji and vocabulary are generated from dictionary sources and have not had a native-Japanese editorial pass — worth trying, but expect the occasional rough edge.</p>{busy&&<InkFlourish/>}<Button variant="primary" disabled={busy} onClick={()=>run(installPacks)}>{busy?'Getting everything ready…':'Install and begin'}</Button><p role="status">{install}</p></Card></div>:!onboardingDone&&placementOffer?<div className="stack welcome"><p className="eyebrow">One more thing</p><h1>Already know some kana?</h1><p>An optional ten-question check can recognise hiragana and katakana you already know, so early practice does not repeat what you have. It checks recognition only, choosing among four options on screen — it does not test reading recall, listening, or handwriting, and those always start fresh as you practice regardless of this result.</p><div className="actions"><Button variant="primary" disabled={busy} onClick={()=>run(finishOnboarding)}>Start as a beginner</Button><Button disabled={busy} onClick={()=>run(startPlacement)}>Quick placement check</Button></div></div>:!onboardingDone&&session?.kind==='placement'&&session.status==='completed'?<div className="stack welcome"><p className="eyebrow">Placement check</p><h1>Placement check complete.</h1><p>{`You recognised ${session.series[0]!.screens.filter(sc=>sc.result?.grade.outcome==='correct').length} of ${session.series[0]!.screens.length} characters shown with four options on screen.`}</p><p>This checked recognition only. Reading recall, listening and handwriting are not assessed by it and start fresh as you practice — a correct answer here does not carry over to those.</p><Button variant="primary" disabled={busy} onClick={()=>run(async()=>{await finishOnboarding();setSession(undefined);})}>Continue</Button></div>:
      <div className="stack">
      {session?.status!=='active'&&<ReminderNotice settings={settings} dailyXp={stats.xp} lastCompletedAt={stats.sessions.flatMap(x=>x.series.map(y=>y.completedAt)).filter((x):x is string=>Boolean(x)).sort().at(-1)??null} onChange={save}/>}
      {route.section==='practice'&&<>
        {session?.status==='active'&&screen&&series?<><div className="practice-head"><span>Series {session.activeSeriesIndex+1} of {session.seriesCount??1}</span><span>Question {series.cursor+1} / 10{settings.showStreak!==false&&currentStreak(session)>=3&&<span className="streak-chip">{currentStreak(session)} in a row</span>}</span><Button disabled={busy} onClick={()=>run(async()=>{const wasPlacement=session?.kind==='placement';await s.engine.abandon(new Date());setSession(undefined);if(wasPlacement&&!settings.onboardingCompletedAt)await finishOnboarding();})}>End session</Button></div><progress aria-label="Session progress" value={series.cursor} max={10}/>
          {intro?<Card padding="lg"><p className="eyebrow">Meet this group</p><h2>Look, listen, then try from memory.</h2><div className="intro-grid">{[...new Set(series.screens.map(x=>x.question.targetItemId))].map(id=>s.content.character(id)).filter((c):c is KanaCharacter=>c?.kind==='kana').map(c=><div key={c.id}><div className="prompt jp" lang="ja">{c.glyph}</div><p>{c.romaji}</p>{s.content.audio(c.id)&&<Button onClick={()=>run(()=>s.audio.play(s.content.audio(c.id)!))}>Listen to {c.romaji}</Button>}<p>{c.note}</p></div>)}</div><Button variant="primary" onClick={()=>setIntro(false)}>Start questions</Button></Card>:
          <Exercise key={screen.question.id} question={screen.question} result={screen.result?.grade??null} retryResult={screen.retries.at(-1)?.grade??null} services={s} busy={busy} onSubmit={a=>act(async()=>{await s.engine.submit(a,new Date());setSession(structuredClone((await s.engine.resume())!));},true)} onRetry={a=>act(async()=>{await s.engine.submitRetry(a,new Date());setSession(structuredClone((await s.engine.resume())!));},true)} onAdvance={()=>act(async()=>{const x=await s.engine.advance(new Date());setSession(structuredClone(x.state));})}/>}</>:
          <>{(() => {
            const justFinished = session?.status === 'completed' ? summarizeSession(session, s) : null;
            const heroGlyph = pickHeroGlyph(s, stats.skills);
            return <Card padding="lg" className="hero notebook-lines">
              <p className="eyebrow">{justFinished ? (justFinished.perfect?'Perfect':'Nice work') : 'A little at a time'}</p>
              <h1>{justFinished ? `${justFinished.correct} of ${justFinished.total}, first try.` : (stats.due ? `${stats.due} ready for another look.` : 'Ready when you are.')}</h1>
              {justFinished
                ? <><p>You practised {justFinished.glyphs.length} character{justFinished.glyphs.length===1?'':'s'} just now — here they are.{justFinished.perfect&&<span className="streak-chip"> every one, unaided</span>}</p><div className="practiced-chips" aria-hidden="true">{justFinished.glyphs.map(g=><span key={g} className="practiced-chip jp" lang="ja">{g}</span>)}</div></>
                : <p>{stats.due?'A quick review keeps it fresh.':'Every question adds a little more familiarity.'} Ten questions, about five minutes, 20 XP.</p>}
              {justFinished
                ? <div key={`${session!.id}-stamp`} className="seal-stamp" aria-hidden="true">感</div>
                : <div className="hero-glyph jp" lang="ja">{heroGlyph}</div>}
              <Button size="lg" variant="primary" disabled={busy} onClick={()=>run(()=>start())}>{justFinished ? 'Keep going' : 'Begin practice'}</Button>
            </Card>;
          })()}<div className="two-col"><Card><h2>{stats.xp} / {goal} XP today</h2><progress aria-label="Daily XP" value={stats.xp} max={Math.max(goal,stats.xp)}/><p>{stats.xp>=goal?'Today’s goal is done — anything more is a bonus.':'XP records practice, not mastery.'}{settings.showStreak!==false&&dailyStreak(stats.daily,today)>=2&&` ${dailyStreak(stats.daily,today)} day streak.`}</p></Card><Card><h2>Your notebook is local</h2><p>{ready?'Ready offline for installed content. Audio coverage is incomplete.':'Offline readiness is not confirmed. Verify content installation in Settings.'}</p><Link to="/characters">Explore your characters →</Link></Card></div></>}
      </>}
      {route.section==='characters'&&<CharactersPage services={s} skills={stats.skills} busy={busy} focus={id=>run(()=>start(id))}/>}
      {route.section==='progress'&&<ProgressPage services={s}/>}
      {route.section==='settings'&&<SettingsPage services={s} settings={settings} save={next=>run(()=>save(next))} busy={busy} run={run} ready={ready} install={install} installPacks={installPacks}/>}
      {route.section==='about'&&<About services={s}/>}
      </div>}
      {session?.status!=='active'&&<footer className="footnote">Kansei · local by default · Kana practice preview. Draft kanji/vocabulary packs included; course integration pending.</footer>}
    </Shell>
  </ThemeProvider>;
}
function SettingsPage({services:s,settings,save,busy,run,ready,install,installPacks}:{services:Services;settings:Settings;save:(s:Settings)=>void;busy:boolean;run:(f:()=>Promise<void>)=>void;ready:boolean;install:string;installPacks:()=>Promise<void>}) {
  const [storage,setStorage]=useState('');const [file,setFile]=useState<BackupFile>();const [plan,setPlan]=useState<ImportPlan>();const [mode,setMode]=useState<'merge'|'replace'>('merge');
  function download(name:string,body:string,type='application/json'){const url=URL.createObjectURL(new Blob([body],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  return <><h1>Set things up your way.</h1><Card className="stack"><h2>Preferences</h2><label className="field">Theme<select value={settings.theme} onChange={e=>save({...settings,theme:e.target.value as Settings['theme']})}><option value="system">Follow system</option><option value="light">Light</option><option value="dark">Dark</option></select></label><label className="field">Daily XP goal<input type="number" min="1" value={settings.dailyGoalXp} onChange={e=>save({...settings,dailyGoalXp:Math.max(1,Number(e.target.value)||20)})}/></label><label className="field">Series per round<select value={settings.seriesPerSession} onChange={e=>save({...settings,seriesPerSession:Number(e.target.value) as 1|2|3})}>{[1,2,3].map(x=><option key={x} value={x}>{x} series ({x*10} questions)</option>)}</select></label>{(['hiragana','katakana','kanji'] as const).map(script=><label key={script}><input type="checkbox" checked={settings.activeScripts.includes(script)} onChange={e=>save({...settings,activeScripts:e.target.checked?[...settings.activeScripts,script]:settings.activeScripts.filter(x=>x!==script)})}/>{script==='hiragana'?'Hiragana':script==='katakana'?'Katakana':'Kanji & vocabulary (draft, not yet reviewed)'}</label>)}{(['silentPractice','keyboardOnlyMode','includeExtended','includeHistorical','playChimes','showStreak'] as const).map(key=><label key={key}><input type="checkbox" checked={settings[key]} onChange={e=>save({...settings,[key]:e.target.checked})}/>{({silentPractice:'Silent practice',keyboardOnlyMode:'Keyboard-only practice',includeExtended:'Include extended forms',includeHistorical:'Include historical forms (outside beginner path)',playChimes:'Chimes on a graded answer and on finishing a session',showStreak:'Show streaks'})[key]}</label>)}<label className="field">Motion<select value={settings.reducedMotion} onChange={e=>save({...settings,reducedMotion:e.target.value as Settings['reducedMotion']})}><option value="system">Follow system</option><option value="always">Reduce motion</option><option value="never">Allow motion</option></select></label></Card>
  <Card className="stack"><h2>Offline content</h2><p>{ready?'Ready offline: installed content. Audio coverage is incomplete.':'Offline readiness not yet confirmed. Development mode does not cache the app shell.'}</p>{s.index.packs.map(p=><p key={p.id}>{p.title} · {(p.totalBytes/1e6).toFixed(2)} MB · {p.description}</p>)}<Button disabled={busy} onClick={()=>run(installPacks)}>Verify / resume installation</Button><p role="status">{install}</p><p>Browser data can be cleared. Keep a backup; there is no automatic cross-device sync.</p><Button onClick={()=>run(async()=>{const e=await s.db.estimate();setStorage(`${((e.usageBytes??0)/1e6).toFixed(1)} MB used; ${e.quotaBytes===null?'quota unavailable':(e.quotaBytes/1e6).toFixed(0)+' MB quota'}`);})}>Check storage usage</Button><Button onClick={()=>run(async()=>{const x=await s.db.requestPersistence();setStorage(!x.supported?'Persistent storage is unsupported.':x.persisted?'Persistent storage granted. Backups are still recommended.':'Persistent storage was not granted.');})}>Request persistent storage</Button><p role="status">{storage}</p></Card>
  <Card className="stack"><h2>Transfer your progress</h2><Button onClick={()=>run(async()=>download('kansei-backup.json',JSON.stringify(await s.backup.export())))}>Export backup</Button><label className="field">Import behavior<select value={mode} onChange={e=>{setMode(e.target.value as typeof mode);setPlan(undefined);}}><option value="merge">Merge with local progress</option><option value="replace">Replace local progress</option></select></label><label className="field">Choose backup<input type="file" accept=".json,application/json" onChange={e=>{const f=e.target.files?.[0];if(f)run(async()=>{const x=JSON.parse(await f.text()) as BackupFile;setFile(x);setPlan(await s.backup.plan(x,mode));});}}/></label>{plan&&<><p>{plan.valid?'Backup validated. Review before importing.':'Invalid backup'}</p>{plan.errors.map(x=><p key={x} role="alert">{x}</p>)}{plan.warnings.map(x=><p key={x}>{x}</p>)}{plan.effects.map(x=><p key={x.store}>{x.store}: add {x.adding}, update {x.updating}, remove {x.removing}</p>)}<Button disabled={busy||!plan.valid} variant="primary" onClick={()=>run(async()=>{if(file){await s.backup.apply(file,plan);location.reload();}})}>Apply {mode} import</Button></>}</Card><RemindersSettings settings={settings} onChange={save}/></>;
}
function About({services:s}:{services:Services}) {
  return <><header><p className="eyebrow">A considered practice</p><h1>About & Science</h1><p>The explanations here remain available offline. Source links need internet.</p></header><Card className="stack"><h2>How learning works here</h2><p>Retrieving an answer from memory and revisiting it over time are supported learning principles. Corrective feedback helps distinguish a right answer from an attractive distractor.</p><p>Recognition is weaker evidence than unaided recall. Each character has separate recognition, reading, listening and handwriting records. Components and words give kanji context; component glosses are not universal meanings or pronunciations.</p><p>Ten-question series, the 1 XP per screen plus 10 XP completion bonus, and the 6/2/2 selection mix are product choices. XP measures practice, not mastery. FSRS scheduler settings are not universally optimal. Gamification research does not establish that XP alone improves learning.</p><p>Interleaving depends on material and context. Handwriting findings do not prove effectiveness for finger-based Japanese practice. Kansei has not been experimentally or clinically validated. Its handwriting tests use synthetic samples, not representative human recordings.</p><p>Kana practice is the polished path. Kanji and vocabulary practice can be switched on in Settings, but that curriculum is generated from dictionary sources and has not had a native-Japanese editorial pass — expect the occasional rough edge. Placement checks recognise known kana only; there is no kanji placement check yet. Romanization uses Hepburn display with documented alternative inputs; IME usage is tracked separately from recall.</p></Card>{SCIENCE_REFERENCES.map(r=><Card key={r.id} className="stack"><p className="eyebrow">{r.claimTier.replaceAll('-',' ')}</p><h2>{r.title}</h2><p>{formatCitation(r)}</p><p>{r.summary}</p><p><strong>In Kansei:</strong> {r.informsFeature}</p><p><strong>Limitations:</strong> {r.limitations}</p>{r.unverifiedDetails.map(x=><p key={x}>{x}</p>)}<a href={r.url} target="_blank" rel="noreferrer">Read source · {r.doi}</a></Card>)}<h2>Teaching and content sources</h2>{CONTENT_SOURCES.map(x=><Card key={x.id}><h3><a href={x.url} target="_blank" rel="noreferrer">{x.name}</a></h3><p>{x.whatItProvides}</p><p>{x.howKanseiUsesIt}</p><p>{x.licence}</p></Card>)}<Card><h2>Bundled assets</h2><p>Noto Sans JP, Noto Serif JP and Klee One: SIL Open Font License 1.1. Kana stroke paths: KanjiVG, Ulrich Apel and contributors, CC BY-SA 3.0.</p><details><summary>Recording and content credits</summary>{s.index.packs.flatMap(p=>p.attributions).map((a,i)=><p key={i}><a href={a.url} target="_blank" rel="noreferrer">{a.asset}</a> · {a.source} · {a.license}</p>)}</details></Card></>;
}
