import type { IDBPDatabase } from 'idb';
import { DEFAULT_DAILY_XP_GOAL, resolveTimeZone } from '@/domain';
import type { Settings } from '@/domain';
import { guard, storageError } from './errors';
import { SETTINGS_KEY, type KanseiSchema } from './schema';
import type { SettingsStore } from './ports';

/**
 * The default settings a fresh install starts with, before onboarding writes
 * the learner's real choices. Every field here is a genuine, documented
 * default (see the domain doc comments on `Settings`), not an arbitrary guess.
 */
export function defaultSettings(): Settings {
  return {
    version: 1,
    theme: 'system',
    japaneseTextScale: 1,
    reducedMotion: 'system',
    dailyGoalXp: DEFAULT_DAILY_XP_GOAL,
    enabledQuestionTypes: [
      'audio-to-character-choice', 'romaji-to-kana-choice', 'character-to-reading-choice',
      'character-to-reading-typed', 'match-pairs', 'audio-to-typed', 'prompt-to-handwriting',
      'confusable-discrimination', 'word-reading', 'kanji-in-word-context',
      // Added later than the original ten and never enabled here: with no UI
      // to edit this list, that default is the only list any user ever gets,
      // so omitting these silently made every component and every kanji
      // meaning-recognition question unreachable ("Could not generate a
      // question... candidates.push('component-in-kanji-choice',
      // 'meaning-to-kanji-choice') in composite.ts never survives the
      // enabledTypes filter). Found live once kanji was actually reachable.
      'component-in-kanji-choice', 'meaning-to-kanji-choice',
    ],
    silentPractice: false,
    keyboardOnlyMode: false,
    seriesPerSession: 1,
    selectionPolicy: { dueReview: 6, weakSkillOrConfusion: 2, newOrExtending: 2 },
    scaffoldWithdrawal: 'standard',
    showStreak: true,
    playChimes: true,
    reminders: {
      enabled: false,
      times: [],
      weekdays: [],
      afterLastSeries: false,
      quietHours: null,
      snoozeMinutes: 15,
      pausedUntil: null,
      skipWhenGoalMet: true,
      notificationPermission: 'default',
    },
    onboardingCompletedAt: null,
    locale: 'en',
    activeScripts: ['hiragana', 'katakana'],
    includeExtended: false,
    includeHistorical: false,
  };
}

/**
 * Settings live in their own store, addressed directly rather than through
 * `Database.transact` — they are read far more often than they change
 * (every screen render potentially wants the theme or the daily goal) and are
 * not part of the atomic "recording an answer" write set the Transaction port
 * scopes to. A `BroadcastChannel` notifies other tabs of a change; IndexedDB
 * itself has no change-event API to hook.
 */
export function createSettingsStore(idb: IDBPDatabase<KanseiSchema>): SettingsStore {
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('kansei-settings') : null;

  return {
    async load(): Promise<Settings> {
      return guard('loading settings', async () => {
        const row = await idb.get('settings', SETTINGS_KEY);
        // Merged with defaults, not returned raw: a field added to Settings
        // after a learner's first install (showStreak and playChimes both
        // shipped this way) is simply absent from their stored row, and
        // without this merge it would read as `undefined` — falsy, and
        // silently off — rather than the documented default.
        if (row) return { ...defaultSettings(), ...row.value };
        const fresh = defaultSettings();
        // A brand-new install: write the defaults immediately rather than
        // leaving the store empty, so export()/backup never has to treat
        // "no settings row yet" as a valid steady state.
        await idb.put('settings', { id: SETTINGS_KEY, value: fresh });
        return fresh;
      });
    },

    async save(settings: Settings): Promise<void> {
      await guard('saving settings', async () => {
        await idb.put('settings', { id: SETTINGS_KEY, value: settings });
      });
      try {
        channel?.postMessage({ type: 'changed' });
      } catch (cause) {
        // A postMessage failure here must not fail the save that already
        // succeeded; the only cost is another tab not hearing about it live.
        void storageError(cause, 'notifying other tabs of a settings change');
      }
    },

    subscribe(fn: (settings: Settings) => void): () => void {
      if (!channel) return () => {};
      const handler = () => {
        void idb.get('settings', SETTINGS_KEY).then((row) => {
          if (row) fn(row.value);
        });
      };
      channel.addEventListener('message', handler);
      return () => channel.removeEventListener('message', handler);
    },
  };
}

/** Re-exported so callers that only need "what zone am I in" need not import domain directly. */
export { resolveTimeZone };
