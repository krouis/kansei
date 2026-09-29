import { useState } from 'react';
import type { SwHandle, SwState } from './registerSW';
import { Button, Card } from '@/ui/primitives';
export function UpdateNotice({ updater, state, active, busy, settings }: {updater: SwHandle; state: SwState; active: boolean; busy: boolean; settings: boolean}) {
  const [later, setLater] = useState(false);
  if (state.unsupported) return settings ? <Card><h2>Application updates</h2><p>Automatic updates require the production app on HTTPS or localhost.</p></Card> : null;
  const visible = state.updateAvailable && !later;
  if (!visible && !settings) return null;
  return <Card><h2>Application updates</h2><div role="status">
    <p>{visible ? 'A new version is ready. Your progress, XP, history and settings stay on this device.' : 'Check for a new app version when connected. Updates preserve your local learning data.'}</p>
    {visible && active && <p>Finish or end your current session before updating.</p>}
    {state.checking && <p>Checking for updates…</p>}
    {state.checkedAt && !state.checking && !state.updateAvailable && <p>Last check: {new Date(state.checkedAt).toLocaleString()}. No update is ready to install.</p>}
    {state.error && <p>{state.error}</p>}
  </div>
    {visible && <><Button disabled={active || busy || state.applying} onClick={updater.applyUpdate}>{state.applying ? 'Updating…' : 'Update now'}</Button> <Button disabled={state.applying} onClick={() => setLater(true)}>Later</Button></>}
    {settings && <Button disabled={busy || state.checking || state.applying} onClick={() => {setLater(false); void updater.checkForUpdate();}}>Check for updates</Button>}
    {settings && <p className="footnote">Keep backups: clearing browser data or changing the site’s domain can make local data unavailable. Content packs are managed separately below.</p>}
  </Card>;
}
