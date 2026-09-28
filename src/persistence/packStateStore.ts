import type { IDBPDatabase } from 'idb';
import type { PackInstallState } from '@/domain';
import { guard } from './errors';
import type { KanseiSchema } from './schema';
import type { PackStateStore } from './ports';

/**
 * Per-pack install state, keyed by pack id.
 *
 * Deliberately outside `Database.transact`'s scope, same reasoning as
 * settings: this describes what verified on THIS device and is read by the
 * installer far more often than the learning-record stores change, so it has
 * no reason to share their transaction.
 */
export function createPackStateStore(idb: IDBPDatabase<KanseiSchema>): PackStateStore {
  return {
    async get(packId: string): Promise<PackInstallState | undefined> {
      return guard('reading pack install state', () => idb.get('packState', packId));
    },
    async put(state: PackInstallState): Promise<void> {
      await guard('saving pack install state', () => idb.put('packState', state));
    },
    async all(): Promise<PackInstallState[]> {
      return guard('reading all pack install state', () => idb.getAll('packState'));
    },
  };
}
