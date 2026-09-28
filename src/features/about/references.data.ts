/**
 * references.data.ts — the experimental evidence Kansei cites, with the honest
 * version of what each study does and does not establish.
 *
 * SCOPE: this file holds *experimental psychology of learning* only. Teaching
 * material, dictionaries, corpora, stroke data, audio and fonts live in
 * `sources.data.ts`, and the two are kept apart on purpose — see the header of
 * that file for why.
 *
 * WHAT IS VERIFIED. Every bibliographic field below (title, authors, year,
 * journal, volume, issue, pages, DOI, PMID) was fetched from an authoritative
 * machine-readable record and checked field by field:
 *   - Crossref REST API   https://api.crossref.org/works/<doi>
 *   - NCBI E-utilities    esummary.fcgi / efetch.fcgi (db=pubmed, db=pmc)
 *   - OpenAlex            https://api.openalex.org/works/doi:<doi>   (cross-check)
 *   - Unpaywall           https://api.unpaywall.org/v2/<doi>         (open-access status)
 * The verification date is recorded per entry in `metadataVerifiedOn`, and every
 * correction made against the list Kansei was originally drafted from is recorded
 * in `METADATA_CORRECTIONS` below.
 *
 * WHAT IS NOT VERIFIED. Where Kansei's own prose asserts a methodological detail
 * that could not be confirmed from an openly readable record (a paywalled method
 * section, for instance), that detail is listed in `unverifiedDetails` rather
 * than quietly presented as established. The About screen renders that list.
 *
 * The `summary`, `informsFeature` and `limitations` fields are written by the
 * Kansei authors in plain language for a learner with no psychology background.
 * They are not quotations, and no paper text is bundled here: only metadata and
 * our own description. Follow `url` to read the source.
 *
 * This module is pure data with no imports, so the About screen works fully
 * offline. The only online part is the learner choosing to open a link.
 */

/** One author, as recorded by the authoritative bibliographic record. */
export interface ReferenceAuthor {
  family: string;
  given: string;
}

/**
 * How strong a claim Kansei is entitled to make *from this reference, for the
 * feature named in `informsFeature`*. It grades Kansei's claim, not the quality
 * of the paper:
 *
 *  - `research-supported`    the paper tests something close to what Kansei does,
 *                            and the app's behaviour follows from its result.
 *  - `product-interpretation` the finding is solid but Kansei is extrapolating it
 *                            to a population, material or input modality the study
 *                            did not cover. The extrapolation is ours, not theirs.
 *  - `needs-evaluation`      Kansei's feature is a design guess in the neighbourhood
 *                            of the evidence; the specific implementation is untested.
 */
export type ClaimTier = 'research-supported' | 'product-interpretation' | 'needs-evaluation';

export interface ScienceReference {
  /** Stable key, `<first author lowercase><year>`. Used for deep links and tests. */
  id: string;
  authors: readonly ReferenceAuthor[];
  /**
   * The year this work is conventionally cited by — the year of the print issue
   * carrying the volume/issue/pages given here. Where online-first publication
   * fell in an earlier year, `publicationNote` says so.
   */
  year: number;
  /** Full published title, including any subtitle. */
  title: string;
  /** Journal name exactly as the authoritative record spells it. */
  journal: string;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  doi: string;
  /** Stable resolver link. Always the DOI resolver. */
  url: string;
  /** PubMed id, or null where the work is not indexed in PubMed. */
  pmid: string | null;
  /** A legally free full text, where one exists. Null means paywalled. */
  openAccessUrl: string | null;
  /** Set when the print year and the online-first year differ, or dates need care. */
  publicationNote: string | null;
  /** 2-4 sentences, our words: what the work actually found. */
  summary: string;
  /** Which part of Kansei this informs. */
  informsFeature: string;
  /** What it does NOT establish. This matters more than the finding. */
  limitations: string;
  claimTier: ClaimTier;
  /** Which authoritative records the metadata above was checked against. */
  metadataVerifiedAgainst: readonly string[];
  /** ISO-8601 date (UTC) on which that check was performed. */
  metadataVerifiedOn: string;
  /**
   * Method details that Kansei's own `summary`/`limitations` text names but that
   * could NOT be confirmed from an openly readable record. Surfaced in the UI so
   * the app never launders an unverified detail as a verified one. Empty array
   * means everything asserted was confirmed from an open record.
   */
  unverifiedDetails: readonly string[];
}

