import {useEffect,useState} from 'react';
import type {Services} from '@/app/services';
import {localDateIn,resolveTimeZone,addDays} from '@/domain';
import type {AttemptRecord,ConfusionRecord,DailyRecord,SessionState,SkillState} from '@/domain';
import {Card,Button} from '@/ui/primitives';
import {DailyXpChart,PracticeCalendar,HBarList,TrendLine} from './charts';
import {accuracyRows,delayedRecall,practiceSummary,retainedBySkill} from './summary';
interface Data {days:DailyRecord[];attempts:AttemptRecord[];skills:SkillState[];sessions:SessionState[];confusions:ConfusionRecord[];due:number;total:number;ime:number;imeCorrect:number}
export function ProgressPage({services:s}:{services:Services}){
 const [data,setData]=useState<Data>();const [error,setError]=useState('');const [revision,setRevision]=useState(0);
 useEffect(()=>{let live=true;void s.db.transact('readonly',async tx=>{const aux=await tx.auxiliary.get();return {days:await tx.daily.all(),attempts:await tx.attempts.betweenDates('0000-01-01','9999-12-31'),skills:await tx.skills.all(),sessions:await tx.sessions.recent(100),confusions:await tx.confusions.top(10),due:(await tx.skills.due(new Date().toISOString())).length,total:await tx.xp.total(),ime:aux.imeQuestions,imeCorrect:aux.imeCorrect};}).then(d=>{if(live){setData(d);setError('');}}).catch(e=>{if(live)setError(e instanceof Error?e.message:String(e));});return()=>{live=false;};},[s,revision]);
 if(error)return <Card><h1>Progress could not load</h1><p role="alert">{error}</p><Button onClick={()=>setRevision(n=>n+1)}>Try again</Button></Card>;
 if(!data)return <p role="status">Reading your local practice history…</p>;
 const today=localDateIn(new Date(),resolveTimeZone());const summary=practiceSummary(data.days,today);
 const recorded=data.days.filter(d=>d.localDate<=today).sort((a,b)=>a.localDate.localeCompare(b.localDate));
 const chartData=recorded.filter(d=>d.localDate>=addDays(today,-29)).map(d=>({...d,goalMet:d.goalMetAt!==null}));
 const calendar=recorded.filter(d=>d.localDate>=addDays(today,-181)).map(d=>({...d,goalMet:d.goalMetAt!==null}));
 // Anchor the calendar to today without inventing goals on unrecorded days.
 if(!calendar.some(d=>d.localDate===today))calendar.push({localDate:today,xp:0,goalXp:0,goalMet:false,screensCompleted:0,seriesCompleted:0,activeMs:0,timeZone:resolveTimeZone(),goalMetAt:null});
 const characters=[...s.content.kana('hiragana'),...s.content.kana('katakana'),...s.content.kanji()];
 const retained=retainedBySkill(data.skills,new Set(characters.map(c=>c.id)));
 const vocabulary=new Set(s.content.vocab().map(v=>String(v.id)));const vocabPractised=new Set(data.skills.filter(x=>vocabulary.has(x.itemId)).map(x=>x.itemId)).size;
 const trends=delayedRecall(data.attempts);const uncertain=data.attempts.filter(a=>a.attemptOrdinal===0&&a.outcome==='uncertain').length;
 const item=(id:string)=>s.content.character(id)?.glyph??s.content.vocab().find(v=>v.id===id)?.spelling??id;
 return <div className="stack"><header><p className="eyebrow">Practice, over time</p><h1>Your progress</h1><p>Practised {summary.lastSeven} of the last seven days. XP measures practice; skills describe observed learning.</p></header>
 <div className="two-col"><Card><h2>{summary.weekXp} XP this week</h2><p>Monday through today · {summary.monthXp} XP this calendar month</p></Card><Card><h2>{data.total} XP all time</h2><p>{(summary.activeMs/60000).toFixed(1)} recorded practice minutes · {data.due} skill reviews due</p></Card></div>
 <Card>{chartData.length?<DailyXpChart data={chartData}/>:<><h2>Daily XP</h2><p>Your first completed question will appear here.</p></>}<p className="footnote">Last 30 days with recorded practice. Historical goals remain as recorded; changing today’s goal does not rewrite them.</p></Card>
 <Card><PracticeCalendar data={calendar}/><p className="footnote">Empty dates mean no recorded XP. Calendar dates stay as recorded when you practised, including after travel.</p></Card>
 <Card><h2>Characters retained by skill</h2><table><thead><tr><th scope="col">Skill</th><th scope="col">Retained</th><th scope="col">Practised</th></tr></thead><tbody>{retained.map(r=><tr key={r.skill}><th scope="row">{r.label}</th><td>{r.retained}</td><td>{r.practised}</td></tr>)}</tbody></table><p>Each character is counted once per skill. For kanji, all assessed word-specific readings must be retained; this says nothing about readings not yet assessed. These stages are estimates from spaced performance, not scientific mastery percentages.</p><p>Vocabulary: {vocabPractised} of {vocabulary.size} installed words practised. Progress in one skill does not establish another.</p></Card>
 <Card><HBarList title="First-attempt accuracy by skill" note="Correct / correct + incorrect first attempts. Retries are excluded. Aided attempts remain included; this is not a recall-only measure." data={accuracyRows(data.attempts,'skill')}/></Card>
 <Card><HBarList title="First-attempt accuracy by exercise" note={`Rates appear after five scored attempts. ${uncertain} uncertain first attempts are excluded from accuracy denominators.`} data={accuracyRows(data.attempts,'questionType')}/><p>Japanese input-method practice: {data.imeCorrect} correct of {data.ime} recorded. IME activity is tracked separately from recall.</p></Card>
 <Card><TrendLine title="Delayed, unaided recall" note="Weekly first attempts with strong evidence, no hints/reveals, no focused target, and at least 24 elapsed hours since the previous recorded exposure to that item and skill. Rates require five scored attempts per week. This observational trend does not establish effectiveness." data={trends}/><p>{trends.reduce((n,r)=>n+r.count,0)} eligible scored attempts; {trends.reduce((n,r)=>n+r.uncertain,0)} uncertain assessments excluded. Corrections reset the spacing clock. No eligible attempts yet means no estimate.</p></Card>
 <Card><h2>Frequent confusions</h2>{data.confusions.length?<ul>{data.confusions.map(c=><li key={`${c.itemId}:${c.confusedWithItemId}:${c.skill}`}><span lang="ja">{item(c.itemId)} / {item(c.confusedWithItemId)}</span> · {c.skill} · {c.count} recorded confusions</li>)}</ul>:<p>No recurring confusions recorded.</p>}</Card>
 <Card><h2>Session history</h2><p>Most recent 100 sessions. Practice time records response durations and may include idle time while a question remains open.</p>{data.sessions.length?<div className="scroll-x"><table><thead><tr><th scope="col">Started</th><th scope="col">Practice</th><th scope="col">Status</th><th scope="col">Screens</th><th scope="col">Minutes</th></tr></thead><tbody>{data.sessions.map(session=><tr key={session.id}><td>{new Date(session.startedAt).toLocaleString()}<br/><small>{session.timeZone}</small></td><td>{session.kind}</td><td>{session.status}</td><td>{session.series.flatMap(x=>x.screens).filter(x=>x.feedbackAcknowledged).length}</td><td>{(session.activeMs/60000).toFixed(1)}</td></tr>)}</tbody></table></div>:<p>Your first session will appear here.</p>}</Card>
 </div>;
}
