import {
  SKILLS,
  asItemId,
  type ConfusionRecord,
  type ItemId,
  type SelectionReason,
  type Settings,
  type Skill,
  type SkillState,
} from '@/domain';
import type { SelectedTarget, SelectionPolicy, SelectionRequest, Selector } from '@/learning/ports';
import type { ConfusionRepo, SkillRepo } from '@/persistence/ports';
import {
  buildItemIndex,
  candidateSkills,
  pairKey,
  passesGlobalGate,
  type ContentItem,
  type ItemIndex,
  type SelectionLibrary,
} from './items';
import { confusableGuardAllows, interleave, type InterleaveSubject } from './interleaving';
import { NEW_ITEM_SKILL_ORDER, pickNewMaterial } from './newMaterial';
import { orderByBacklogPriority, orderByWeakness } from './priority';
import { DEFAULT_SELECTION_TUNING, type SelectionTuning } from './tuning';

/**
 * Session composition.
 *
 * WHICH (item, skill) pairs make up the next ten screens — not when they are due
 * (the scheduler decides that) and not how they are asked (the generator does).
 *
 * The default 6 due-review / 2 weak-or-confusion / 2 new is a PRODUCT DEFAULT
 * chosen for balance. It is not a scientific constant and is not presented as
 * one anywhere in the app; see README.md in this directory.
 *
 * The policy is a starting point, never a quota. Every deviation from it is
 * deliberate, documented, and reported back in plain language so the learner is
 * told why a series looks the way it does instead of guessing.
 */

/**
 * A selected target, with two fields the shared `SelectedTarget` does not carry.
 *
 * `SelectionTarget` is a structural superset of `SelectedTarget`, so this
 * selector still satisfies the `Selector` port exactly; callers that do not know
 * about the extra fields are unaffected. See `portChanges` in this task's report:
 * `substitutedFor` is the field that makes the keyboard-only substitution
 * traceable, and it belongs in the shared type eventually.
 */
export interface SelectionTarget extends SelectedTarget {
  /**
   * The skill this target REPLACES, when the learner's mode excludes it.
   *
   * Set to 'handwriting' for a keyboard-only substitution. The attempt is
   * recorded under `skill`, never under `substitutedFor` — that is the whole
   * point of the field: a typed answer must never become handwriting evidence.
   */
  substitutedFor: Skill | null;
  /** Lesson the item belongs to, so the UI can say "new: lesson 3" honestly. */
  lessonId: string | null;
  /** Short machine-readable trace of why this target exists. For diagnostics and tests. */
  trace: string;
}

export interface SelectionResult {
  targets: SelectionTarget[];
  actual: Record<SelectionReason, number>;
  deviation: string | null;
}

export interface SelectorDeps {
  skills: Pick<SkillRepo, 'due' | 'all'>;
  confusions: Pick<ConfusionRepo, 'top' | 'markRepairScheduled'>;
  library: SelectionLibrary;
  tuning?: Partial<SelectionTuning>;
}

interface Candidate {
  item: ContentItem;
  skill: Skill;
  readingId: string | null;
  reason: SelectionReason;
  state: SkillState | null;
  confusion: ConfusionRecord | null;
  substitutedFor: Skill | null;
  trace: string;
  /** How many targets this item may contribute before relaxation. */
  perItemCap: number;
  /** New vocabulary is kept contiguous; see interleaving.ts. */
  blockWithNewVocab: boolean;
}

const ZERO_ACTUAL: Record<SelectionReason, number> = {
  'due-review': 0,
  'weak-skill': 0,
  'confusion-repair': 0,
  'new-material': 0,
  retry: 0,
  focused: 0,
};

const emptyActual = (): Record<SelectionReason, number> => ({ ...ZERO_ACTUAL });