const VERIFIED_ON = '2026-09-29';

const CROSSREF = 'Crossref REST API (api.crossref.org)';
const PUBMED = 'NCBI PubMed E-utilities (esummary + efetch)';
const OPENALEX = 'OpenAlex API (api.openalex.org)';
const UNPAYWALL = 'Unpaywall API (api.unpaywall.org)';

export const SCIENCE_REFERENCES: readonly ScienceReference[] = Object.freeze([
  Object.freeze({
    id: 'dunlosky2013',
    authors: Object.freeze([
      Object.freeze({ family: 'Dunlosky', given: 'John' }),
      Object.freeze({ family: 'Rawson', given: 'Katherine A.' }),
      Object.freeze({ family: 'Marsh', given: 'Elizabeth J.' }),
      Object.freeze({ family: 'Nathan', given: 'Mitchell J.' }),
      Object.freeze({ family: 'Willingham', given: 'Daniel T.' }),
    ]),
    year: 2013,
    title:
      'Improving Students’ Learning With Effective Learning Techniques: Promising Directions From Cognitive and Educational Psychology',
    journal: 'Psychological Science in the Public Interest',
    volume: '14',
    issue: '1',
    pages: '4-58',
    doi: '10.1177/1529100612453266',
    url: 'https://doi.org/10.1177/1529100612453266',
    pmid: '26173288',
    openAccessUrl: null,
    publicationNote:
      'Crossref and OpenAlex both truncate the title at the colon; the full title with subtitle comes from the PubMed record (PMID 26173288). Print issue January 2013, online first 8 January 2013.',
    summary:
      'A long review monograph that grades ten study techniques students actually use, judging each on whether its benefit holds up across different learning conditions, different students, different materials and different kinds of test. Practice testing (answering questions from memory) and distributed practice (spreading study over time) came out top, rated high utility because their benefits generalise widely. Elaborative interrogation, self-explanation and interleaved practice were rated moderate — promising, but with thinner evidence. Five techniques were rated low utility: summarising, highlighting, the keyword mnemonic, making mental images of text, and rereading — which includes two of the things students report doing most.',
    informsFeature:
      'The shape of the whole review loop. Kansei asks you to produce answers from memory and spreads those attempts across days, rather than showing you a kana chart to reread. It is also why there is no highlighter-style "mark this as known" shortcut anywhere in the app.',
    limitations:
      'This is a narrative review with utility ratings assigned by its authors, not a pooled statistical meta-analysis, so the ratings are expert judgement over a literature rather than a single measured effect. That literature is overwhelmingly English-language classroom and laboratory work on verbal and text material; it contains almost nothing on learning a non-alphabetic writing system. It gives no guidance at all on concrete design numbers — how many characters to introduce at once, or how long an interval should be.',
    claimTier: 'research-supported',
    metadataVerifiedAgainst: Object.freeze([CROSSREF, PUBMED, OPENALEX]),
    metadataVerifiedOn: VERIFIED_ON,
    unverifiedDetails: Object.freeze([]),
  }),

  Object.freeze({
    id: 'karpicke2008',
    authors: Object.freeze([
      Object.freeze({ family: 'Karpicke', given: 'Jeffrey D.' }),
      Object.freeze({ family: 'Roediger', given: 'Henry L.' }),
    ]),
    year: 2008,
    title: 'The Critical Importance of Retrieval for Learning',
    journal: 'Science',
    volume: '319',
    issue: '5865',
    pages: '966-968',
    doi: '10.1126/science.1152408',
    url: 'https://doi.org/10.1126/science.1152408',
    pmid: '18276894',
    openAccessUrl: null,
    publicationNote:
      'Published 15 February 2008. Unpaywall reports no open-access copy. PubMed also lists a published Comment on this article: Science 2008 Jun 27;320(5884):1720, doi:10.1126/science.320.5884.1720a.',
    summary:
      'University students learned foreign-language vocabulary pairs by studying and being tested. The experiment then varied what happened to an item *after* the student had recalled it correctly once: it was either kept in repeated study, kept in repeated testing, kept in both, or dropped from both. A week later, extra studying of an already-recalled item did essentially nothing for recall, while continuing to test it produced a large gain — so dropping an item from testing as soon as it was answered right once badly damaged later retention. Students’ own predictions of what they would remember were uncorrelated with what they actually remembered.',
    informsFeature:
      'Why Kansei keeps bringing back characters and words you have already answered correctly instead of retiring them on a first success, and why a learner’s self-rating ("I know this one") can adjust scheduling but never removes an item from the queue.',
    limitations:
      'This is one laboratory experiment with adult university students, simple two-language word pairs, and a single one-week retention interval. It says nothing about handwriting, nothing about recognising versus producing a character, and nothing about how a schedule should behave over months. The finding that learners misjudge their own retention was measured on these materials, not on script learning.',
    claimTier: 'research-supported',
    metadataVerifiedAgainst: Object.freeze([CROSSREF, PUBMED, OPENALEX, UNPAYWALL]),
    metadataVerifiedOn: VERIFIED_ON,
    unverifiedDetails: Object.freeze([
      'This study is usually described as using Swahili–English word pairs. The openly readable abstract says only "foreign language vocabulary words"; the specific language pair is in the paywalled method section and was not confirmed from an open record, so Kansei’s summary above says "foreign-language vocabulary pairs" instead.',
    ]),
  }),

  Object.freeze({
    id: 'butler2008',
    authors: Object.freeze([
      Object.freeze({ family: 'Butler', given: 'Andrew C.' }),
      Object.freeze({ family: 'Roediger', given: 'Henry L.' }),
    ]),
    year: 2008,
    title: 'Feedback enhances the positive effects and reduces the negative effects of multiple-choice testing',
    journal: 'Memory & Cognition',
    volume: '36',
    issue: '3',
    pages: '604-616',
    doi: '10.3758/MC.36.3.604',
    url: 'https://doi.org/10.3758/MC.36.3.604',
    pmid: '18491500',
    openAccessUrl: null,
    publicationNote:
      'Journal title checked: both Crossref and PubMed give "Memory & Cognition" with an ampersand (PubMed abbreviation "Mem Cognit", ISSN 0090-502X) — not "Memory and Cognition". Crossref normalises the DOI to lowercase (10.3758/mc.36.3.604); DOIs are case-insensitive and the registered form 10.3758/MC.36.3.604 resolves identically. PubMed abbreviates the page range as 604-16; the full range is 604-616.',
    summary:
      'Participants read prose passages and then took a multiple-choice test with immediate feedback, delayed feedback, or no feedback at all. The point is that multiple-choice testing is double-edged: answering the question helps you remember, but reading the wrong options exposes you to plausible-looking misinformation, and picking a wrong option can leave you believing it. Compared with getting no feedback, both immediate and delayed feedback raised correct answers on a later short-answer test *and* reduced intrusions — answers carried over from the wrong options of the earlier multiple-choice test. In other words, feedback is what stops a wrong option from being learned.',
    informsFeature:
      'Kansei always reveals the correct answer immediately after a multiple-choice question, including when you got it right, and never lets a wrong option pass without correction. It is also why multiple-choice is used as a way in rather than as the only question type.',
    limitations:
      'The materials were English prose passages and the participants were adults, tested over a laboratory-length delay rather than months. It does not show that visually confusable character options (シ against ツ, ね against れ) behave like factual misinformation lures, nor how fast or how prominent feedback has to be on a phone screen to have the same effect. It compares feedback against no feedback; it does not tell you the best wording or timing for a correction message.',
    claimTier: 'research-supported',
    metadataVerifiedAgainst: Object.freeze([CROSSREF, PUBMED]),
    metadataVerifiedOn: VERIFIED_ON,
    unverifiedDetails: Object.freeze([]),
  }),

  Object.freeze({
    id: 'brunmair2019',
    authors: Object.freeze([
      Object.freeze({ family: 'Brunmair', given: 'Matthias' }),
      Object.freeze({ family: 'Richter', given: 'Tobias' }),
    ]),
    year: 2019,
    title: 'Similarity matters: A meta-analysis of interleaved learning and its moderators',
    journal: 'Psychological Bulletin',
    volume: '145',
    issue: '11',
    pages: '1029-1052',
    doi: '10.1037/bul0000209',
    url: 'https://doi.org/10.1037/bul0000209',
    pmid: '31556629',
    openAccessUrl: null,
    publicationNote: 'November 2019 issue; online first (epub) 26 September 2019.',
    summary:
      'A meta-analysis of interleaving — mixing item types during practice instead of practising one type in a block — pooling 59 studies, 238 effect sizes nested in 158 samples. The overall interleaving effect was moderate (Hedges’ g = 0.42), but the average is misleading, because the effect depended heavily on what was being learned: strongest for paintings (g = 0.67) and other visual material, small for mathematics tasks (g = 0.34), ambiguous and non-significant for expository texts and for tastes, and actually REVERSED for learning words, where blocking beat interleaving (g = −0.39). A metaregression found interleaving helped more when the categories being learned were similar to each other, when items within a category were less similar to each other, and when the material was more complex. The authors’ own conclusion is that interleaving works for inductive learning but the setting and material type must be considered, and that it should be used with caution for expository texts and words.',
    informsFeature:
      'How Kansei mixes practice, and where it deliberately does not. Because the word-learning result favoured blocking, new vocabulary is introduced in blocks rather than shuffled in. Interleaving is reserved for the case the moderators support: visually confusable characters, where categories are similar to one another and telling them apart is the whole skill.',
    limitations:
      'This is emphatically not a finding that interleaving is generally better — for word learning the meta-analysis found blocking better, which is directly relevant to vocabulary. Japanese script was not one of its material categories, so Kansei’s decision to treat confusable kana as the "similar categories, complex material" case is our inference from the moderators, not a result reported in the paper. Like any meta-analysis it also inherits publication bias and the heterogeneity of the underlying study designs, and most of the pooled studies used short laboratory retention intervals.',
    claimTier: 'product-interpretation',
    metadataVerifiedAgainst: Object.freeze([CROSSREF, PUBMED]),
    metadataVerifiedOn: VERIFIED_ON,
    unverifiedDetails: Object.freeze([]),
  }),

  Object.freeze({
    id: 'wiley2021',
    authors: Object.freeze([
      Object.freeze({ family: 'Wiley', given: 'Robert W.' }),
      Object.freeze({ family: 'Rapp', given: 'Brenda' }),
    ]),
    year: 2021,
    title: 'The Effects of Handwriting Experience on Literacy Learning',
    journal: 'Psychological Science',
    volume: '32',
    issue: '7',
    pages: '1086-1103',
    doi: '10.1177/0956797621993111',
    url: 'https://doi.org/10.1177/0956797621993111',
    pmid: '34184564',
    openAccessUrl: null,
    publicationNote:
      'July 2021 issue; online first (epub) 29 June 2021. An author manuscript exists as PMC8641140, but Unpaywall reports the article is not open access and the PMC full text was not retrievable, so `openAccessUrl` is null rather than a link that may not open.',
    summary:
      'Forty-two adults learned the letters of a writing system unfamiliar to them, assigned to one of three practice conditions: handwriting the letters, typing them, or studying them visually. Handwriting produced faster learning and transferred more widely to tasks the participants had not practised than the two non-motor conditions did. The study also asked what kind of memory handwriting builds, and found that only the handwriting group showed evidence of both motor representations and abstract, modality-independent letter representations — so the benefit is not merely muscle memory for the act of writing.',
    informsFeature:
      'Why writing is a first-class exercise in Kansei rather than an optional extra: stroke-order tracing and free writing are part of the normal review loop, and a character is not treated as learned on recognition alone.',
    limitations:
      'This is a single laboratory training study, N = 42, with adults learning an unfamiliar alphabet over a short regime. It does NOT establish that drawing Japanese characters with a fingertip on a phone screen recruits the same motor learning as writing with a pen: finger-on-glass differs in grip, friction, scale, resistance and visual feedback, and none of those were manipulated here. It also does not extend to kanji, which are structurally far more complex than single alphabetic letters. Kansei’s on-screen writing exercise is an extrapolation from this work and has not itself been evaluated.',
    claimTier: 'product-interpretation',
    metadataVerifiedAgainst: Object.freeze([CROSSREF, PUBMED, OPENALEX, UNPAYWALL]),
    metadataVerifiedOn: VERIFIED_ON,
    unverifiedDetails: Object.freeze([
      'This study is usually described as training adults on ARABIC letters, with the handwriting condition using pen on paper. The openly readable abstract names neither the script nor the writing implement — it says only "letter learning" in "adults (N = 42)" — and no open full text was reachable, so Kansei’s summary says "a writing system unfamiliar to them" and the limitation above argues from what the abstract does establish (adults, unfamiliar letters, a motor vs non-motor contrast) rather than from the unverified pen-on-paper detail.',
    ]),
  }),

  Object.freeze({
    id: 'sailer2020',
    authors: Object.freeze([
      Object.freeze({ family: 'Sailer', given: 'Michael' }),
      Object.freeze({ family: 'Homner', given: 'Lisa' }),
    ]),
    year: 2020,
    title: 'The Gamification of Learning: a Meta-analysis',
    journal: 'Educational Psychology Review',
    volume: '32',
    issue: '1',
    pages: '77-112',
    doi: '10.1007/s10648-019-09498-w',
    url: 'https://doi.org/10.1007/s10648-019-09498-w',
    pmid: null,
    openAccessUrl: 'https://link.springer.com/article/10.1007/s10648-019-09498-w',
    publicationNote:
      'Cited as 2020 because that is the print issue (volume 32, issue 1, March 2020); Crossref records online-first publication on 15 August 2019, so the same work is sometimes cited as 2019. Not indexed in PubMed — it is an educational-psychology journal outside MEDLINE’s scope — so there is no PMID. Open access under CC BY 4.0 per the Crossref licence record and Unpaywall.',
    summary:
      'A meta-analysis of experiments adding game elements to instruction, pooled separately for three kinds of outcome. Random-effects models found positive effects on cognitive learning outcomes (g = 0.49, 95% CI [0.30, 0.69], 19 studies, N = 1686), motivational outcomes (g = 0.36, 95% CI [0.18, 0.54], 16 studies, N = 2246) and behavioural outcomes (g = 0.25, 95% CI [0.04, 0.46], 9 studies, N = 951) — effects the authors themselves characterise as small. The cognitive effect held up when the analysis was restricted to studies with high methodological rigour; the motivational and behavioural effects were less stable under that restriction. Effect sizes were heterogeneous, and of the moderators tested, including game fiction and social interaction significantly moderated behavioural outcomes, with fiction and competition-plus-collaboration the more effective combinations.',
    informsFeature:
      'The existence of a light progress layer at all — streaks, XP and level-up moments — and the decision to keep it modest and dismissible rather than central to the app.',
    limitations:
      '"Gamification" in this literature is not one intervention: it covers badges, points, leaderboards, narrative, avatars and competition in wildly different combinations, and the substantial heterogeneity means the pooled average says very little about any specific design. It validates NO particular XP formula, streak rule, or level curve — Kansei’s numbers are a design choice with no evidence behind them. The motivational and behavioural effects, which are the ones a streak is meant to act on, were precisely the least robust, and the behavioural pool is only 9 studies. Nothing here speaks to long-term use or to what happens when a streak breaks.',
    claimTier: 'needs-evaluation',
    metadataVerifiedAgainst: Object.freeze([CROSSREF, OPENALEX, UNPAYWALL]),
    metadataVerifiedOn: VERIFIED_ON,
    unverifiedDetails: Object.freeze([]),
  }),
]);

