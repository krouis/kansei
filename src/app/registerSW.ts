/** App updates replace cached code, never the device-local learning database. */
export interface SwState {
  controlled: boolean;
  updateAvailable: boolean;
  unsupported: boolean;
  checking: boolean;
  applying: boolean;
  error: string | null;
  checkedAt: string | null;
}
export interface SwHandle {
  getState: () => SwState;
  subscribe: (fn: (state: SwState) => void) => () => void;
  checkForUpdate: () => Promise<void>;
  applyUpdate: () => void;
  dispose: () => void;
}
const CHECK_INTERVAL = 60 * 60 * 1000;
export function registerServiceWorker(): SwHandle {
  let state: SwState = { controlled: false, updateAvailable: false, unsupported: false, checking: false, applying: false, error: null, checkedAt: null };
  const listeners = new Set<(s: SwState) => void>();
  let registration: ServiceWorkerRegistration | undefined;
  let disposed = false;
  let requestedUpdate = false;
  let reloading = false;
  let applyTimer: ReturnType<typeof setTimeout> | undefined;
  const set = (patch: Partial<SwState>) => { if (!disposed) { state = { ...state, ...patch }; listeners.forEach(fn => fn(state)); } };
  const handleWaiting = () => set({ updateAvailable: Boolean(registration?.waiting) });
  const checkForUpdate = async () => {
    if (!registration || disposed || state.checking) return;
    if (!navigator.onLine) { set({ error: 'You are offline. The installed version remains available.' }); return; }
    set({ checking: true, error: null });
    try { await registration.update(); handleWaiting(); set({ checkedAt: new Date().toISOString() }); }
    catch { set({ error: 'Could not check for an update. Your installed app and progress are unchanged.' }); }
    finally { set({ checking: false }); }
  };
  const onOnline = () => { void checkForUpdate(); };
  const onVisible = () => {
    if (document.visibilityState === 'visible' && (!state.checkedAt || Date.now() - Date.parse(state.checkedAt) >= CHECK_INTERVAL)) void checkForUpdate();
  };
  const onController = () => {
    set({ controlled: Boolean(navigator.serviceWorker.controller) });
    // Other tabs must never be forcibly reloaded during an answer or write.
    if (!requestedUpdate || reloading) return;
    reloading = true;
    clearTimeout(applyTimer);
    window.location.reload();
  };
  const onMessage = (event: MessageEvent) => {
    if (event.data?.type !== 'UPDATE_BLOCKED') return;
    requestedUpdate = false;
    clearTimeout(applyTimer);
    set({ applying: false, error: 'Close other Kansei tabs or windows, then update here. Their practice will not be interrupted.' });
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) set({ unsupported: true });
  else {
    set({ controlled: Boolean(navigator.serviceWorker.controller) });
    navigator.serviceWorker.addEventListener('controllerchange', onController);
    navigator.serviceWorker.addEventListener('message', onMessage);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    timer = setInterval(() => { if (navigator.onLine && document.visibilityState === 'visible') void checkForUpdate(); }, CHECK_INTERVAL);
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { type: 'module', scope: import.meta.env.BASE_URL, updateViaCache: 'none' }).then(reg => {
      if (disposed) return;
      registration = reg;
      handleWaiting();
      const watchInstalling = () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) handleWaiting();
        });
      };
      reg.addEventListener('updatefound', watchInstalling);
      watchInstalling();
      if (navigator.onLine) void checkForUpdate();
    }).catch(() => set({ error: 'Update checks are unavailable. Existing local progress has not been reset.' }));
  }
  return {
    getState: () => state,
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    checkForUpdate,
    applyUpdate() {
      if (!registration?.waiting || state.applying) return;
      requestedUpdate = true;
      set({ applying: true, error: null });
      applyTimer = setTimeout(() => {
        requestedUpdate = false;
        set({ applying: false, error: 'The update could not activate. Keep using this version and try again later.' });
      }, 15000);
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    },
    dispose() {
      disposed = true; listeners.clear(); clearInterval(timer); clearTimeout(applyTimer);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      navigator.serviceWorker?.removeEventListener('controllerchange', onController);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
    },
  };
}

/** Content switching also requires one app window, checked by the controller. */
export async function ensureSingleAppWindow(): Promise<void> {
  if (!navigator.serviceWorker?.controller) throw new Error('Wait for the app to be ready offline before updating content.');
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {channel.port1.close();reject(new Error('Could not confirm safe update status. Close other Kansei windows and reload before trying again.'));}, 3000);
    channel.port1.onmessage = event => {
      clearTimeout(timer);channel.port1.close();
      if (event.data?.single) resolve();
      else reject(new Error('Close other Kansei tabs or windows before updating content.'));
    };
    navigator.serviceWorker.controller!.postMessage({type:'CHECK_UPDATE_CLIENTS'},[channel.port2]);
  });
}
