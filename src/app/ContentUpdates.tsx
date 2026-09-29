import {useCallback,useEffect,useState} from 'react';
import type {PackIndex} from '@/domain';
import type {Services} from './services';
import {Button,Card} from '@/ui/primitives';
export function ContentUpdates({services,active,busy,settings,run}:{services:Services;active:boolean;busy:boolean;settings:boolean;run:(action:()=>Promise<void>)=>void}) {
 const [candidate,setCandidate]=useState<PackIndex|null>(null);
 const [checking,setChecking]=useState(false);const [error,setError]=useState('');const [progress,setProgress]=useState('');const [later,setLater]=useState(false);const [checked,setChecked]=useState(false);
 const check=useCallback(async()=>{
  if(!navigator.onLine)return;
  setChecking(true);setError('');
  try{setCandidate(await services.checkContentUpdate());setChecked(true);}
  catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{setChecking(false);}
 },[services]);
 useEffect(()=>{void check();const online=()=>void check();window.addEventListener('online',online);const timer=setInterval(()=>{if(document.visibilityState==='visible')void check();},3600000);return()=>{clearInterval(timer);window.removeEventListener('online',online);};},[check]);
 if(!settings&&(!candidate||later))return null;
 return <Card><h2>Content updates</h2><p>{candidate?'Updated learning material is available. Downloaded files will be verified before replacing installed content. Your learning records are kept.':'Learning material is checked separately from the application.'}</p>
 {candidate&&<><p>{(candidate.packs.reduce((n,p)=>n+p.totalBytes,0)/1e6).toFixed(1)} MB total; unchanged files are reused. Temporary space for a second copy is needed.</p><Button disabled={busy||active||checking} onClick={()=>run(async()=>{await services.updateContent(candidate,p=>setProgress(`${p.filesDone}/${p.filesTotal} files · ${(p.bytesDone/1e6).toFixed(1)} MB`));location.reload();})}>Download content update</Button> <Button disabled={busy} onClick={()=>setLater(true)}>Later</Button>{active&&<p>Finish or end practice before updating content.</p>}</>}
 {settings&&<Button disabled={checking||busy||!navigator.onLine} onClick={()=>{setLater(false);void check();}}>Check content updates</Button>}
 <p role="status">{checking?'Checking content…':progress||error||(checked&&!candidate?'Installed content is current.':'')}</p>
 </Card>;
}
