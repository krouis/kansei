#!/usr/bin/env node
/**
 * verify-references.mjs — re-verify the citations in src/features/about/ against
 * the authoritative bibliographic records, and re-check that every outbound link
 * still resolves.
 *
 * The learner-facing prose in references.data.ts (summary, informsFeature,
 * limitations, claimTier) is hand-authored curriculum judgement and is NOT
 * generated — a script cannot write an honest limitation. What a script CAN do,
 * and what this one does, is make the *bibliographic* half reproducible: it
 * fetches the same records the data was checked against and reports any field
 * where the committed data and the authoritative record now disagree.
 *
 * Authorities, in order of precedence per field:
 *   Crossref   https://api.crossref.org/works/<doi>          volume, issue, pages, journal, authors
 *   PubMed     esummary.fcgi?db=pubmed&id=<pmid>             PMID existence, full title with subtitle
 *   OpenAlex   https://api.openalex.org/works/doi:<doi>      independent cross-check of biblio
 *   Unpaywall  https://api.unpaywall.org/v2/<doi>            open-access status
 *
 * Exit status is non-zero on any mismatch or unreachable URL, so this is usable
 * in CI as a rot detector: publishers do silently correct metadata, and a
 * citation that was right in 2026 can be wrong later.
 *
 * Usage:
 *   node scripts/content/verify-references.mjs                 # metadata + links
 *   node scripts/content/verify-references.mjs --no-links      # metadata only (fast)
 *   node scripts/content/verify-references.mjs --links-only    # link reachability only
 *   node scripts/content/verify-references.mjs --json          # machine-readable report
 *
 * Requires Node >= 22.6 for native TypeScript type stripping (Node 24 in this
 * repo); no dependencies beyond Node builtins.
 *
 * Note on link checking: several academic publishers (SAGE, AAAS, APA, Springer)
 * return 403 to non-browser clients. A DOI link is therefore judged by whether
 * https://doi.org/<doi> issues a redirect to a publisher URL, not by whether the
 * publisher page itself can be downloaded — otherwise this script would report
 * working citations as broken.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const REFS_MODULE = path.join(REPO, 'src', 'features', 'about', 'references.data.ts');
const SOURCES_MODULE = path.join(REPO, 'src', 'features', 'about', 'sources.data.ts');

const CONTACT = 'khalifa@missingno.tech';
const UA = `kansei-reference-verifier/1.0 (+offline Japanese learning PWA; mailto:${CONTACT})`;

const argv = process.argv.slice(2);
const wantJson = argv.includes('--json');
const linksOnly = argv.includes('--links-only');
const checkLinks = !argv.includes('--no-links');

/* ------------------------------------------------------------------ helpers */

const problems = [];
const notes = [];

function fail(refId, field, expected, actual, authority) {
  problems.push({ refId, field, expected, actual, authority });
}

function log(s) {
  if (!wantJson) process.stderr.write(`${s}\n`);
}

/** Collapse whitespace, unify quote characters, strip a trailing full stop. */
function norm(s) {
  return String(s ?? '')
    .replace(/&amp;/g, '&')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/\.$/, '')
    .trim();
}

/** Page ranges: 604-616 and 604-16 and 604–616 all mean the same thing. */
function normPages(s) {
  if (s == null) return null;
  const m = String(s).replace(/[‒-―]/g, '-').match(/^(\d+)\s*-\s*(\d+)$/);
  if (!m) return String(s).trim();
  const [, a, b] = m;
  // Expand an abbreviated end page (604-16 -> 604-616).
  const end = b.length < a.length ? a.slice(0, a.length - b.length) + b : b;
  return `${a}-${end}`;
}