/** Accepts candidates while enforcing the per-item cap and the confusable guard. */
class Picker {
  readonly chosen: Candidate[] = [];
  private readonly keys = new Set<string>();
  private readonly perItem = new Map<string, number>();
  /** Raised only when the series cannot otherwise be filled. */
  capBoost = 0;
  /** Set only as a last resort; always reported in the deviation note. */
  relaxConfusable = false;

  constructor(private readonly tuning: SelectionTuning) {}

  get size(): number {
    return this.chosen.length;
  }

  private describe(c: Candidate): { item: ContentItem; subject: InterleaveSubject } {
    return {
      item: c.item,
      subject: {
        itemId: asItemId(String(c.item.id)),
        skill: c.skill,
        stage: c.state?.stage ?? 'unseen',
        // Repair and focused practice deliberately put look-alikes together.
        exemptFromConfusableGuard:
          this.relaxConfusable || c.reason === 'confusion-repair' || c.reason === 'focused',
        blockWithNewVocab: c.blockWithNewVocab,
      },
    };
  }

  tryTake(candidate: Candidate): boolean {
    const key = pairKey(candidate.item.id, candidate.skill, candidate.readingId);
    if (this.keys.has(key)) return false;
    const itemId = String(candidate.item.id);
    const used = this.perItem.get(itemId) ?? 0;
    const cap = Math.min(candidate.perItemCap + this.capBoost, this.tuning.maxTargetsPerItemCeiling);
    if (used >= cap) return false;
    if (
      !confusableGuardAllows(this.describe(candidate), this.chosen.map((c) => this.describe(c)), this.tuning)
    ) {
      return false;
    }
    this.keys.add(key);
    this.perItem.set(itemId, used + 1);
    this.chosen.push(candidate);
    return true;
  }

  fill(candidates: readonly Candidate[], upTo: number): number {
    let taken = 0;
    for (const candidate of candidates) {
      if (taken >= upTo) break;
      if (this.tryTake(candidate)) taken += 1;
    }
    return taken;
  }

  subjects(): Array<{ item: ContentItem; subject: InterleaveSubject }> {
    return this.chosen.map((c) => this.describe(c));
  }
}

/**
 * Bring the configured policy to exactly `screens`.
 *
 * A policy that asks for more than the series holds is trimmed from new material
 * first (skipping new material for one series costs nothing), then weak-point
 * practice, then review. A policy that asks for fewer gives the remainder to
 * review, because unreviewed material is the thing that decays.
 */
export function normalisePolicy(policy: SelectionPolicy, screens: number): SelectionPolicy {
  const clamp = (n: number): number => Math.max(0, Math.min(Math.trunc(n), screens));
  let dueReview = clamp(policy.dueReview);
  let weakSkillOrConfusion = clamp(policy.weakSkillOrConfusion);
  let newOrExtending = clamp(policy.newOrExtending);
  let total = dueReview + weakSkillOrConfusion + newOrExtending;
  while (total > screens) {
    if (newOrExtending > 0) newOrExtending -= 1;
    else if (weakSkillOrConfusion > 0) weakSkillOrConfusion -= 1;
    else dueReview -= 1;
    total -= 1;
  }
  if (total < screens) dueReview += screens - total;
  return { dueReview, weakSkillOrConfusion, newOrExtending };
}

export class DefaultSelector implements Selector {
  private readonly tuning: SelectionTuning;

  constructor(private readonly deps: SelectorDeps) {
    this.tuning = { ...DEFAULT_SELECTION_TUNING, ...deps.tuning };
  }

