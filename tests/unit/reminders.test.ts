import {describe,it,expect} from 'vitest';
import {defaultSettings} from '../../src/persistence/settingsStore';
import {dueReminders,isQuiet,localClock,reminderCalendar,validTime} from '../../src/features/reminders/reminders';
const prefs=()=>({...defaultSettings().reminders,enabled:true,times:['18:00'],weekdays:[0,1,2,3,4,5,6]});
describe('local in-app reminders',()=>{
 it('validates times and overnight quiet hours',()=>{expect(validTime('24:00')).toBe(false);expect(validTime('09:30')).toBe(true);expect(isQuiet('23:00',{start:'22:00',end:'08:00'})).toBe(true);expect(isQuiet('07:59',{start:'22:00',end:'08:00'})).toBe(true);expect(isQuiet('08:00',{start:'22:00',end:'08:00'})).toBe(false);});
 it('gates disabled, goal-met, paused and quiet reminders',()=>{const now=new Date('2026-09-29T18:30:00Z');const p=prefs();expect(dueReminders(p,now,0,20,null,'UTC')).toHaveLength(1);for(const patch of [{enabled:false},{pausedUntil:'2026-09-30T00:00:00Z'},{quietHours:{start:'18:00',end:'19:00'}}])expect(dueReminders({...p,...patch},now,0,20,null,'UTC')).toHaveLength(0);expect(dueReminders(p,now,20,20,null,'UTC')).toHaveLength(0);});
 it('honors selected weekdays and local calendar date',()=>{const p={...prefs(),weekdays:[3],times:['01:00']};expect(dueReminders(p,new Date('2026-09-29T23:30:00Z'),0,20,null,'Europe/Paris')[0]?.key).toBe('scheduled:2026-09-30:01:00');});
 it('retains a local scheduled time across spring DST jump',()=>{const p={...prefs(),times:['02:30']};expect(dueReminders(p,new Date('2026-03-29T00:59:00Z'),0,20,null,'Europe/Paris')).toHaveLength(0);expect(dueReminders(p,new Date('2026-03-29T01:01:00Z'),0,20,null,'Europe/Paris')).toHaveLength(1);});
 it('uses the same occurrence key in both autumn repeated hours',()=>{const p={...prefs(),times:['02:00']};const a=dueReminders(p,new Date('2026-10-25T00:30:00Z'),0,20,null,'Europe/Paris');const b=dueReminders(p,new Date('2026-10-25T01:30:00Z'),0,20,null,'Europe/Paris');expect(a).toEqual(b);});
 it('computes the after-series reminder by elapsed hours across DST',()=>{const p={...prefs(),times:[],afterLastSeries:true};const last='2026-03-28T12:00:00Z';expect(dueReminders(p,new Date('2026-03-29T11:59:00Z'),0,20,last,'Europe/Paris')).toHaveLength(0);expect(dueReminders(p,new Date('2026-03-29T12:00:00Z'),0,20,last,'Europe/Paris')).toHaveLength(1);});
 it('reports midnight as 00 rather than 24',()=>{expect(localClock(new Date('2026-01-01T00:00:00Z'),'UTC').time).toBe('00:00');});
});
describe('calendar export',()=>{
 it('exports floating wall-clock weekly events with OS alarm and honest description',()=>{const text=reminderCalendar({...prefs(),weekdays:[1,3],times:['18:00','09:00']},new Date('2026-09-29T12:00:00Z'));expect(text).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,WE\r\n');expect(text).toContain('BEGIN:VALARM');expect(text).toContain('does not know your progress');expect(text).toMatch(/DTSTART:\d{8}T180000\r\n/);expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(2);});
 it('rejects empty or malformed calendars',()=>{expect(()=>reminderCalendar({...prefs(),weekdays:[]})).toThrow();expect(()=>reminderCalendar({...prefs(),times:['25:00']})).toThrow();});
});
