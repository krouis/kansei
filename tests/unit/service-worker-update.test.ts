import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {registerServiceWorker, type SwHandle} from '@/app/registerSW';
let handle: SwHandle;
let container: EventTarget & {controller: object | null; register: ReturnType<typeof vi.fn>};
let registration: EventTarget & {waiting: {postMessage: ReturnType<typeof vi.fn>} | null; installing: null; update: ReturnType<typeof vi.fn>};
beforeEach(() => {
 vi.useFakeTimers(); vi.stubEnv('PROD', true);
 registration = Object.assign(new EventTarget(), {waiting:null, installing:null, update:vi.fn().mockResolvedValue(undefined)});
 container = Object.assign(new EventTarget(), {controller:{}, register:vi.fn().mockResolvedValue(registration)});
 vi.stubGlobal('navigator', {serviceWorker:container, onLine:true});
});
afterEach(() => {handle?.dispose();vi.unstubAllGlobals();vi.unstubAllEnvs();vi.useRealTimers();});
async function start(){ handle=registerServiceWorker();await vi.waitFor(()=>expect(registration.update).toHaveBeenCalledTimes(1)); }
describe('non-destructive app update checks',()=>{
 it('checks on launch and reconnect without activating a waiting version',async()=>{
  registration.waiting={postMessage:vi.fn()};await start();
  expect(container.register).toHaveBeenCalledWith(expect.stringContaining('sw.js'),expect.objectContaining({updateViaCache:'none'}));
  expect(handle.getState().updateAvailable).toBe(true);expect(registration.waiting.postMessage).not.toHaveBeenCalled();
  window.dispatchEvent(new Event('online'));await vi.waitFor(()=>expect(registration.update).toHaveBeenCalledTimes(2));
 });
 it('keeps the installed version on offline or failed checks',async()=>{
  await start();vi.stubGlobal('navigator',{serviceWorker:container,onLine:false});await handle.checkForUpdate();
  expect(registration.update).toHaveBeenCalledTimes(1);expect(handle.getState().error).toContain('offline');
  vi.stubGlobal('navigator',{serviceWorker:container,onLine:true});registration.update.mockRejectedValue(new Error('network'));
  await handle.checkForUpdate();expect(handle.getState()).toMatchObject({controlled:true,checking:false});expect(handle.getState().error).toContain('unchanged');
 });
 it('activates only after a request and reports another open tab',async()=>{
  registration.waiting={postMessage:vi.fn()};await start();handle.applyUpdate();handle.applyUpdate();
  expect(registration.waiting.postMessage).toHaveBeenCalledTimes(1);
  container.dispatchEvent(new MessageEvent('message',{data:{type:'UPDATE_BLOCKED'}}));
  expect(handle.getState().applying).toBe(false);expect(handle.getState().error).toContain('other Kansei');
 });
 it('does not leave controls locked if activation stalls',async()=>{
  registration.waiting={postMessage:vi.fn()};await start();handle.applyUpdate();await vi.advanceTimersByTimeAsync(15000);
  expect(handle.getState().applying).toBe(false);expect(handle.getState().error).toContain('try again');
 });
});