async function getJson(url, label) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status} for ${url}`);
  return res.json();
}

/* ------------------------------------------------------------- field checks */

async function verifyCrossref(ref) {
  const j = (await getJson(`https://api.crossref.org/works/${ref.doi}`, 'Crossref')).message;
  const A = 'Crossref';

  const journal = norm((j['container-title'] || [])[0]);
  if (journal && norm(ref.journal) !== journal) fail(ref.id, 'journal', journal, ref.journal, A);

  for (const [field, got] of [
    ['volume', j.volume ?? null],
    ['issue', j.issue ?? null],
  ]) {
    if (got != null && String(ref[field] ?? '') !== String(got)) fail(ref.id, field, String(got), String(ref[field]), A);
  }

  if (j.page && normPages(ref.pages) !== normPages(j.page)) {
    fail(ref.id, 'pages', normPages(j.page), normPages(ref.pages), A);
  }

  const crAuthors = (j.author || []).map((a) => `${norm(a.family)}|${norm(a.given)}`);
  const ourAuthors = ref.authors.map((a) => `${norm(a.family)}|${norm(a.given)}`);
  if (crAuthors.length && crAuthors.join(';') !== ourAuthors.join(';')) {
    fail(ref.id, 'authors', crAuthors.join('; '), ourAuthors.join('; '), A);
  }

  // Crossref truncates some titles at a colon, so a committed title that merely
  // EXTENDS the Crossref title is fine; one that disagrees on the shared prefix
  // is not. The full title is confirmed against PubMed below where a PMID exists.
  const crTitle = norm((j.title || [])[0]);
  const ourTitle = norm(ref.title);
  if (crTitle && !ourTitle.startsWith(crTitle) && ourTitle !== crTitle) {
    fail(ref.id, 'title', crTitle, ourTitle, `${A} (prefix mismatch)`);
  } else if (crTitle && ourTitle.length > crTitle.length) {
    notes.push(`${ref.id}: Crossref title is truncated ("${crTitle}"); committed title is longer — checked against PubMed.`);
  }

  const printYear = (j['published-print']?.['date-parts']?.[0] ?? [])[0] ?? null;
  const onlineYear = (j['published-online']?.['date-parts']?.[0] ?? [])[0] ?? null;
  const acceptable = new Set([printYear, onlineYear].filter((y) => y != null));
  if (acceptable.size && !acceptable.has(ref.year)) {
    fail(ref.id, 'year', [...acceptable].join(' or '), String(ref.year), A);
  }
  if (printYear && onlineYear && printYear !== onlineYear && !ref.publicationNote) {
    fail(ref.id, 'publicationNote', `required: print ${printYear} vs online ${onlineYear}`, 'null', A);
  }
}

async function verifyPubmed(ref) {
  if (!ref.pmid) return;
  const A = 'PubMed';
  const j = await getJson(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ref.pmid}&retmode=json&tool=kansei&email=${encodeURIComponent(CONTACT)}`,
    'PubMed',
  );
  const r = j.result?.[ref.pmid];
  if (!r || r.error) {
    fail(ref.id, 'pmid', 'a PubMed record', `no record for PMID ${ref.pmid}`, A);
    return;
  }

  const doiOnRecord = (r.articleids || []).find((x) => x.idtype === 'doi')?.value;
  if (doiOnRecord && doiOnRecord.toLowerCase() !== ref.doi.toLowerCase()) {
    fail(ref.id, 'pmid/doi pairing', doiOnRecord, ref.doi, A);
  }

  // MEDLINE house style downcases titles, so PubMed is the authority for the
  // WORDS of a title (including a subtitle Crossref truncates) but not for its
  // capitalisation — Crossref preserves what the journal published. Compare
  // case-insensitively and let Crossref's casing stand.
  if (norm(r.title).toLowerCase() !== norm(ref.title).toLowerCase()) {
    fail(ref.id, 'title', norm(r.title), norm(ref.title), `${A} (authority for the full title with subtitle)`);
  }
  if (r.pages && normPages(ref.pages) !== normPages(r.pages)) {
    notes.push(`${ref.id}: PubMed prints pages as "${r.pages}"; committed "${ref.pages}" (PubMed abbreviates end pages).`);
  }
}

async function verifyOpenAlex(ref) {
  const A = 'OpenAlex';
  let j;
  try {
    j = await getJson(`https://api.openalex.org/works/doi:${ref.doi}?mailto=${encodeURIComponent(CONTACT)}`, 'OpenAlex');
  } catch {
    notes.push(`${ref.id}: OpenAlex unavailable — cross-check skipped.`);
    return;
  }
  const b = j.biblio || {};
  if (b.volume && String(b.volume) !== String(ref.volume)) fail(ref.id, 'volume', String(b.volume), String(ref.volume), A);
  if (b.issue && String(b.issue) !== String(ref.issue)) fail(ref.id, 'issue', String(b.issue), String(ref.issue), A);
  if (b.first_page && b.last_page) {
    const oa = normPages(`${b.first_page}-${b.last_page}`);
    if (normPages(ref.pages) !== oa) fail(ref.id, 'pages', oa, normPages(ref.pages), A);
  }
}

async function verifyOpenAccess(ref) {
  let j;
  try {
    j = await getJson(`https://api.unpaywall.org/v2/${ref.doi}?email=${encodeURIComponent(CONTACT)}`, 'Unpaywall');
  } catch {
    notes.push(`${ref.id}: Unpaywall unavailable — open-access status not re-checked.`);
    return;
  }
  if (j.is_oa && !ref.openAccessUrl) {
    notes.push(
      `${ref.id}: Unpaywall now reports this as open access (${(j.oa_locations || [])[0]?.url ?? 'location unknown'}) but openAccessUrl is null — consider adding it.`,
    );
  }
  if (!j.is_oa && ref.openAccessUrl) {
    notes.push(`${ref.id}: openAccessUrl is set but Unpaywall reports the work is NOT open access — check the link is legitimately free.`);
  }
}

/* --------------------------------------------------------------- link check */

