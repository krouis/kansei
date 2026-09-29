import { openRawConnection, wrapDatabase } from '@/persistence/db';
import { createSettingsStore } from '@/persistence/settingsStore';
import { createPackStateStore } from '@/persistence/packStateStore';
import { createBackupService } from '@/persistence/backup';
import { createInstaller } from '@/content/installer';
import { createPackFileSource } from '@/content/packSource';
import { loadContentLibrary } from '@/content/library';
import { createAudioPlayer } from '@/audio/player';
import { createAssessorClient } from '@/handwriting/client';
import { KanseiGrader } from '@/learning/grading/grader';
import { createFsrsScheduler } from '@/learning/scheduler';
import { DefaultSelector } from '@/learning/selection/selector';
import { CompositeGenerator } from '@/learning/generation';
import { KanseiSessionEngine } from '@/learning/session/engine';
import type { Settings } from '@/domain';

export async function createServices() {
  const raw = await openRawConnection();
  const db = wrapDatabase(raw);
  const settingsStore = createSettingsStore(raw);
  let settings = await settingsStore.load();
  const source = createPackFileSource({ allowNetwork: false });
  const installer = createInstaller({ state: createPackStateStore(raw), capabilities: {
    async probe(paths) {
      const { library: content } = await loadContentLibrary({ index: await installer.index(), source, verifiedPaths: paths });
      return { hiragana: content.kana('hiragana').length > 0, katakana: content.kana('katakana').length > 0,
        kanji: content.kanji().length > 0, vocabulary: content.vocab().length > 0,
        audio: content.audioCoverage().some(c => c.withAudio > 0), strokeAnimation: content.kana('hiragana').some(c => content.hasStrokes(c.glyph)) };
    },
  } });
  const index = await installer.index();
  // Recheck bytes after eviction or a previous incomplete download before exposing content.
  for (const state of await installer.status()) if (state.status === 'installed') await installer.verify(state.packId);
  let { library: content } = await loadContentLibrary({ index, source, verifiedPaths: await installer.verifiedPaths() });
  const audio = createAudioPlayer();
  const assessor = createAssessorClient();
  const grader = new KanseiGrader({ assessor, content: {
    strokeReference: glyph => content.strokes(glyph),
    async confusableReferences(glyph) {
      const c = content.byGlyph(glyph);
      const refs = await Promise.all((c?.confusableWith ?? []).map(id => content.character(id)).filter(c => !!c).map(c => content.strokes(c.glyph)));
      return refs.filter(r => r !== undefined);
    },
    confusableNote: id => { const c = content.character(id); return c?.kind === 'kana' ? c.note : null; },
    itemForAnswer: (answer, question) => [...content.kana('hiragana'), ...content.kana('katakana')].find(c => c.script === content.character(question.targetItemId)?.script && c.inputVariants.includes(answer))?.id as never ?? null,
    itemForGlyph: glyph => content.byGlyph(glyph)?.id as never ?? null,
    audioFor: question => content.audio(question.targetItemId) ?? null,
  } });
  const makeEngine = () => new KanseiSessionEngine({ db, content, grader,
    scheduler: createFsrsScheduler({ random: Math.random }),
    createSelector: tx => new DefaultSelector({ skills: tx.skills, confusions: tx.confusions, library: content }),
    generator: new CompositeGenerator(), getSettings: () => settings,
  });
  let engine = makeEngine();
  return {
    db, installer, index, audio, backup: createBackupService(raw),
    get content() { return content; }, get settings() { return settings; }, get engine() { return engine; },
    async saveSettings(next: Settings) { await settingsStore.save(next); settings = next; },
    async reloadContent() {
      content = (await loadContentLibrary({ index, source, verifiedPaths: await installer.verifiedPaths() })).library;
      engine = makeEngine();
    },
  };
}
export type Services = Awaited<ReturnType<typeof createServices>>;
