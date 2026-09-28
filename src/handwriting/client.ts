import type { HandwritingVerdict } from '@/domain';
import type { AssessorClient, AssessRequest } from './ports';
import { assess } from './assess';
import type { AssessWorkerRequest, AssessWorkerResponse } from './worker';

/**
 * `AssessorClient` over a module Web Worker, with an honest main-thread
 * fallback.
 *
 * Falls back — rather than throwing — when `Worker` is unavailable (a very old
 * browser, or a test environment with no worker support) or when constructing
 * it throws (some sandboxed embeds block worker creation). `usingWorker`
 * reports which actually happened, so the app can be honest in its own
 * diagnostics rather than claiming off-main-thread execution it does not have.
 */
export function createAssessorClient(): AssessorClient {
  let worker: Worker | null = null;
  let nextRequestId = 1;
  const pending = new Map<number, { resolve: (v: HandwritingVerdict) => void; reject: (e: unknown) => void }>();

  try {
    if (typeof Worker !== 'undefined') {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<AssessWorkerResponse>) => {
        const entry = pending.get(event.data.requestId);
        if (!entry) return;
        pending.delete(event.data.requestId);
        entry.resolve(event.data.verdict);
      };
      worker.onerror = (event) => {
        // An error with no requestId to target: fail every outstanding request
        // rather than hang them forever, since we cannot tell which one broke.
        for (const [, entry] of pending) entry.reject(event.error ?? new Error('Assessment worker failed.'));
        pending.clear();
      };
    }
  } catch {
    worker = null;
  }

  return {
    get usingWorker() {
      return worker !== null;
    },
    async assess(request: AssessRequest): Promise<HandwritingVerdict> {
      if (!worker) return assess(request);
      const requestId = nextRequestId++;
      return new Promise<HandwritingVerdict>((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        const message: AssessWorkerRequest = { requestId, request };
        worker!.postMessage(message);
      });
    },
    terminate() {
      worker?.terminate();
      worker = null;
      for (const [, entry] of pending) entry.reject(new Error('Assessment client terminated.'));
      pending.clear();
    },
  };
}
