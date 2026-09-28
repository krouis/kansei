import type { HandwritingVerdict } from '@/domain';
import type { AssessRequest } from './ports';
import { assess } from './assess';

/**
 * The assessment worker.
 *
 * A module Web Worker so a stroke animation or the next pointermove is never
 * blocked by the assignment solve — cubic in stroke count, and the hardest
 * taught kanji have on the order of 30 strokes, cheap in absolute terms but not
 * something to risk on the frame that is also rendering ink.
 *
 * The message contract is intentionally the plainest possible request/response
 * pair: every field of `AssessRequest` is already JSON-plain data (no functions,
 * no class instances), so it survives structured cloning without a bespoke
 * (de)serialiser.
 */

export interface AssessWorkerRequest {
  requestId: number;
  request: AssessRequest;
}

export interface AssessWorkerResponse {
  requestId: number;
  verdict: HandwritingVerdict;
}

self.onmessage = (event: MessageEvent<AssessWorkerRequest>) => {
  const { requestId, request } = event.data;
  const verdict = assess(request);
  const response: AssessWorkerResponse = { requestId, verdict };
  (self as unknown as Worker).postMessage(response);
};