  async select(request: SelectionRequest): Promise<SelectionResult> {
    const index = buildItemIndex(this.deps.library);
    const allowed = resolveAllowedSkills(request);
    const excluded = new Set(request.exclude.map(String));
    const notes: string[] = [];

    const states = await this.deps.skills.all();
    const stateByKey = new Map<string, SkillState>();
    const startedItems = new Set<string>();
    const attemptedPairs = new Set<string>();
    for (const state of states) {
      stateByKey.set(pairKey(state.itemId, state.skill, state.readingId), state);
      attemptedPairs.add(pairKey(state.itemId, state.skill, state.readingId));
      // A state can exist at stage `unseen` (the scheduler creates one on first
      // contact), so "started" means a stage beyond that — not "has a row".
      if (state.stage !== 'unseen') startedItems.add(String(state.itemId));
    }

    if (request.focusItemId !== null) {
      return this.selectFocused(request, index, allowed, stateByKey);
    }

    // ---- Due review ------------------------------------------------------
    const dueStates = (
      await this.deps.skills.due(request.now.toISOString(), undefined, this.tuning.dueFetchLimit)
    ).filter((s) => {
      const item = index.get(s.itemId);
      return item !== undefined && passesGlobalGate(item, index, request.settings) && currentReading(item, s.readingId, index);
    });
    const backlogSize = dueStates.length;
    const dueKeys = new Set(dueStates.map((s) => pairKey(s.itemId, s.skill, s.readingId)));

    let skippedListening = 0;
    const dueCandidates: Candidate[] = [];
    const dueSubstitutes: Candidate[] = [];
    for (const state of orderByBacklogPriority(dueStates, request.now)) {
      const item = index.get(state.itemId);
      if (item === undefined || excluded.has(String(item.id))) continue;
      if (allowed.has(state.skill) && index.applicable(item)[state.skill]) {
        dueCandidates.push({
          item,
          skill: state.skill,
          readingId: state.readingId,
          reason: 'due-review',
          state,
          confusion: null,
          substitutedFor: null,
          trace: 'due-review',
          perItemCap: 1,
          blockWithNewVocab: false,
        });
        continue;
      }
      if (state.skill === 'listening') {
        // Silent mode: never selected, so listening progress is never touched.
        skippedListening += 1;
        continue;
      }
      if (state.skill === 'handwriting') {
        const substitute = substituteForHandwriting(item, index, allowed);
        if (substitute !== null) {
          dueSubstitutes.push({
            item,
            skill: substitute,
            readingId:
              substitute === 'readingRecall' ? chooseReading(item, index, stateByKey, substitute) : null,
            reason: 'due-review',
            state:
              stateByKey.get(
                pairKey(
                  item.id,
                  substitute,
                  substitute === 'readingRecall' ? chooseReading(item, index, stateByKey, substitute) : null,
                ),
              ) ?? null,
            confusion: null,
            substitutedFor: 'handwriting',
            trace: 'due-review/handwriting-substituted',
            perItemCap: 1,
            blockWithNewVocab: false,
          });
        }
      }
    }
    // Genuine candidates first: where a real reading-recall review and a
    // substituted one collide on the same pair, the real one should win.
    const dueList = [...dueCandidates, ...dueSubstitutes];

    // ---- Confusion repair ------------------------------------------------
    const confusions = (await this.deps.confusions.top(this.tuning.confusionFetchLimit)).filter(
      (c) => c.resolvedAt === null,
    );
    const confusionCandidates: Candidate[] = [];
    for (const confusion of orderConfusions(confusions)) {
      const item = index.get(confusion.itemId);
      const other = index.get(confusion.confusedWithItemId);
      if (item === undefined || other === undefined) continue;
      if (!passesGlobalGate(item, index, request.settings)) continue;
      if (!passesGlobalGate(other, index, request.settings)) continue;
      if (excluded.has(String(item.id))) continue;
      let skill: Skill | null = null;
      let substitutedFor: Skill | null = null;
      if (allowed.has(confusion.skill) && index.applicable(item)[confusion.skill]) {
        skill = confusion.skill;
      } else if (confusion.skill === 'handwriting' && allowed.has('recognition')) {
        // Repairing a mix-up is a discrimination task, so recognition is the
        // honest substitute here — reading recall would not contrast the shapes.
        skill = 'recognition';
        substitutedFor = 'handwriting';
      } else {
        continue;
      }
      confusionCandidates.push({
        item,
        skill,
        readingId: null,
        reason: 'confusion-repair',
        state: stateByKey.get(pairKey(item.id, skill, null)) ?? null,
        confusion,
        substitutedFor,
        trace: substitutedFor === null ? 'confusion-repair' : 'confusion-repair/handwriting-substituted',
        perItemCap: 1,
        blockWithNewVocab: false,
      });
    }

    // ---- Weak skills (not yet due) ---------------------------------------
    const weakStates = states.filter((s) => {
      if (s.stage === 'unseen') return false;
      if (dueKeys.has(pairKey(s.itemId, s.skill, s.readingId))) return false;
      const item = index.get(s.itemId);
      if (item === undefined || excluded.has(String(item.id))) return false;
      if (!passesGlobalGate(item, index, request.settings) || !currentReading(item, s.readingId, index)) return false;
      if (s.skill === 'listening' && !allowed.has('listening')) return false;
      return allowed.has(s.skill) ? index.applicable(item)[s.skill] : s.skill === 'handwriting';
    });
    const weakCandidates: Candidate[] = [];
    for (const state of orderByWeakness(weakStates, request.now)) {
      const item = index.get(state.itemId);
      if (item === undefined) continue;
      if (allowed.has(state.skill) && index.applicable(item)[state.skill]) {
        weakCandidates.push({
          item,
          skill: state.skill,
          readingId: state.readingId,
          reason: 'weak-skill',
          state,
          confusion: null,
          substitutedFor: null,
          trace: 'weak-skill',
          perItemCap: 1,
          blockWithNewVocab: false,
        });
        continue;
      }
      const substitute = substituteForHandwriting(item, index, allowed);
      if (state.skill === 'handwriting' && substitute !== null) {
        const readingId = substitute === 'readingRecall' ? chooseReading(item, index, stateByKey, substitute) : null;
        weakCandidates.push({
          item,
          skill: substitute,
          readingId,
          reason: 'weak-skill',
          state: stateByKey.get(pairKey(item.id, substitute, readingId)) ?? null,
          confusion: null,
          substitutedFor: 'handwriting',
          trace: 'weak-skill/handwriting-substituted',
          perItemCap: 1,
          blockWithNewVocab: false,
        });
      }
    }

    // ---- New material ----------------------------------------------------
    const pick = pickNewMaterial({
      index,
      settings: request.settings,
      allowedSkills: allowed,
      startedItems,
      attemptedPairs,
      excludedItems: excluded,
      tuning: this.tuning,
    });
    const newCandidates: Candidate[] = [];
    // Round-robin over the group so the FIRST pass gives every item in the group
    // one screen: a learner meeting five characters should see all five before
    // any of them comes round a second time.
    for (let round = 0; round < this.tuning.maxSkillsPerNewItem; round += 1) {
      for (const item of pick.group) {
        const skills = orderedNewSkills(item, index, allowed);
        const skill = skills[round];
        if (skill === undefined) continue;
        const readingId = skill === 'readingRecall' ? chooseReading(item, index, stateByKey, skill) : null;
        newCandidates.push({
          item,
          skill,
          readingId,
          reason: 'new-material',
          state: null,
          confusion: null,
          substitutedFor: null,
          trace: `new-material/introduce/${pick.lessonId ?? 'unknown-lesson'}`,
          perItemCap: this.tuning.maxSkillsPerNewItem,
          blockWithNewVocab: item.kind === 'vocab',
        });
      }
    }
    for (const extension of pick.extensions) {
      const readingId =
        extension.skill === 'readingRecall'
          ? chooseReading(extension.item, index, stateByKey, extension.skill)
          : null;
      newCandidates.push({
        item: extension.item,
        skill: extension.skill,
        readingId,
        reason: 'new-material',
        state: null,
        confusion: null,
        substitutedFor: null,
        trace: 'new-material/extend',
        perItemCap: this.tuning.maxSkillsPerNewItem,
        blockWithNewVocab: false,
      });
    }

    // ---- Quotas ----------------------------------------------------------
    const base = normalisePolicy(request.policy, request.screens);
    let dueQuota = base.dueReview;
    let weakQuota = base.weakSkillOrConfusion;
    let newQuota = base.newOrExtending;
    if (backlogSize >= this.tuning.largeBacklog) {
      // A large backlog is not fixed by adding to it. One weak/confusion slot is
      // kept because an unrepaired confusion is itself a source of failed
      // reviews, so dropping it would make the backlog worse, not better.
      newQuota = 0;
      weakQuota = Math.min(weakQuota, 1);
      dueQuota = request.screens - weakQuota;
      notes.push(
        `You have ${backlogSize >= this.tuning.dueFetchLimit ? `at least ${String(this.tuning.dueFetchLimit)}` : String(backlogSize)} reviews waiting, so this series is review only — no new characters until the backlog comes down.`,
      );
    } else if (backlogSize >= this.tuning.moderateBacklog) {
      const reduced = Math.min(newQuota, 1);
      dueQuota += newQuota - reduced;
      newQuota = reduced;
      notes.push(
        `You have ${String(backlogSize)} reviews waiting, so this series leans on review and introduces less new material than usual.`,
      );
    }

    const picker = new Picker(this.tuning);
    const fillAll = (): void => {
      picker.fill(dueList, Math.max(dueQuota - count(picker, 'due-review'), 0));
      picker.fill(
        [...confusionCandidates, ...weakCandidates],
        Math.max(weakQuota - count(picker, 'confusion-repair') - count(picker, 'weak-skill'), 0),
      );
      picker.fill(newCandidates, Math.max(newQuota - count(picker, 'new-material'), 0));
      // Redistribution. Order is deliberate and documented in README.md:
      // weak points first (always available to some degree and always useful),
      // then review, then new material — so a learner with nothing due gets
      // weak-point practice and new material rather than ten new characters.
      const remaining = (): number => request.screens - picker.size;
      if (remaining() > 0) picker.fill([...confusionCandidates, ...weakCandidates], remaining());
      if (remaining() > 0) picker.fill(dueList, remaining());
      if (remaining() > 0) picker.fill(newCandidates, remaining());
    };

    fillAll();

    // Relaxations, cheapest first: practising one item on a second skill is a
    // far smaller compromise than crowding look-alikes into one series.
    let relaxedCap = false;
    let relaxedGuard = false;
    while (picker.size < request.screens) {
      if (picker.capBoost < this.tuning.maxTargetsPerItemCeiling - 1) {
        picker.capBoost += 1;
        relaxedCap = true;
      } else if (!picker.relaxConfusable) {
        picker.relaxConfusable = true;
        relaxedGuard = true;
      } else {
        break;
      }
      fillAll();
    }

    // A last small group may have fewer than ten distinct item/skill pairs.
    // Repeat eligible targets instead of failing or bypassing prerequisites.
    // These remain ordinary spaced-evidence records, never invented mastery.
    if (picker.size > 0 && picker.size < request.screens) {
      const available = [...picker.chosen];
      let cursor = 0;
      while (picker.size < request.screens) {
        const candidate = available[cursor++ % available.length]!;
        picker.chosen.push({...candidate, trace: `${candidate.trace}/small-group-repeat`});
      }
      notes.push('This small group repeats across ten screens; repeated exposure within a series is not spaced mastery.');
    }

    // ---- Notes -----------------------------------------------------------
    if (skippedListening > 0) {
      notes.push(
        'Listening questions are turned off, so they were left out entirely — your listening progress is untouched.',
      );
    }
    const substituted = picker.chosen.filter((c) => c.substitutedFor !== null).length;
    if (substituted > 0) {
      notes.push(
        `Handwriting is turned off, so ${String(substituted)} ${substituted === 1 ? 'screen' : 'screens'} that would have asked you to write use reading recall instead. Those answers count towards reading recall, not handwriting.`,
      );
    }
    if (backlogSize === 0 && states.length > 0) {
      notes.push('Nothing is due for review, so this series works on your weakest points and new material.');
    }
    if (states.length === 0) {
      notes.push('This is a first series, so it introduces one small group of characters rather than ten unrelated ones.');
    }
    if (newQuota > 0 && count(picker, 'new-material') === 0) {
      if (pick.curriculumExhausted) {
        notes.push('There is no new material left in the scripts you have switched on, so the freed screens went to review and weak points.');
      } else if (pick.blockedByPrerequisites.length > 0) {
        notes.push('The next lesson is held back until the earlier one is underway, so the freed screens went to review and weak points.');
      }
    }
    if (relaxedCap) {
      notes.push('There was not enough material for ten different characters, so a few appear more than once on different skills.');
    }
    if (relaxedGuard) {
      notes.push('Some look-alike characters had to appear in the same series.');
    }
    if (picker.size < request.screens) {
      notes.push(
        `Only ${String(picker.size)} of ${String(request.screens)} screens could be filled from the content installed and the modes you have on.`,
      );
    }

    const actual = emptyActual();
    for (const c of picker.chosen) actual[c.reason] += 1;
    const mixDiffers =
      actual['due-review'] !== base.dueReview ||
      actual['weak-skill'] + actual['confusion-repair'] !== base.weakSkillOrConfusion ||
      actual['new-material'] !== base.newOrExtending;
    if (mixDiffers && notes.length === 0) {
      notes.push(describeMix(actual, base));
    }

    // Mark the confusions this series is repairing. Done after selection so a
    // confusion that was considered but not chosen is not marked as handled.
    for (const c of picker.chosen) {
      if (c.confusion !== null) {
        await this.deps.confusions.markRepairScheduled(
          c.confusion.itemId,
          c.confusion.confusedWithItemId,
          c.confusion.skill,
        );
      }
    }

    const ordered = interleave(picker.chosen, (c) => describeCandidate(c, picker), index);
    return {
      targets: ordered.map((c) => toTarget(c, index)),
      actual,
      deviation: notes.length > 0 ? notes.join(' ') : null,
    };
  }

