import {addDays,NON_PENALISED_HINTS,SKILLS,SKILL_LABELS} from '@/domain';
import type {AttemptRecord,DailyRecord,SkillState} from '@/domain';
export function mondayOf(date:string):string {const day=new Date(`${date}T12:00:00Z`).getUTCDay();return addDays(date,-((day+6)%7));}
export function practiceSummary(days:DailyRecord[],today:string){
 const recorded=days.filter(d=>d.localDate<=today);const week=mondayOf(today);const month=today.slice(0,7)+'-01';
 return {weekXp:recorded.filter(d=>d.localDate>=week).reduce((n,d)=>n+d.xp,0),monthXp:recorded.filter(d=>d.localDate>=month).reduce((n,d)=>n+d.xp,0),allXp:recorded.reduce((n,d)=>n+d.xp,0),activeMs:recorded.reduce((n,d)=>n+d.activeMs,0),lastSeven:new Set(recorded.filter(d=>d.localDate>=addDays(today,-6)&&d.xp>0).map(d=>d.localDate)).size};
}
export function accuracyRows(attempts:AttemptRecord[],by:'skill'|'questionType'){
 const groups=new Map<string,{correct:number;count:number;uncertain:number}>();
 for(const a of attempts){if(a.attemptOrdinal!==0)continue;const key=a[by];const row=groups.get(key)??{correct:0,count:0,uncertain:0};if(a.outcome==='uncertain')row.uncertain++;else{row.count++;row.correct+=Number(a.outcome==='correct');}groups.set(key,row);}
 return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([label,r])=>({label:by==='skill'?SKILL_LABELS[label as keyof typeof SKILL_LABELS]:label.replaceAll('-',' '),...r,value:r.count?r.correct/r.count:null}));
}
/** Every recorded exposure, including corrections, restarts the >=24h gap.
 * Incorrect unaided attempts count too: unaidedFirstAttempt is a success flag,
 * so using it as the denominator would produce a misleading 100% rate. */
export function delayedRecall(attempts:AttemptRecord[]){
 const previous=new Map<string,number>();const weeks=new Map<string,{correct:number;count:number;uncertain:number}>();
 for(const a of [...attempts].sort((a,b)=>a.at.localeCompare(b.at))){
  const key=JSON.stringify([a.itemId,a.skill,a.readingId]);const at=Date.parse(a.at);const last=previous.get(key);previous.set(key,at);
  const unaided=a.attemptOrdinal===0&&!a.focusedPractice&&a.evidence==='strong'&&a.hintsUsed.every(h=>NON_PENALISED_HINTS.has(h));
  if(!unaided||last===undefined||at-last<86400000)continue;
  const week=mondayOf(a.localDate);const row=weeks.get(week)??{correct:0,count:0,uncertain:0};
  if(a.outcome==='uncertain')row.uncertain++;else{row.count++;row.correct+=Number(a.outcome==='correct');}weeks.set(week,row);
 }
 return [...weeks].sort(([a],[b])=>a.localeCompare(b)).map(([label,r])=>({label,...r,value:r.count>=5?r.correct/r.count:null}));
}
export function retainedBySkill(states:SkillState[],characterIds:ReadonlySet<string>){
 return SKILLS.map(skill=>{const groups=new Map<string,SkillState[]>();for(const s of states)if(s.skill===skill&&characterIds.has(s.itemId)){const rows=groups.get(s.itemId)??[];rows.push(s);groups.set(s.itemId,rows);}return {skill,label:SKILL_LABELS[skill],practised:groups.size,retained:[...groups.values()].filter(rows=>rows.every(s=>s.stage==='retained')).length};});
}
