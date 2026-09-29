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
  await expect(page.getByRole('button',{name:'Begin practice'})).toBeVisible({timeout:60000});
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.screenshot({path:'test-results/practice-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'Begin practice'}).click();
  await page.getByRole('button',{name:'Start questions'}).click();
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