  /**
   * Focused practice.
   *
   * Every target is the chosen item and every reason is `focused`. That reason
   * has to survive all the way to the attempt record, because a correct answer
   * here is weaker evidence than the same answer in a mixed series: the learner
   * already knows which character the question is about. The scheduler and the
   * statistics screens both key off it.
   */
  private selectFocused(
    request: SelectionRequest,
    index: ItemIndex,
    allowed: ReadonlySet<Skill>,
    stateByKey: Map<string, SkillState>,
  ): SelectionResult {
    const actual = emptyActual();
    const focusItemId = request.focusItemId;
    if (focusItemId === null) return { targets: [], actual, deviation: null };
    const item = index.get(focusItemId);
    if (item === undefined) {
      return {
        targets: [],
        actual,
        deviation: 'That character is not in the content installed, so no practice could be built for it.',
      };
    }
    if (!passesGlobalGate(item, index, request.settings)) {
      return {
        targets: [],
        actual,
        deviation:
          'This is a historical form, and historical forms are switched off. Turn them on in Settings to practise it.',
      };
    }

    const combos: Array<{ skill: Skill; readingId: string | null; substitutedFor: Skill | null }> = [];
    for (const skill of candidateSkills(item, index, allowed)) {
      if (skill === 'readingRecall' && item.kind === 'kanji') {
        for (const reading of index.teachableReadings(item)) {
          combos.push({ skill, readingId: String(reading.id), substitutedFor: null });
        }
        continue;
      }
      combos.push({ skill, readingId: null, substitutedFor: null });
    }
    if (request.settings.keyboardOnlyMode && index.applicable(item).handwriting) {
      const substitute = substituteForHandwriting(item, index, allowed);
      if (substitute !== null) {
        combos.push({
          skill: substitute,
          readingId: substitute === 'readingRecall' ? chooseReading(item, index, stateByKey, substitute) : null,
          substitutedFor: 'handwriting',
        });
      }
    }

    const notes = [
      'Focused practice repeats one character, so a right answer here says less about general recognition than the same answer in a mixed series. It is recorded as focused practice for exactly that reason.',
    ];
    if (combos.length === 0) {
      return {
        targets: [],
        actual,
        deviation:
          'None of the question types this character supports are available with your current modes and installed content.',
      };
    }
    if (combos.length < request.screens) {
      notes.push(
        `This character supports ${String(combos.length)} kinds of question, so they repeat across the ten screens.`,
      );
    }

    const targets: SelectionTarget[] = [];
    const lessonId = lessonIdOf(item, index);
    for (let i = 0; i < request.screens; i += 1) {
      // Cycling rather than repeating keeps the same question type off
      // consecutive screens whenever there is more than one to cycle through.
      const combo = combos[i % combos.length];
      if (combo === undefined) break;
      targets.push({
        itemId: asItemId(String(item.id)),
        readingId: combo.readingId,
        skill: combo.skill,
        reason: 'focused',
        state: stateByKey.get(pairKey(item.id, combo.skill, combo.readingId)) ?? null,
        confusion: null,
        substitutedFor: combo.substitutedFor,
        lessonId,
        trace: combo.substitutedFor === null ? 'focused' : 'focused/handwriting-substituted',
      });
      actual.focused += 1;
    }
    return { targets, actual, deviation: notes.join(' ') };
  }
}

