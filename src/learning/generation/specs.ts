import { QUESTION_TYPES, type QuestionSpec, type QuestionType } from '@/domain';

/**
 * The QuestionSpec table.
 *
 * This is the single authority on what each of the ten formats claims to
 * measure, and it is rendered verbatim in About & Science — so the prose has to
 * be true, not marketing. Three rules govern the entries:
 *
 *  1. `assesses` names the ONE skill the format is credited to. A format that
 *     shows options never claims `readingRecall`, because picking a reading out
 *     of four is recognition; `SKILL_DESCRIPTIONS` in domain/skills.ts draws
 *     that line and this table obeys it.
 *  2. `evidence` is 'weak' for every four-option format, because eliminating
 *     three wrong options is not the same as producing an answer. The two
 *     exceptions are argued in place.
 *  3. `ambiguityChecks` lists preconditions the generator must actually verify.
 *     Every line here is implemented in validate.ts and has a test; a check
 *     that is only aspirational does not belong in this table.
 */
const SPECS: Record<QuestionType, QuestionSpec> = {
  'audio-to-character-choice': {
    type: 'audio-to-character-choice',
    title: 'Hear it, pick the character',
    // Sound → character is the listening skill. It is listed as listening rather
    // than recognition so that listening has a gentle entry format at all: the
    // only other audio format is unaided typing, which is far too hard first.
    assesses: 'listening',
    alsoExercises: [],
    direction: 'audio-to-glyph',
    response: 'choice',
    inputScript: 'none',
    evidence: 'weak',
    allowedHints: ['audio-replay', 'meaning', 'reveal-answer'],
    scoring:
      'Correct on the first try, with no reveal, counts as unaided success. Replaying the recording is not a hint — hearing a clip more than once is part of listening — so replays never reduce the credit, though they are recorded. Because three wrong options are visible, this counts as weak evidence and moves the review interval less than typing what you heard.',
    ambiguityChecks: [
      'Every option is in the same script, and the prompt says which script, so a katakana twin of the answer is never silently also correct.',
      'If the answer is a character with a sound-alike (じ/ぢ, ず/づ, お/を), every sound-alike on screen is marked correct and the note explains why. A sound-alike is never shown as a wrong option.',
      'No two options are the same character, and no option is a valid answer other than the ones marked correct.',
      'Only generated when a real recording for this item verified on disk. There is no speech synthesis fallback.',
    ],
    silentSafe: false,
    requiresPointer: false,
    typicalMs: 6000,
  },

  'romaji-to-kana-choice': {
    type: 'romaji-to-kana-choice',
    title: 'Rōmaji to kana',
    assesses: 'recognition',
    alsoExercises: [],
    direction: 'romaji-to-glyph',
    response: 'choice',
    inputScript: 'none',
    evidence: 'weak',
    allowedHints: ['reveal-answer'],
    scoring:
      'Correct on the first try with no reveal counts as unaided success, at weak evidence. This is the most heavily supported format in the app: the rōmaji does half the work, so it is used for brand-new characters and withdrawn early. It never counts towards reading recall, because nothing was recalled — the sound was printed on the screen.',
    ambiguityChecks: [
      'The prompt states the script ("hiragana" or "katakana"), because "ka" is equally a correct description of か and カ.',
      'All options come from the stated script.',
      'No option shares an accepted spelling with the answer, so a rōmaji prompt of "ji" can never have both じ and ぢ on screen as one right and one wrong answer.',
    ],
    silentSafe: true,
    requiresPointer: false,
    typicalMs: 5000,
  },

  'character-to-reading-choice': {
    type: 'character-to-reading-choice',
    title: 'Character to reading, with options',
    // Deliberately recognition, not readingRecall: domain/skills.ts defines
    // reading recall as producing the reading "with no options shown".
    assesses: 'recognition',
    alsoExercises: [],
    direction: 'glyph-to-reading',
    response: 'choice',
    inputScript: 'none',
    evidence: 'weak',
    allowedHints: ['meaning', 'component-breakdown', 'reveal-answer'],
    scoring:
      'Correct on the first try with no reveal counts as unaided success, at weak evidence. Credited to recognition, never to reading recall, because the reading was on the screen to be picked out rather than produced.',
    ambiguityChecks: [
      'A kanji is never asked bare. The question is always posed inside a word, the word is shown as context, and the specific reading being tested is recorded on the question.',
      'No option is also a correct reading of the character in the word that was shown.',
      'No two options display the same text.',
      'For kana, every option maps to exactly one character, so two options can never share a rōmaji spelling.',
    ],
    silentSafe: true,
    requiresPointer: false,
    typicalMs: 7000,
  },

  'character-to-reading-typed': {
    type: 'character-to-reading-typed',
    title: 'Character to reading, typed',
    assesses: 'readingRecall',
    alsoExercises: [],
    direction: 'glyph-to-reading',
    response: 'typed',
    inputScript: 'romaji',
    evidence: 'strong',
    // 'romaji-scaffold' is absent on purpose: the scaffold IS the answer here.
    allowedHints: ['reveal-answer'],
    scoring:
      'You see the character and type its reading in rōmaji with nothing else on screen. Correct on the first try with no reveal is strong evidence and moves the review interval the furthest. Every spelling your keyboard might need is accepted (shi and si, fu and hu, ji and zi), so you are never marked wrong for typing what an IME expects.',
    ambiguityChecks: [
      'The rōmaji scaffold is withheld outright, not merely hidden: copying a rōmaji string that is printed on the screen is not recall, and this format would otherwise accept the copy as reading recall.',
      'Kanji are refused. A bare 日 has several readings, so "type the reading of 日" has no single answer; kanji reading recall is asked by the in-a-word format instead.',
      'Only characters with a settled rōmaji value are used; the answer set is the character’s full accepted-input list.',
    ],
    silentSafe: true,
    requiresPointer: false,
    typicalMs: 9000,
  },

  'match-pairs': {
    type: 'match-pairs',
    title: 'Match three pairs',
    assesses: 'recognition',
    alsoExercises: [],
    direction: 'glyph-to-reading',
    response: 'matching',
    inputScript: 'none',
    evidence: 'weak',
    allowedHints: ['reveal-answer'],
    scoring:
      'Three characters and three readings on one screen. Each pair is graded on its own, and the screen records how many choices were still open when you made each one. The last pair of three is usually forced — once two are placed there is nothing left to decide — so it is recorded as forced and counted as the weakest kind of evidence. The screen is worth one screen of XP, not three.',
    ambiguityChecks: [
      'No two readings on the screen are the same, otherwise two different characters would both be legitimate matches.',
      'All three characters come from one script, and no two of them are sound-alikes of each other.',
      'Each pair carries its own result, with the number of remaining choices and a forced-by-elimination flag, so the scheduler is never handed a forced answer as if it were a free one.',
      'Operable entirely from the keyboard as select-a-character then select-a-reading. Dragging is never required.',
    ],
    silentSafe: true,
    requiresPointer: false,
    typicalMs: 22000,
  },

  'audio-to-typed': {
    type: 'audio-to-typed',
    title: 'Hear it, type it',
    assesses: 'listening',
    // Typing Japanese needs an IME, which is its own procedural skill. It is
    // counted separately so it can never inflate a listening or reading score.
    alsoExercises: ['imeInput'],
    direction: 'audio-to-reading',
    response: 'typed',
    inputScript: 'kana',
    evidence: 'strong',
    allowedHints: ['audio-replay', 'meaning', 'reveal-answer'],
    scoring:
      'You hear a recording and type what you heard in kana, with nothing shown. Correct on the first try with no reveal is strong evidence for listening. Replays are free and recorded. Your use of the IME is counted in a separate set of counters and is never shown as character mastery.',
    ambiguityChecks: [
      'The prompt states which script the word is normally written in, and the other script is accepted as well, with a note. This question tests hearing, so spelling the sound in the other kana script is not treated as a listening failure.',
      'Sound-alikes inside the word are all accepted: a word containing じ also accepts ぢ, and ず also accepts づ. は and へ are not expanded this way, because inside a word they are simply ha and he — only the standalone particles sound different from their spelling.',
      'The rōmaji scaffold is withheld. Typing the printed rōmaji into an IME produces the kana without ever recalling it.',
      'Only generated when a real recording for this item verified on disk.',
    ],
    silentSafe: false,
    requiresPointer: false,
    typicalMs: 14000,
  },

  'prompt-to-handwriting': {
    type: 'prompt-to-handwriting',
    title: 'Write it by hand',
    assesses: 'handwriting',
    alsoExercises: [],
    direction: 'romaji-to-glyph',
    response: 'handwriting',
    inputScript: 'none',
    evidence: 'strong',
    allowedHints: ['stroke-count', 'first-stroke', 'reference-animation', 'component-breakdown', 'reveal-answer'],
    scoring:
      'You are given the sound or the word and write the character with no model to copy. Identity, stroke count, stroke order, stroke direction and shape are reported separately and never averaged into one number. When the strokes do not support a decision the result is "not sure", which is not counted as a memory failure. Asking for the stroke count, the first stroke or the animation is a hint and removes the unaided credit for that attempt.',
    ambiguityChecks: [
      'The instruction states the script to write in, because a rōmaji prompt describes a hiragana and a katakana character equally well.',
      'The model shown in feedback uses the textbook face, so a character whose printed form differs from its handwritten form (き, さ, ふ) is never presented with the wrong shape to copy.',
      'Only generated when validated stroke reference data for the character verified on disk. There is no fallback that guesses stroke order.',
      'Not generated in keyboard-only mode; the substitution is chosen by the selector, not faked here.',
    ],
    silentSafe: true,
    requiresPointer: true,
    typicalMs: 26000,
  },

  'confusable-discrimination': {
    type: 'confusable-discrimination',
    title: 'Tell them apart',
    assesses: 'recognition',
    alsoExercises: [],
    direction: 'reading-to-glyph',
    response: 'choice',
    inputScript: 'none',
    // The one four-option format rated above 'weak'. The options are the
    // target's documented confusables rather than arbitrary characters, so
    // elimination is no longer cheap: this is the hardest option set that can
    // legitimately be assembled for the character.
    evidence: 'moderate',
    allowedHints: ['stroke-count', 'reveal-answer'],
    scoring:
      'Every wrong option is a character learners actually mistake this one for — シ against ツ, ソ against ン, ね against れ and わ. Getting it right therefore says more than a four-option question with unrelated options, so it is rated moderate rather than weak evidence. The wrong choice is recorded as a specific confusion, which is what schedules a repair question later.',
    ambiguityChecks: [
      'Only generated when the character actually has recorded confusables; a plausible-looking set is never invented.',
      'The instruction names the script, so a cross-script look-alike (り against リ) is a genuinely wrong answer rather than a second right one.',
      'Every option records why it was chosen, so the confusion statistics mean something.',
    ],
    silentSafe: true,
    requiresPointer: false,
    typicalMs: 8000,
  },

  'word-reading': {
    type: 'word-reading',
    title: 'Read a word',
    assesses: 'readingRecall',
    alsoExercises: ['imeInput'],
    direction: 'glyph-to-reading',
    response: 'typed',
    inputScript: 'kana',
    allowedHints: ['meaning', 'component-breakdown', 'reveal-answer'],
    evidence: 'strong',
    scoring:
      'A short word is shown and you produce its reading. For a word written with kanji you type the reading in kana. For a word written entirely in kana you type it in rōmaji instead — typing back kana that is already on the screen would be copying, not reading. Correct on the first try with no reveal is strong evidence.',
    ambiguityChecks: [
      'A word whose reading is already visible in its own spelling is refused in kana mode, because the answer would be on the screen.',
      'The prompt states the script the answer is wanted in, and both kana scripts are accepted for a kanji word’s reading, with a note.',
      'The rōmaji scaffold is withheld in both modes: in rōmaji mode it is the answer, and in kana mode it is an IME recipe for the answer.',
      'Long-vowel spellings are accepted in every documented form (kōhī, koohii, kohi) so a macron convention is never the thing being graded.',
    ],
    silentSafe: true,
    requiresPointer: false,
    typicalMs: 13000,
  },

  'kanji-in-word-context': {
    type: 'kanji-in-word-context',
    title: 'Kanji reading in a word',
    assesses: 'readingRecall',
    alsoExercises: ['imeInput'],
    direction: 'glyph-to-reading',
    response: 'typed',
    inputScript: 'kana',
    evidence: 'strong',
    allowedHints: ['meaning', 'component-breakdown', 'reveal-answer'],
    scoring:
      'The word is shown, and you produce the reading that one kanji has in that word. The specific reading is recorded, so 日 in 日本 and 日 in 今日 are tracked as separate things to know rather than as one character that is either learned or not. Correct on the first try with no reveal is strong evidence for that reading.',
    ambiguityChecks: [
      'Never asked without a word. A kanji on its own has several readings, so "the reading" of a bare character is not a question with one answer.',
      'Only asked for readings that at least one taught word actually demonstrates; a reading with no word to show it in is not taught and not tested.',
      'Both kana scripts are accepted for the reading, with a note, since dictionaries write on-readings in katakana and kun-readings in hiragana.',
      'Sound changes in the word (一本 いっぽん) are carried in the accepted answers rather than marked wrong.',
    ],
    silentSafe: true,
    requiresPointer: false,
    typicalMs: 15000,
  },
};

/**
 * Frozen so a feature cannot quietly "tune" a spec at runtime and make About &
 * Science describe behaviour the engine no longer has.
 */
export const QUESTION_SPECS: Readonly<Record<QuestionType, QuestionSpec>> = Object.freeze(
  Object.fromEntries(QUESTION_TYPES.map((t) => [t, Object.freeze(SPECS[t])])) as Record<QuestionType, QuestionSpec>,
);

export function specFor(type: QuestionType): QuestionSpec {
  return QUESTION_SPECS[type];
}

/** Ordered list, for rendering the table in About & Science. */
export const QUESTION_SPEC_LIST: readonly QuestionSpec[] = Object.freeze(
  QUESTION_TYPES.map((t) => QUESTION_SPECS[t]),
);
