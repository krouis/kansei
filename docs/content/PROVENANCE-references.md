# Provenance — About screen references and content sources

Covers two committed datasets:

| Dataset | File |
| --- | --- |
| Experimental evidence Kansei cites | `src/features/about/references.data.ts` |
| Teaching material, data, audio and fonts Kansei is built from | `src/features/about/sources.data.ts` |

They are deliberately separate files. `references.data.ts` is evidence about **how**
people learn; `sources.data.ts` is provenance for **what** the app contains. Listing a
peer-reviewed meta-analysis beside a coursebook or a corpus invites a reader to transfer
the authority of the first to the second, and neither file is allowed to do that.

Kansei's own teaching order is in **neither** dataset: it is hand-authored judgement,
recorded in `data/` and labelled as such.

## What is machine-verified, and what is not

Verified against authoritative machine-readable records: title, authors, year, journal,
volume, issue, pages, DOI, PMID, open-access status, and the reachability of every
outbound link.

Hand-authored and **not** derivable by any script: `summary`, `informsFeature`,
`limitations`, `claimTier`, and every prose field in `sources.data.ts`. A script cannot
write an honest limitation. These are the Kansei authors' words, written for a learner
with no psychology background; no paper text is quoted or bundled.

Where the app's own prose names a method detail that could not be confirmed from an
openly readable record, that detail is listed in the entry's `unverifiedDetails` array
and rendered in the UI, rather than presented as established. Two entries carry such a
detail (see "Known gaps").

## Authorities

| Authority | Endpoint | Used for |
| --- | --- | --- |
| Crossref REST API | `https://api.crossref.org/works/<doi>` | journal, volume, issue, pages, authors, published-print vs published-online year, published title capitalisation |
| NCBI E-utilities (PubMed) | `esummary.fcgi` / `efetch.fcgi?db=pubmed` | PMID existence, PMID↔DOI pairing, full title including a subtitle Crossref truncates, abstract |
| OpenAlex | `https://api.openalex.org/works/doi:<doi>` | independent cross-check of volume/issue/pages; abstract where a publisher blocks direct access |
| Unpaywall | `https://api.unpaywall.org/v2/<doi>` | open-access status and OA version (`bronze` / `green` / `submittedVersion`) |
| DOI resolver | `https://doi.org/<doi>` (redirect only) | link liveness |

No licence covers these APIs' output in a way that restricts recording bibliographic
facts; bibliographic metadata is not copyrightable, Crossref metadata is distributed
without restriction, and OpenAlex data is CC0. Abstracts were read to write accurate
summaries and are **not** reproduced in the repository.

Precedence rules encoded in the verifier, because the authorities disagree in known ways:

- **Title words and subtitle → PubMed.** Crossref truncates some titles at a colon
  (it does for Dunlosky et al. 2013).
- **Title capitalisation → Crossref.** MEDLINE house style downcases titles, so PubMed
  is not the authority for capitalisation.
- **Page ranges → Crossref.** PubMed abbreviates end pages (`604-16` for `604-616`).
- **Citation year.** Either the print-issue year or the online-first year is accepted;
  where they differ, the entry must carry a `publicationNote` saying so.

## Reproducing the verification

```sh
npm run content:verify-references          # metadata + link reachability
node scripts/content/verify-references.mjs --no-links    # metadata only (fast)
node scripts/content/verify-references.mjs --links-only  # link reachability only
node scripts/content/verify-references.mjs --json        # machine-readable report
```

Script: `scripts/content/verify-references.mjs`. Node ≥ 22.6 (native TypeScript type
stripping); no dependencies beyond Node builtins. Exit status is non-zero on any
mismatch or unreachable link, so it works in CI as a rot detector — publishers do
silently correct metadata, and a citation that is right today can be wrong later.

Every field correction made while first verifying these citations is recorded in
`METADATA_CORRECTIONS`, exported from `references.data.ts` and rendered on the About
screen. Any future correction must be appended there, not applied silently.

The script judges a DOI by whether `https://doi.org/<doi>` issues a redirect to a
publisher URL, not by whether the publisher page downloads: SAGE, AAAS, APA and Springer
all return `403` to non-browser clients while the link is fine in a browser. Treating
those as failures would report working citations as broken.

## Licences of the content sources

Recorded per entry in `sources.data.ts`, with `spdxId` set only where an SPDX identifier
cleanly applies and `redistributable` recording whether Kansei may ship the data.

| Source | Licence | Redistributable |
| --- | --- | --- |
| EDRDG (KANJIDIC2, JMdict) | `CC-BY-SA-4.0` | yes, with attribution and a statement of changes |
| KanjiVG | `CC-BY-SA-3.0` (© 2009–2026 Ulrich Apel) | yes, share-alike |
| Bundled fonts (Noto Sans JP, Noto Serif JP, Klee One, Inter) | `OFL-1.1` | yes; subsets keep the same licence and are not renamed |
| Wikimedia Commons / Lingua Libre audio | per file — commonly CC BY-SA 4.0, CC BY 4.0, CC0 1.0 or public domain; no single SPDX id | yes, per clip, with the clip's own attribution recorded |
| NINJAL BCCWJ word list | **not open.** "Free for use for research or educational purposes"; copyright NINJAL; commercial use case-by-case | **no** — consulted, never shipped |
| Japan Foundation / Marugoto | **not open.** All rights reserved (© 2017 The Japan Foundation Japanese-Language Institute, Urawa) | **no** — consulted for sequencing only; no text, wordlist, image or audio copied |

The EDRDG licence requires, for a smartphone or tablet app, that the acknowledgement
appear on a dedicated screen reached from a menu — one labelled "About" or "Sources" —
and states that a launch-screen mention is not sufficient. That requirement is part of
why the About screen exists.

`redistributable: false` is load-bearing, not decorative: it is the reason no NINJAL list
and no Marugoto material appears in a content pack. From NINJAL only a derived rank per
item Kansei already teaches is shipped; if that reduction is ever judged too close to
redistribution, the ranks come out and `frequencyRank` goes null.

## Known gaps

Two entries assert a method detail that no openly readable record confirms. Both are
recorded in the entry's `unverifiedDetails` and shown in the UI:

1. **Karpicke & Roediger (2008).** Widely described as using Swahili–English word pairs.
   The open abstract says only "foreign language vocabulary words"; there is no
   open-access copy (Unpaywall: `is_oa false`). The committed summary therefore says
   "foreign-language vocabulary pairs".
2. **Wiley & Rapp (2021).** Widely described as training adults on Arabic letters with
   pen on paper. The open abstract names neither the script nor the writing implement,
   and the PMC author manuscript is blocked to non-browser clients. The committed summary
   says "a writing system unfamiliar to them", and the limitation argues from what the
   abstract does establish — adults, unfamiliar letters, a motor vs non-motor contrast.

A maintainer with journal access should read both method sections and, if the details
hold, move them from `unverifiedDetails` into the summary with the source named.

Two open-access links carry caveats recorded in their `publicationNote`: Butler &
Roediger is **bronze** OA (free at the publisher, no open licence, withdrawable), and
the Wiley & Rapp deposit is a **submitted** version, not the version of record — so the
DOI remains the citable link in both cases.

`sources.data.ts` describes the fonts the interface requests and the build pipeline that
subsets them. At the time this record was written the subsetting step
(`npm run fonts:build`) had not yet produced files in `public/`, so the font entry
documents intended use; confirm the shipped subsets and their bundled licence texts
before release.