/** A DOI counts as live if doi.org issues a redirect to a publisher URL. */
async function checkDoi(ref) {
  const res = await fetch(`https://doi.org/${ref.doi}`, {
    method: 'HEAD',
    redirect: 'manual',
    headers: { 'user-agent': UA },
  });
  const target = res.headers.get('location');
  if (res.status >= 300 && res.status < 400 && target) return { ok: true, detail: `${res.status} -> ${target}` };
  if (res.status === 200) return { ok: true, detail: '200 (resolver served directly)' };
  return { ok: false, detail: `resolver returned ${res.status} with no redirect` };
}

/**
 * Plain URLs are checked with a browser-ish User-Agent. A 403 is reported as a
 * bot-block rather than a failure: several publishers and repositories refuse
 * non-browser clients while the URL is perfectly good in a browser.
 */
async function checkUrl(url) {
  const headers = {
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    accept: 'text/html,application/xhtml+xml,*/*',
  };
  try {
    let res = await fetch(url, { method: 'HEAD', redirect: 'follow', headers });
    if (res.status === 405 || res.status === 501) res = await fetch(url, { redirect: 'follow', headers });
    if (res.ok) return { ok: true, detail: String(res.status) };
    if (res.status === 403 || res.status === 429) return { ok: true, detail: `${res.status} (bot-blocked; URL kept)` };
    return { ok: false, detail: String(res.status) };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

/* --------------------------------------------------------------------- main */

const { SCIENCE_REFERENCES, METADATA_CORRECTIONS } = await import(REFS_MODULE);
const { CONTENT_SOURCES, SOURCES_VERIFIED_ON } = await import(SOURCES_MODULE);

log(`Verifying ${SCIENCE_REFERENCES.length} references and ${CONTENT_SOURCES.length} content sources.\n`);

if (!linksOnly) {
  for (const ref of SCIENCE_REFERENCES) {
    log(`${ref.id}  ${ref.doi}`);
    // Internal invariants first: these need no network.
    if (ref.url !== `https://doi.org/${ref.doi}`) {
      fail(ref.id, 'url', `https://doi.org/${ref.doi}`, ref.url, 'internal invariant');
    }
    if (!ref.authors.length) fail(ref.id, 'authors', 'at least one', 'none', 'internal invariant');
    if (!ref.limitations.trim()) fail(ref.id, 'limitations', 'non-empty', 'empty', 'internal invariant');
    if (!['research-supported', 'product-interpretation', 'needs-evaluation'].includes(ref.claimTier)) {
      fail(ref.id, 'claimTier', 'a known tier', ref.claimTier, 'internal invariant');
    }
    try {
      await verifyCrossref(ref);
      await verifyPubmed(ref);
      await verifyOpenAlex(ref);
      await verifyOpenAccess(ref);
      log('  metadata checked');
    } catch (err) {
      fail(ref.id, 'fetch', 'a reachable authority', err.message, 'network');
      log(`  FETCH FAILED: ${err.message}`);
    }
  }
}

if (checkLinks) {
  log('\nLink reachability:');
  for (const ref of SCIENCE_REFERENCES) {
    const r = await checkDoi(ref);
    log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${ref.url}  ${r.detail}`);
    if (!r.ok) fail(ref.id, 'url', 'a resolving DOI', r.detail, 'doi.org');
    if (ref.openAccessUrl) {
      const o = await checkUrl(ref.openAccessUrl);
      log(`  ${o.ok ? 'ok  ' : 'FAIL'} ${ref.openAccessUrl}  ${o.detail}`);
      if (!o.ok) fail(ref.id, 'openAccessUrl', 'reachable', o.detail, 'HTTP');
    }
  }
  for (const s of CONTENT_SOURCES) {
    for (const [field, url] of [
      ['url', s.url],
      ['licenceUrl', s.licenceUrl],
    ]) {
      const r = await checkUrl(url);
      log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${url}  ${r.detail}`);
      if (!r.ok) fail(s.id, field, 'reachable', r.detail, 'HTTP');
    }
  }
}

const report = {
  checkedAt: new Date().toISOString(),
  references: SCIENCE_REFERENCES.length,
  contentSources: CONTENT_SOURCES.length,
  recordedCorrections: METADATA_CORRECTIONS.length,
  sourcesVerifiedOn: SOURCES_VERIFIED_ON,
  problems,
  notes,
};

if (wantJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  if (notes.length) {
    log('\nNotes (not failures):');
    for (const n of notes) log(`  - ${n}`);
  }
  if (problems.length) {
    log(`\n${problems.length} MISMATCH(ES):`);
    for (const p of problems) {
      log(`  ${p.refId}.${p.field}\n    authority (${p.authority}): ${p.expected}\n    committed:              ${p.actual}`);
    }
    log('\nUpdate src/features/about/references.data.ts (or sources.data.ts) and record the change in METADATA_CORRECTIONS.');
  } else {
    log('\nAll checked fields agree with the authoritative records, and all links resolve.');
  }
}

process.exitCode = problems.length ? 1 : 0;
