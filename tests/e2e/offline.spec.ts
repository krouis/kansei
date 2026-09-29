import { readFile, writeFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';

const base = process.env.PLAYWRIGHT_BASE_PATH || '/';
const appPath = (path: string) => base + path.replace(/^\//, '');

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const names = await indexedDB.databases();
    const db = await new Promise<IDBDatabase>((resolve,reject) => { const req = indexedDB.open(names.find(n => n.name?.includes('kansei'))!.name!); req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error); });
    const rows = await new Promise<any[]>((resolve,reject)=>{const req=db.transaction('sessions').objectStore('sessions').getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});db.close();
    const state = rows.find(r=>r.status==='active');
    return state?.series[state.activeSeriesIndex].screens[state.series[state.activeSeriesIndex].cursor].question;
  });
}

test('installs real kana, completes ten questions, and cold starts offline', async ({page,context}) => {
  const errors: string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(appPath('/'));
  await page.getByLabel('Keyboard-only practice (no handwriting)').check();
  await page.getByLabel('Silent practice', {exact:true}).check();
  await page.getByRole('button',{name:'Install and begin'}).click();
  await expect(page.getByRole('button',{name:'Start as a beginner'})).toBeVisible({timeout:60000});
  await page.getByRole('button',{name:'Start as a beginner'}).click();
  await expect(page.getByRole('button',{name:'Begin practice'})).toBeVisible({timeout:60000});
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.screenshot({path:'test-results/practice-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'Begin practice'}).click();
  await page.getByRole('button',{name:'Start questions'}).click();
  const workerPath = 'dist/sw.js';
  const oldWorker = await readFile(workerPath, 'utf8');
  const contentIndexPath = 'dist/content/index.json';
  const oldIndex = await readFile(contentIndexPath, 'utf8');
  try {
  // A second deployed worker, served by the real HTTP preview, not a mocked
  // service-worker API. No user-data store is changed by this test fixture.
  await writeFile(workerPath, oldWorker + '\n// Update preservation acceptance build\nself.addEventListener("message", e => { if(e.data === "TEST_BUILD") e.ports[0].postMessage("updated"); });\n');
  await page.evaluate(async () => { const reg = await navigator.serviceWorker.ready; await reg.update(); });
  await expect(page.getByText('Finish or end your current session before updating.')).toBeVisible();
  await expect(page.getByRole('button', {name:'Update now', exact:true})).toBeDisabled();
  for(let i=0;i<10;i++) {
    await expect(page.getByText(`Question ${i+1} / 10`,{exact:true})).toBeVisible();
    const q=await snapshot(page);
    if(q.options) await page.locator('.choices button').nth(q.options.findIndex((o:any)=>o.correct)).click();
    else if(q.pairs) for(const pair of q.pairs) { await page.locator('.matching > div').nth(0).getByRole('button',{name:pair.left.display,exact:true}).click();await page.locator('.matching > div').nth(1).getByRole('button',{name:pair.right.display,exact:true}).click(); }
    else await page.getByLabel(/^Your answer/).fill(q.acceptedAnswers[0]);
    await page.getByRole('button',{name:'Check answer',exact:true}).click();
    await expect(page.getByRole('button',{name:'Continue · +1 XP'})).toBeVisible();
    await page.getByRole('button',{name:'Continue · +1 XP'}).click();
  }
  await expect(page.getByRole('heading',{name:'Series complete. Nicely practised.'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'20 / 20 XP today'})).toBeVisible();
  const userData = async () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve,reject) => {const r=indexedDB.open('kansei');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const stores=['settings','attempts','skillStates','xpAwards','daily','sessions','confusions','auxiliary'];
    const rows = await Promise.all(stores.map(store => new Promise<unknown[]>((resolve,reject) => {const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);})));db.close();return rows;
  });
  const beforeUpdate = await userData();
  const otherTab = await context.newPage();
  await otherTab.goto(appPath('/about'));
  await expect(otherTab.getByRole('heading', {name:'How learning works here'})).toBeVisible();
  await page.getByRole('button', {name:'Update now', exact:true}).click();
  await expect(page.getByText('Close other Kansei tabs or windows, then update here. Their practice will not be interrupted.')).toBeVisible();
  await otherTab.close();
  await page.getByRole('button', {name:'Update now', exact:true}).click();
  await page.waitForEvent('load');
  await expect(page.getByRole('button', {name:'Begin practice'})).toBeVisible({timeout:60000});
  expect(await userData()).toEqual(beforeUpdate);
  expect(await page.evaluate(() => new Promise(resolve => {
    const channel = new MessageChannel();channel.port1.onmessage=e=>resolve(e.data);
    navigator.serviceWorker.controller!.postMessage('TEST_BUILD',[channel.port2]);
  }))).toBe('updated');
  // Publish an index revision with identical assets to exercise staged reuse,
  // semantic validation, atomic activation and boot-time metadata recovery.
  const newIndex = JSON.parse(oldIndex);newIndex.generatedAt='2099-01-01T00:00:00.000Z';
  await writeFile(contentIndexPath, JSON.stringify(newIndex));
  await page.goto(appPath('/settings'));
  await page.getByRole('button', {name:'Check content updates',exact:true}).click();
  await expect(page.getByRole('button', {name:'Download content update'})).toBeVisible();
  await page.getByRole('button', {name:'Download content update'}).click();
  await page.waitForEvent('load');
  await expect(page.getByRole('heading', {name:'Make space for practice.'})).toBeVisible({timeout:60000});
  expect(await userData()).toEqual(beforeUpdate);
  expect(await page.evaluate(async () => (await caches.keys()).some(name => name.includes('content-v1-generation-')))).toBe(true);
  } finally { await writeFile(workerPath, oldWorker); await writeFile(contentIndexPath, oldIndex); }
  await context.setOffline(true);
  await page.close();
  const cold=await context.newPage();cold.on('pageerror',e=>errors.push(e.message));
  await cold.goto(appPath('/characters'));
  await expect(cold.getByRole('heading',{name:'Look a little closer.'})).toBeVisible();
  await cold.getByRole('button',{name:/^あ, a,/}).click();
  await expect(cold.getByRole('button',{name:'Play recording'})).toBeVisible();
  await cold.getByRole('button',{name:'Play recording'}).click();
  await expect(cold.locator('.writing-canvas')).toBeVisible();
  await cold.getByRole('button',{name:'Replay reference'}).click();
  const audioStatus=await cold.evaluate(async(audioPath)=>{const r=await fetch(audioPath);return {ok:r.ok,bytes:(await r.arrayBuffer()).byteLength};}, appPath('/content/audio/kana/a.oga'));
  expect(audioStatus.ok).toBe(true);expect(audioStatus.bytes).toBeGreaterThan(1000);
  await cold.goto(appPath('/about'));await expect(cold.getByRole('heading',{name:'How learning works here'})).toBeVisible();
  await cold.goto(appPath('/progress'));await expect(cold.getByRole('heading',{name:'20 XP all time',exact:true})).toBeVisible();
  await cold.setViewportSize({width:390,height:844});await cold.goto(appPath('/characters'));
  await expect(cold.getByRole('heading',{name:'Look a little closer.'})).toBeVisible();
  expect(await cold.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await cold.screenshot({path:'test-results/characters-phone.png',fullPage:true});
  expect(errors).toEqual([]);
});