/**
 * Corrections made while verifying the reference list Kansei was first drafted
 * from, against the authoritative records. Kept in the app rather than only in a
 * commit message, because "we checked and here is what was wrong" is the part of
 * a citation list that is normally invisible.
 */
export interface MetadataCorrection {
  referenceId: string;
  field: string;
  /** What the draft list said. */
  was: string;
  /** What the authoritative record says. */
  now: string;
  /** Which record settled it. */
  authority: string;
}

export const METADATA_CORRECTIONS: readonly MetadataCorrection[] = Object.freeze([
  Object.freeze({
    referenceId: 'dunlosky2013',
    field: 'title',
    was: 'Improving Students’ Learning With Effective Learning Techniques… (subtitle elided)',
    now: 'Improving Students’ Learning With Effective Learning Techniques: Promising Directions From Cognitive and Educational Psychology',
    authority: 'PubMed PMID 26173288 (Crossref and OpenAlex both truncate the title at the colon)',
  }),
  Object.freeze({
    referenceId: 'karpicke2008',
    field: 'pmid',
    was: 'not supplied',
    now: '18276894',
    authority: 'PubMed esearch on 10.1126/science.1152408[doi], confirmed by efetch',
  }),
  Object.freeze({
    referenceId: 'butler2008',
    field: 'journal',
    was: 'unstated in the draft list; flagged as possibly "Memory and Cognition"',
    now: 'Memory & Cognition (ampersand; PubMed abbreviation "Mem Cognit", ISSN 0090-502X)',
    authority: 'Crossref container-title and PubMed fulljournalname',
  }),
  Object.freeze({
    referenceId: 'butler2008',
    field: 'pages',
    was: '604-16 (the form PubMed prints)',
    now: '604-616',
    authority: 'Crossref page field',
  }),
  Object.freeze({
    referenceId: 'sailer2020',
    field: 'year',
    was: '2020',
    now: '2020 kept, with a note: the print issue is March 2020 (vol 32 no 1) but Crossref records online-first publication on 15 August 2019, so 2019 is also a correct citation year for the same article.',
    authority: 'Crossref published-print vs published-online',
  }),
  Object.freeze({
    referenceId: 'sailer2020',
    field: 'pmid',
    was: 'not supplied',
    now: 'none — the article is not indexed in PubMed',
    authority: 'PubMed esearch returned no record for this DOI',
  }),
]);

/** Lookup by id. Returns undefined for an unknown id rather than throwing. */
export function findReference(id: string): ScienceReference | undefined {
  return SCIENCE_REFERENCES.find((r) => r.id === id);
}

/** Formatted citation line, for display and for copy-to-clipboard. */
export function formatCitation(r: ScienceReference): string {
  const authors = r.authors.map((a) => `${a.family}, ${a.given}`).join('; ');
  const locus = [r.volume && `${r.volume}`, r.issue && `(${r.issue})`, r.pages && `, ${r.pages}`]
    .filter(Boolean)
    .join('');
  return `${authors} (${r.year}). ${r.title}. ${r.journal}${locus ? `, ${locus}` : ''}. https://doi.org/${r.doi}`;
}
