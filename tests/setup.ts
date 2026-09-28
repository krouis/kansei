import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

/**
 * Global test setup.
 *
 * `fake-indexeddb/auto` installs a real (in-memory) IndexedDB implementation on
 * `globalThis`, so persistence tests exercise the actual `idb` code path rather
 * than a mock of it — the transaction-timing bug the codebase guards against
 * (an `await` outside the transaction silently splitting a write) only shows up
 * against a real IDB implementation's microtask behaviour.
 *
 * jest-dom adds the `toBeInTheDocument`-style matchers used by component tests.
 */
