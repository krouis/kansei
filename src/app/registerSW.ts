/**
 * Service worker registration and the update-ready signal.
 *
 * The worker itself never calls skipWaiting() on its own (see src/sw.ts's doc
 * comment) — a new version waits until the page explicitly tells it to take
 * over, so an update can never interrupt a practice session mid-series. This
 * module is the page-side half of that handshake.
 */

export interface SwState {
  /** True once a controller exists (the app is running under the SW, not a fresh tab). */
  controlled: boolean;
  /** True once a new worker has installed and is waiting to activate. */
  updateAvailable: boolean;
  /** True when this browser cannot register service workers at all. */
  unsupported: boolean;
}

export interface SwHandle {
  getState: () => SwState;
  subscribe: (fn: (state: SwState) => void) => () => void;
  /** Tell the waiting worker to activate, then reload once it does. */
  applyUpdate: () => void;
}

const initialState: SwState = { controlled: false, updateAvailable: false, unsupported: false };

export function registerServiceWorker(): SwHandle {
  let state: SwState = { ...initialState };
  const listeners = new Set<(s: SwState) => void>();
  let waitingWorker: ServiceWorker | null = null;

  const set = (patch: Partial<SwState>) => {
    state = { ...state, ...patch };
    for (const l of listeners) l(state);
  };

  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) {
    set({ unsupported: true });
    return {
      getState: () => state,
      subscribe: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      applyUpdate: () => {},
    };
  }

  set({ controlled: Boolean(navigator.serviceWorker.controller) });

  navigator.serviceWorker
    .register('/sw.js', { type: 'module' })
    .then((registration) => {
      const handleWaiting = () => {
        if (registration.waiting) {
          waitingWorker = registration.waiting;
          set({ updateAvailable: true });
        }
      };
      handleWaiting();

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            // 'installed' with an existing controller means this is an UPDATE,
            // not the very first install — only then is there anything to offer.
            handleWaiting();
          }
        });
      });
    })
    .catch(() => {
      // Registration can fail in a locked-down embed or over plain HTTP; the
      // app still works online, it simply will not work offline. Nothing here
      // pretends otherwise — `controlled` just stays false.
    });

  let reloading = false;
  let requestedUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    set({ controlled: Boolean(navigator.serviceWorker.controller) });
    if (!requestedUpdate || reloading) return;
    reloading = true;
    window.location.reload();
  });

  return {
    getState: () => state,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    applyUpdate: () => {
      requestedUpdate = true;
      waitingWorker?.postMessage({ type: 'SKIP_WAITING' });
    },
  };
}