function count(picker: Picker, reason: SelectionReason): number {
  return picker.chosen.filter((c) => c.reason === reason).length;
}

function describeCandidate(c: Candidate, picker: Picker): { item: ContentItem; subject: InterleaveSubject } {
  const subjects = picker.subjects();
  const found = subjects.find(
    (s) => String(s.item.id) === String(c.item.id) && s.subject.skill === c.skill,
  );
  return (
    found ?? {
      item: c.item,
      subject: {
        itemId: asItemId(String(c.item.id)),
        skill: c.skill,
        stage: c.state?.stage ?? 'unseen',
        exemptFromConfusableGuard: c.reason === 'confusion-repair' || c.reason === 'focused',
        blockWithNewVocab: c.blockWithNewVocab,
      },
    }
  );
}

function toTarget(c: Candidate, index: ItemIndex): SelectionTarget {
  return {
    itemId: asItemId(String(c.item.id)),
    readingId: c.readingId,
    skill: c.skill,
    reason: c.reason,
    state: c.state,
    confusion: c.confusion,
    substitutedFor: c.substitutedFor,
    lessonId: lessonIdOf(c.item, index),
    trace: c.trace,
  };
}

function lessonIdOf(item: ContentItem, index: ItemIndex): string | null {
  void index;
  return item.lessonId;
}

