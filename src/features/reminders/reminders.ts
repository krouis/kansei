import type { ReminderPreferences } from '@/domain';

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
export function validTime(time: string): boolean { return /^([01]\d|2[0-3]):[0-5]\d$/.test(time); }
export function localClock(now: Date, timeZone?: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23', weekday:'short' }).formatToParts(now);
  const get=(type: string)=>parts.find(x=>x.type===type)?.value??'';
  return {date:`${get('year')}-${get('month')}-${get('day')}`, time:`${get('hour')}:${get('minute')}`, weekday:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(get('weekday'))};
}
export function isQuiet(time:string, quiet:ReminderPreferences['quietHours']):boolean {
  if(!quiet||!validTime(quiet.start)||!validTime(quiet.end))return false;
  if(quiet.start===quiet.end)return true;
  return quiet.start<quiet.end ? time>=quiet.start&&time<quiet.end : time>=quiet.start||time<quiet.end;
}
/** Due reminders are evaluated only while the application is open. Keys use local
 * dates so the repeated autumn DST hour cannot produce duplicate reminders. */
export function dueReminders(p:ReminderPreferences, now:Date, dailyXp:number, goal:number, lastCompletedAt:string|null, timeZone?:string):Array<{key:string;message:string}> {
  if(!p.enabled||(p.pausedUntil&&new Date(p.pausedUntil)>now)||(p.skipWhenGoalMet&&dailyXp>=goal))return [];
  const local=localClock(now,timeZone);
  if(isQuiet(local.time,p.quietHours))return [];
  const due:Array<{key:string;message:string}>=[];
  if(p.weekdays.includes(local.weekday))for(const time of [...new Set(p.times)].sort()) {
    if(validTime(time)&&local.time>=time)due.push({key:`scheduled:${local.date}:${time}`,message:'A little Japanese practice is ready when you are.'});
  }
  if(p.afterLastSeries&&lastCompletedAt&&now.getTime()-Date.parse(lastCompletedAt)>=86400000)due.push({key:`after:${lastCompletedAt}`,message:'It has been about a day since your last series. Ready to revisit a few characters?'});
  return due;
}

/** Floating calendar times intentionally retain wall-clock times across DST.
 * Calendar applications determine timezone interpretation on import. */
export function reminderCalendar(p:ReminderPreferences, now=new Date()):string {
  const days=[...new Set(p.weekdays)].filter(d=>d>=0&&d<7).sort().map(d=>DAYS[d]);
  const times=[...new Set(p.times)].filter(validTime).sort();
  if(!days.length||!times.length)throw new Error('Choose at least one weekday and time before exporting.');
  const stamp=now.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  const events=times.flatMap(time=>{
    const first=new Date(now);first.setHours(Number(time.slice(0,2)),Number(time.slice(3)),0,0);
    for(let n=0;n<8&&(first<now||!p.weekdays.includes(first.getDay()));n++)first.setDate(first.getDate()+1);
    const date=`${first.getFullYear()}${String(first.getMonth()+1).padStart(2,'0')}${String(first.getDate()).padStart(2,'0')}`;
    return ['BEGIN:VEVENT',`UID:kansei-${time.replace(':','')}-${days.join('')}@local`,`DTSTAMP:${stamp}`,`DTSTART:${date}T${time.replace(':','')}00`,`RRULE:FREQ=WEEKLY;BYDAY=${days.join(',')}`,'DURATION:PT10M','SUMMARY:Japanese practice with Kansei','DESCRIPTION:Open Kansei to practise. This calendar does not know your progress.','BEGIN:VALARM','TRIGGER:PT0S','ACTION:DISPLAY','DESCRIPTION:Time for Japanese practice','END:VALARM','END:VEVENT'];
  });
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Kansei//Local reminders//EN','CALSCALE:GREGORIAN',...events,'END:VCALENDAR',''].join('\r\n');
}
