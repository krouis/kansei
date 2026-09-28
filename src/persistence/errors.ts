import { StorageError, type StorageFailure } from './ports';

/**
 * Turning browser storage errors into something the learner can act on.
 *
 * IndexedDB fails in a handful of genuinely different ways, and they need
 * genuinely different UI: "you are out of space" is a different conversation
 * from "another tab is holding the old version open". Everything below maps a
 * real DOMException onto exactly one `StorageFailure.kind`, and anything we
 * cannot classify becomes 'unknown' WITH its cause attached rather than being
 * flattened into a lie.
 *
 * Nothing here swallows an error. Every path either returns a failure that the
 * caller throws, or rethrows.
 */

/** DOMException-ish shape, because `instanceof DOMException` is not reliable across realms. */
function errorName(cause: unknown): string {
  if (cause && typeof cause === 'object' && 'name' in cause && typeof cause.name === 'string') {
    return cause.name;
  }
  return '';
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string') return cause;
  return String(cause);
}

/**
 * Legacy Safari and some older engines report a quota failure only through the
 * numeric `code` (22 = QUOTA_EXCEEDED_ERR), not through `name`. Checking both is
 * the difference between showing "free up space" and showing "something broke".
 */
function isQuotaError(cause: unknown): boolean {
  if (errorName(cause) === 'QuotaExceededError') return true;
  if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 22) return true;
  // Firefox has historically used a bare NS_ERROR_DOM_QUOTA_REACHED message.
  return /quota/i.test(errorMessage(cause));
}

export function classify(cause: unknown, context: string): StorageFailure {
  if (cause instanceof StorageError) return cause.failure;

  if (isQuotaError(cause)) {
    return {
      kind: 'quota-exceeded',
      message:
        `There is no room left in this browser's storage for Kansei, so ${context} could not be saved. ` +
        'Free up space on the device, or export a backup and remove some history.',
      // Retryable only in the sense that it will succeed once space exists; the
      // same call repeated immediately will fail again, so this is false.
      retryable: false,
      cause,
    };
  }

  switch (errorName(cause)) {
    case 'VersionError':
      // The stored database is NEWER than this build expects. Almost always a
      // stale service worker serving an old app shell alongside a new one.
      return {
        kind: 'version-conflict',
        message:
          'Your saved progress was written by a newer version of Kansei than the one running now. ' +
          'Close all Kansei tabs and reopen the app so it can update.',
        retryable: false,
        cause,
      };
    case 'SecurityError':
    case 'InvalidAccessError':
      return {
        kind: 'unavailable',
        message:
          'This browser is not allowing Kansei to store data. Private browsing and blocked site data ' +
          'both do this. Progress cannot be saved until storage is allowed.',
        retryable: false,
        cause,
      };
    case 'NotFoundError':
    case 'UnknownError':
      // UnknownError is what engines report for genuine on-disk damage.
      return {
        kind: 'corrupt',
        message:
          `Kansei could not read its database while ${context}. The stored data appears to be damaged. ` +
          'Export a backup if the app still loads, then reset the database from Settings.',
        retryable: false,
        cause,
      };
    case 'TransactionInactiveError':
    case 'InvalidStateError':
      return {
        kind: 'unknown',
        message:
          `${context} was attempted after its transaction had already committed. Any writes issued ` +
          'before that point WERE applied; this one was not, so the change is incomplete. This is a ' +
          'bug in Kansei: the callback given to transact() must not await anything other than the ' +
          'repository methods it was handed.',
        retryable: false,
        cause,
      };
    case 'ConstraintError':
      return {
        kind: 'unknown',
        message: `${context} was rejected because a record with the same key already exists.`,
        retryable: false,
        cause,
      };
    case 'AbortError':
      return {
        kind: 'unknown',
        message: `${context} was rolled back before it completed, so nothing was changed.`,
        retryable: true,
        cause,
      };
    default:
      return {
        kind: 'unknown',
        message: `${context} failed: ${errorMessage(cause)}`,
        retryable: true,
        cause,
      };
  }
}

export function storageError(cause: unknown, context: string): StorageError {
  return cause instanceof StorageError ? cause : new StorageError(classify(cause, context));
}

/** Run `fn`, converting any failure into a `StorageError` that names what was happening. */
export async function guard<T>(context: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (cause) {
    throw storageError(cause, context);
  }
}

export function fail(kind: StorageFailure['kind'], message: string, retryable = false, cause?: unknown): never {
  throw new StorageError({ kind, message, retryable, cause });
}