/**
 * Which skills this session may test.
 *
 * The caller is expected to have narrowed `allowedSkills` already, but the mode
 * flags are re-applied here on purpose. Selecting a listening question in silent
 * mode would write listening progress the learner explicitly asked us not to
 * touch, so this is one of the few places where distrusting the caller is worth
 * the duplication.
 */
export function resolveAllowedSkills(request: SelectionRequest): ReadonlySet<Skill> {
  // An empty list means "the caller is not restricting anything"; the mode flags
  // below still apply.
  const allowed = new Set<Skill>(request.allowedSkills.length > 0 ? request.allowedSkills : SKILLS);
  if (request.settings.silentPractice) allowed.delete('listening');
  if (request.settings.keyboardOnlyMode) allowed.delete('handwriting');
  return allowed;
}

/**
 * What replaces handwriting in keyboard-only mode.
 *
 * Reading recall where the item has a reading, recognition otherwise. Recorded
 * under the substitute skill, never under handwriting.
 *
 * NOT IMPLEMENTED: stroke-order reconstruction, the other substitution the
 * product brief allows. None of the ten question formats in
 * `src/domain/questions.ts` asks the learner to order strokes (`ResponseMode`
 * has an 'ordering' member, but no `QuestionType` uses it), so offering it here
 * would be selecting a target the generator cannot build. When such a format
 * exists this is the single place that needs to change.
 */
