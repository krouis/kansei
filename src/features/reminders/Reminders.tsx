import {useEffect,useState} from 'react';
import type {Settings,ReminderPreferences} from '@/domain';
import {Button,Card} from '@/ui/primitives';
import {dueReminders,reminderCalendar,validTime} from './reminders';

type Props={settings:Settings;onChange:(settings:Settings)=>void|Promise<void>};
const errorMessage=(e:unknown)=>e instanceof Error?e.message:String(e);
export function RemindersSettings({settings,onChange}:Props){
  const p=settings.reminders;
  const [error,setError]=useState('');
  const [time,setTime]=useState('18:00');
  async function update(patch:Partial<ReminderPreferences>){try{await onChange({...settings,reminders:{...p,...patch}});setError('');}catch(e){setError(errorMessage(e));}}
  function exportCalendar(){try{const blob=new Blob([reminderCalendar(p)],{type:'text/calendar;charset=utf-8'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='kansei-reminders.ics';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setError('');}catch(e){setError(errorMessage(e));}}
  return <Card><h2>Reminders, on your terms</h2><p>In-app reminders appear while Kansei is open. A pure PWA cannot promise reliable closed-app offline notifications.</p>
    <label className="field"><span><input type="checkbox" checked={p.enabled} onChange={e=>void update({enabled:e.target.checked})}/> Show in-app reminders</span></label>
    <fieldset><legend>Weekdays</legend>{['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((day,n)=><label key={day} style={{display:'inline-block',marginRight:'1rem'}}><input type="checkbox" checked={p.weekdays.includes(n)} onChange={e=>void update({weekdays:e.target.checked?[...p.weekdays,n]:p.weekdays.filter(d=>d!==n)})}/>{day}</label>)}</fieldset>
    <label className="field">Local reminder time<input type="time" value={time} onChange={e=>setTime(e.target.value)}/></label><Button disabled={!validTime(time)||p.times.includes(time)} onClick={()=>void update({times:[...p.times,time].sort()})}>Add time</Button>
    <ul>{p.times.map(t=><li key={t}>{t} <Button aria-label={`Remove reminder at ${t}`} onClick={()=>void update({times:p.times.filter(x=>x!==t)})}>Remove</Button></li>)}</ul>
    <label className="field"><span><input type="checkbox" checked={p.afterLastSeries} onChange={e=>void update({afterLastSeries:e.target.checked})}/> Also remind me roughly 24 hours after a completed series</span></label>
    <label className="field"><span><input type="checkbox" checked={p.skipWhenGoalMet} onChange={e=>void update({skipWhenGoalMet:e.target.checked})}/> Skip in-app reminders after my daily goal</span></label>
    <label className="field"><span><input type="checkbox" checked={p.quietHours!==null} onChange={e=>void update({quietHours:e.target.checked?{start:'22:00',end:'08:00'}:null})}/> Quiet hours</span></label>
    {p.quietHours&&<div className="two-col"><label className="field">Quiet from<input type="time" value={p.quietHours.start} onChange={e=>validTime(e.target.value)&&void update({quietHours:{...p.quietHours!,start:e.target.value}})}/></label><label className="field">Until<input type="time" value={p.quietHours.end} onChange={e=>validTime(e.target.value)&&void update({quietHours:{...p.quietHours!,end:e.target.value}})}/></label></div>}
    <label className="field">Snooze (minutes)<input type="number" min="1" max="1440" value={p.snoozeMinutes} onChange={e=>void update({snoozeMinutes:Math.min(1440,Math.max(1,Number(e.target.value)||15))})}/></label>
    <p>{p.pausedUntil&&new Date(p.pausedUntil)>new Date()?`Paused until ${new Date(p.pausedUntil).toLocaleString()}`:'Reminders are not paused.'}</p><Button onClick={()=>void update({pausedUntil:new Date(Date.now()+7*86400000).toISOString()})}>Pause for a week</Button> <Button onClick={()=>void update({pausedUntil:null})}>Resume reminders</Button>
    <h3>Calendar-managed alerts</h3><p>Export chosen times and weekdays to your calendar for OS-managed reminders. The calendar does not know when you practise, meet your goal, snooze, or pause here. Quiet hours and the 24-hour option are not exported. Check the local time and alert settings when importing; manage or delete imported events in your calendar.</p><Button onClick={exportCalendar}>Export calendar reminders</Button>
    <h3>Browser notification support</h3><p>{typeof Notification==='undefined'?'This browser does not expose notification support.':`Browser permission: ${Notification.permission}. Permission alone cannot schedule reliable closed-app offline alerts. Kansei currently uses in-app and calendar reminders.`}</p>
    {error&&<p role="alert">{error}</p>}
  </Card>;
}
const acknowledged=new Set<string>();
let restored=false;
function restoreDismissals(){
  if(restored)return;restored=true;
  try{const stored:unknown=JSON.parse(localStorage.getItem('kansei-reminder-dismissals')??'[]');if(Array.isArray(stored))for(const key of stored)if(typeof key==='string')acknowledged.add(key);}catch{/* Restricted storage: reminders still work for this open app. */}
}
function dismiss(keys:string[]){
  keys.forEach(key=>acknowledged.add(key));
  // Bounded non-learning UI state; never prevents practice if storage is full.
  const recent=[...acknowledged].slice(-100);acknowledged.clear();recent.forEach(key=>acknowledged.add(key));
  try{localStorage.setItem('kansei-reminder-dismissals',JSON.stringify(recent));}catch{/* Session-local acknowledgement remains available. */}
}
export function ReminderNotice({settings,dailyXp,lastCompletedAt,onChange}:Props&{dailyXp:number;lastCompletedAt:string|null}){
  const [now,setNow]=useState(()=>new Date());const [dismissed,setDismissed]=useState(0);const [error,setError]=useState('');
  useEffect(()=>{const refresh=()=>setNow(new Date());const timer=setInterval(refresh,30000);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};},[]);
  void dismissed;restoreDismissals();
  const due=dueReminders(settings.reminders,now,dailyXp,settings.dailyGoalXp,lastCompletedAt).filter(r=>!acknowledged.has(r.key));
  if(!due.length)return null;
  async function snooze(){try{await onChange({...settings,reminders:{...settings.reminders,pausedUntil:new Date(Date.now()+settings.reminders.snoozeMinutes*60000).toISOString()}});setNow(new Date());}catch(e){setError(errorMessage(e));}}
  return <div className="notice" role="status"><p>{due.at(-1)!.message}</p><Button onClick={()=>{dismiss(due.map(r=>r.key));setDismissed(n=>n+1);}}>Dismiss</Button> <Button onClick={()=>void snooze()}>Snooze {settings.reminders.snoozeMinutes} minutes</Button>{error&&<p role="alert">{error}</p>}</div>;
}
