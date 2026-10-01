# DocBench search evaluation — October 1, 2026

All 1,102 questions across the 229-document [DocBench release](https://github.com/Anni-Zou/DocBench) completed without search errors. After indexing and retrieval improvements, returned evidence supports **844 of 978 document-answerable references (86.3%)**, compared with the previously reported **737 (75.4%)**. This is a model-assisted evidence-coverage assessment, not official end-to-end DocBench accuracy or a claim of state-of-the-art performance.

The general improvements preserve evidence structure, expose whole-document statistics, check completeness before stopping, and separate small routing metadata from large source indexes. No question IDs, reference answers, expected numbers, or benchmark-specific routing rules were added to indexing or retrieval.

## What was measured

Every original question went directly to the production retrieval function, restricted to its paired document as provided by the benchmark. Searches used real PostgreSQL indexes, fresh SpiceDB authorization, and the configured TypeSafe `jev-latest` provider. Reference answers were supplied only to an independent `gpt-6-luna` evidence evaluator after retrieval. Application chat, answer-agent orchestration, query rewriting, and document-inspection tools were excluded.

The complete corpus ran in an isolated database schema. Ninety-eight existing indexes were reused by PDF checksum; 131 PDFs went through normal parsing. All 229 indexed successfully. Timing includes database access, authorization, routing, passage scoring, and final filtering, at three concurrent searches. It excludes evaluation, HTTP transport, and chat queues.

Positive evidence assessments require validated supporting quotes and recovery of the requested facts, operands, relationships, dates, and qualifiers. Related text, incomplete tables, and captions without requested values do not suffice. Codex reviewed selected gains and failures, rendered source pages, seven final assessment overrides, and the ten-question library check. Earlier baseline spot reviews are retained. These are not 1,102 independent human labels.

| Full paired-document run | Previous | Improved |
| --- | ---: | ---: |
| Successful searches / errors | 1,102 / 0 | 1,102 / 0 |
| Answerable references assessed | 978 | 978 |
| Supported references | 737 (75.4%) | 844 (86.3%) |
| Unsupported references | 241 | 134 |
| Median search time | 1.33 s | 1.19 s |
| 95th percentile | 6.15 s | 6.16 s |
| Maximum | 15.09 s | 13.13 s |
| Empty results | 114 | 105 |
| Provider requests | 23,420 | 32,349 |

Coverage improved by **10.9 percentage points**. Median latency fell about 10%; p95 was effectively unchanged. Stronger completeness checks used **38% more provider requests**. Token and dollar costs were not measured. This is an accuracy/usage tradeoff, not evidence that every query became faster.

| Question type | Previous | Improved |
| --- | ---: | ---: |
| Text | 350 / 412 (85.0%) | 375 / 412 (91.0%) |
| Tables | 182 / 220 (82.7%) | 192 / 220 (87.3%) |
| Metadata | 131 / 258 (50.8%) | 200 / 258 (77.5%) |
| Figures | 74 / 88 (84.1%) | 77 / 88 (87.5%) |

| Domain | Improved coverage |
| --- | ---: |
| Academia | 232 / 266 (87.2%) |
| Finance | 224 / 266 (84.2%) |
| Government | 110 / 131 (84.0%) |
| Law | 140 / 165 (84.8%) |
| News | 138 / 150 (92.0%) |

The other 117 unanswerable and seven external-web questions were searched and assessed separately. Empty results do not prove a fact is absent from the document. Three unanswerable cases returned evidence that conflicted with a reference premise; this is not a measurement of application-chat hallucination.

## General changes applied

- **Preserve evidence units.** Tables split at complete row boundaries, repeat headers, captions, and adjacent context, and retain connected row-span groups. Existing passages upgrade from cached extraction. A corpus audit checked 6,585 HTML tables and 81,157 rows with no missing whole rows; original Markdown and source blocks were preserved.
- **Index document-wide information.** A searchable statistics branch exposes page and extracted-word counts, parsed-object and numbered-caption counts, abbreviation frequencies, term occurrences, and section inventories. It states counting rules and truncation. Logical figures and parsed image panels are distinguished; extraction counts cannot guarantee perfect visual recognition.
- **Stop on sufficient evidence.** Passage scoring requires coverage of the entire question. Several partial passages receive a bounded joint-coverage check rather than automatically ending the search. Recovery continues within explicit budgets when evidence is incomplete.
- **Keep routing cheap.** Generated outline/profile columns avoid loading every full index. The final 229-document routing read transferred about **798 KB**, compared with **377 MB** of stored parsed indexes, and measured **26 ms**. Full indexes load only for explored documents.
- **Improve source selection without bypassing verification.** Authorized folder previews retain structural headings. A small candidate branch uses corpus-weighted title/heading matches and weaker extracted acronym/caption hints; JEV still selects routes and scores actual evidence. This complements the original hierarchy and preserves authorized folder ancestry in traces.
- **Upgrade safely.** Derived profiles were backfilled for 98 ready library documents and all 229 benchmark documents, with no concurrent-revision conflicts or new parser calls. All 229 stored source indexes and their upgraded scoped-search representations were checked against the original caches and remained identical apart from the added profile fields.

## Whole-library checks and limitations

The full run measures within-document retrieval, not selection from an entire library. Ten self-contained questions were therefore tested separately across the corpus:

| Same ten library queries | Initial | Folder outlines | Final candidate/profile routing |
| --- | ---: | ---: | ---: |
| Supported references | 6 / 10 | 7 / 10 | 7 / 10 |
| Median | 5.52 s | 3.73 s | 4.17 s |
| p95 | 15.53 s | 9.91 s | 9.48 s |

This small sample does not demonstrate an accuracy gain over the folder-outline baseline. Two source-selection failures remain: a dataset comparison and a company-wide percentage for a specific year. A third mismatch comes from a reference assigning cabinet powers to an individual. The final paired-document smoke check recovered 9 of the same ten references, retaining that strict attribution mismatch.

A profile trial showed that prepending captions/acronyms to bounded previews could crowd out headings. The final implementation keeps them in a separate candidate channel. Intermediate runs and their provider/evaluator outputs are retained for inspection.

The original FDA hearing-loss question returned the expected **about 30 million Americans** in the full run, the library check, and three fresh searches of the actual library. The final real-provider searches took **1.77 s, 1.67 s, and 1.85 s**. The local server was restarted with the final code and `/health/ready` returned healthy. These timings exclude HTTP transport and chat.

Assessment uncertainty remains. The paired labels changed positively on 121 questions and negatively on 14. Three negative changes had identical returned evidence and reflect evaluator variability or a stricter reference check, rather than retrieval regressions. A fourth identical-evidence label discrepancy was corrected manually. The original published baseline is preserved unchanged. Incorrect or ambiguous references remain strict mismatches; neither retrieval nor benchmark inputs were tuned to reproduce them.

## State-of-the-art comparison and next work

[AutoThinkRAG](https://arxiv.org/html/2603.05551v2), published in March 2026, reports **82.13% end-to-end DocBench answer accuracy**, including unanswerable questions. Its authors describe this as state of the art in their comparison. Our 86.3% covers evidence sufficiency for 978 document-answerable questions and excludes answer generation, so the numbers cannot establish that this system matches or exceeds that result.

The strongest remaining general opportunities are targeted page/crop retrieval for formulas and charts, query decomposition for comparisons and complete lists, and independent candidate selection evaluated at a fixed evidence budget. Rendered inspection confirmed that a formula denominator can disappear from extracted text. [TableRAG](https://arxiv.org/abs/2506.10380) also motivates retaining structured tables rather than flattening them. A visual-recovery stage should extract missing evidence before a separate reasoning stage interprets it. These are proposed follow-ups, not implemented features.

The reusable approach and ablation priorities are documented in [search-quality.md](search-quality.md).

## Validation and reproduction

All **37 focused indexing/retrieval tests** passed, including table integrity, row spans, old-index upgrades, document statistics, coverage-aware recovery, lazy loading, revoked access, private profiles, and shortcut ancestry. Project type checking and strict checks of both scripts passed. No application-chat tests were run.

The full improved run is pinned to `2beeda1132a8beef02b7eb501e11d1d3277471943f476e3fe918808e7148a5d8`; the previous run uses `40cfe336820599c7d376b76e28a6080d64b15a4414a53f4e67cacf2ce137b666`. Subsequent candidate/profile changes affect library routing or added index metadata, which the paired path does not use. The final ten-query library and paired smoke checks use `39fc9ae1721e7c72e6a55d9bad2b029d3d20193804a1889a4b71daf54b98115e`. The 1,102 results were not mixed with later runs or represented as a new full run on that final fingerprint.

With the local manifest and configured credentials:

```sh
pnpm exec tsx --env-file-if-exists=.env scripts/docbench-prepare.ts
pnpm exec tsx --env-file-if-exists=.env scripts/docbench-search.ts --label verification --concurrency 3
pnpm exec tsx --env-file-if-exists=.env scripts/docbench-search.ts --label verification --evaluate --concurrency 8
pnpm exec tsx --env-file-if-exists=.env scripts/reindex-search.ts --org=<organization-id>
```

Use a fresh label after implementation changes. An existing label can resume an interrupted run; `--retry-errors` retries failures. `--scope library` removes the paired-document restriction, `--ids` selects questions, and `--evaluate --follow` evaluates saved results while retrieval runs separately. Backfills optionally accept `--schema` and `--data-dir` for isolated stores.

Saved local evidence: [full summary](../.data/docbench/runs/structure-final-document/summary.json), [all 1,102 questions and excerpts](../.data/docbench/runs/structure-final-document/results.json), [134 unsupported references](../.data/docbench/audit/unsupported-references-final.json), [paired label changes](../.data/docbench/audit/search-improvement-comparison.json), [manual overrides](../.data/docbench/audit/manual-review-final.json), [library check](../.data/docbench/runs/profile-split-library/results.json), [scoped smoke check](../.data/docbench/runs/profile-split-document/results.json), [index preservation](../.data/docbench/audit/index-preservation.json), [profile preservation](../.data/docbench/audit/profile-preservation.json), [routing read](../.data/docbench/audit/metadata-read-final.json), and [actual library readback](../.data/docbench/audit/live-search-final.json). These artifacts are ignored by Git; this report, the generalized guide, and scripts are reviewable workspace files.