export function substituteForHandwriting(
  item: ContentItem,
  index: ItemIndex,
  allowed: ReadonlySet<Skill>,
): Skill | null {
  const applicability = index.applicable(item);
  if (allowed.has('readingRecall') && applicability.readingRecall) return 'readingRecall';
  if (allowed.has('recognition') && applicability.recognition) return 'recognition';
  return null;
}

/**
 * Pick the reading a reading-recall target is about.
 *
 * A reading already under way is preferred over an untouched one, so focused and
 * substituted targets continue what the learner is working on instead of
 * silently opening a new reading.
 */
export function chooseReading(
  item: ContentItem,
  index: ItemIndex,
  stateByKey: Map<string, SkillState>,
  skill: Skill,
): string | null {
  if (item.kind !== 'kanji') return null;
  const readings = index.teachableReadings(item);
  if (readings.length === 0) return null;
  const started = readings.filter((r) => stateByKey.has(pairKey(item.id, skill, String(r.id))));
  const unstarted = readings.find(r => !stateByKey.has(pairKey(item.id, skill, String(r.id))));
  const chosen = unstarted ?? started.slice().sort((a,b) => {
    const left = stateByKey.get(pairKey(item.id,skill,String(a.id)))!;
    const right = stateByKey.get(pairKey(item.id,skill,String(b.id)))!;
    return (left.dueAt ?? '').localeCompare(right.dueAt ?? '');
  })[0] ?? readings[0];
  return chosen === undefined ? null : String(chosen.id);
}