// No service worker or prior visit may be needed to load a shared section URL.
test('serves a direct section entry and scopes the manifest to its deployment', async ({page}) => {
  const response = await page.goto(appPath('/characters/'));
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', {name:'Your Japanese notebook.'})).toBeVisible();
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!;
    const response = await fetch(link.href);
    return { url: new URL(link.href).pathname, data: await response.json() };
  });
  expect(manifest.url).toBe(appPath('/manifest.webmanifest'));
  expect(manifest.data.scope).toBe(base);
  expect(manifest.data.start_url).toBe(`${base}?source=pwa`);
  expect(manifest.data.icons.every((icon: {src:string}) => icon.src.startsWith(`${base}icons/`))).toBe(true);
});

test('offers an optional placement check that recognises known kana and never claims reading or handwriting', async ({page}) => {
  const errors: string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(appPath('/'));
  await page.getByLabel('Keyboard-only practice (no handwriting)').check();
  await page.getByLabel('Silent practice', {exact:true}).check();
  await page.getByRole('button',{name:'Install and begin'}).click();
  await expect(page.getByRole('button',{name:'Quick placement check'})).toBeVisible({timeout:60000});
  await page.getByRole('button',{name:'Quick placement check'}).click();
  // The real practice UI, not a bespoke placement screen: same choice buttons,
  // same "Check answer" flow, same keyboard shortcuts as ordinary practice.
  await expect(page.getByText('Question 1 / 10',{exact:true})).toBeVisible();
  for (let i=0;i<10;i++) {
    await expect(page.getByText(`Question ${i+1} / 10`,{exact:true})).toBeVisible();
    // Answer everything correctly so the summary's count is checkable exactly.
    const snapshot = await page.evaluate(async () => {
      const names = await indexedDB.databases();
      const db = await new Promise<IDBDatabase>((resolve,reject) => { const req = indexedDB.open(names.find(n => n.name?.includes('kansei'))!.name!); req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error); });
      const rows = await new Promise<any[]>((resolve,reject)=>{const req=db.transaction('sessions').objectStore('sessions').getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});db.close();
      const state = rows.find(r=>r.status==='active');
      return state?.series[0].screens[state.series[0].cursor].question;
    });
    expect(snapshot.skill).toBe('recognition');
    await page.locator('.choices button').nth(snapshot.options.findIndex((o: {correct:boolean}) => o.correct)).click();
    await page.getByRole('button',{name:'Check answer',exact:true}).click();
    await expect(page.getByRole('button',{name:'Continue · +1 XP'})).toBeVisible();
    await page.getByRole('button',{name:'Continue · +1 XP'}).click();
  }
  await expect(page.getByRole('heading',{name:'Placement check complete.'})).toBeVisible();
  await expect(page.getByText('You recognised 10 of 10 characters')).toBeVisible();
  await expect(page.getByText(/Reading recall, listening and handwriting are not assessed/)).toBeVisible();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByRole('button',{name:'Begin practice'})).toBeVisible();
  expect(errors).toEqual([]);
});