function orderedNewSkills(item: ContentItem, index: ItemIndex, allowed: ReadonlySet<Skill>): Skill[] {
  const available = new Set(candidateSkills(item, index, allowed));
  return NEW_ITEM_SKILL_ORDER.filter((s) => available.has(s));
}

/** Unrepaired confusions first, then the most frequent, then the most recent. */
function orderConfusions(confusions: readonly ConfusionRecord[]): ConfusionRecord[] {
  return [...confusions].sort((a, b) => {
    if (a.repairScheduled !== b.repairScheduled) return a.repairScheduled ? 1 : -1;
    if (a.count !== b.count) return b.count - a.count;
    if (a.lastAt !== b.lastAt) return a.lastAt < b.lastAt ? 1 : -1;
    return String(a.itemId).localeCompare(String(b.itemId));
  });
}

function describeMix(actual: Record<SelectionReason, number>, policy: SelectionPolicy): string {
  const weak = actual['weak-skill'] + actual['confusion-repair'];
  return `This series is ${String(actual['due-review'])} review, ${String(weak)} weak-point practice and ${String(actual['new-material'])} new, instead of the usual ${String(policy.dueReview)}/${String(policy.weakSkillOrConfusion)}/${String(policy.newOrExtending)}.`;
}

/** Settings-driven convenience wrapper, so callers do not rebuild the policy by hand. */
export function policyFromSettings(settings: Settings): SelectionPolicy {
  return normalisePolicy(settings.selectionPolicy, 10);
}

export type { ItemId };

function currentReading(item: ContentItem, readingId: string | null, index: ItemIndex): boolean {
  return item.kind !== 'kanji' || readingId === null || index.teachableReadings(item).some(r => String(r.id) === readingId);
}
