**DocBench search evaluation — October 1, 2026**

All 1,102 questions from the 229-document [DocBench release](https://github.com/Anni-Zou/DocBench) were searched successfully. Search excerpts supported 737 of 978 document-answerable reference answers (75.4%). This is evidence coverage, not an end-to-end chat accuracy score. Retrieval still has material gaps, especially whole-document metadata and table context.

Every original question was passed directly to the production retrieval function using its paired PDF, matching the benchmark’s document context. Retrieval used real PostgreSQL data, fresh authorization checks, and the configured TypeSafe `jev-latest` service. Reference answers and evidence were supplied only to a separate evaluation step after retrieval; they were never sent to routing or passage scoring. Application chat, answer-agent orchestration, query rewriting, and document-inspection tools were excluded.

The full corpus ran in an isolated database schema: 98 matching existing indexes were reused by PDF checksum, and the other 131 PDFs were parsed through the normal indexing pipeline. All 229 finished without indexing errors. The user library was retained.

Evidence sufficiency was assessed with a separate `gpt-6-luna` evaluator. Positive assessments required supporting excerpts whose quoted text was checked against the actual returned sources. Minor HTML, whitespace, and line-wrap hyphenation differences were normalized for quote validation. Codex manually spot-reviewed 31 paired cases and the ten library-wide checks, including selected rendered PDF pages for reference/extraction conflicts. Eight persistent evaluator quote errors were resolved manually. This remains a model-assisted assessment, not 1,102 independent human labels.

An answer is supported when the requested facts can be recovered from the excerpts, including calculations from shown inputs. Related text, incomplete tables, or captions without the required values do not suffice. Ordinary abbreviations and paraphrases are accepted. Whole-document counts and absence claims require complete coverage or an explicit statement.

| Full paired-document run | Result |
| --- | ---: |
| Questions / documents | 1,102 / 229 |
| Successful searches / errors | 1,102 / 0 |
| Answerable references assessed | 978 / 978 |
| Supported references | 737 (75.4%) |
| Unsupported references | 241 |
| Median search time | 1.33 s |
| 95th percentile search time | 6.15 s |
| Maximum search time | 15.09 s |
| Empty search results | 114 |
| Searches stopped with a remaining frontier or budget limit | 978 |
| Retrieval provider requests | 23,420 |

Timing includes database access, authorization, routing, passage scoring, and final filtering. Three searches ran concurrently. It excludes evaluation, application HTTP transport, and chat queues. The `limited` flag also covers stopping after useful evidence was found; it does not mean all 978 searches exhausted a hard budget. Unanswerable questions account for much of the slow tail.

| Question type | Supported / answerable | Coverage | Median | p95 |
| --- | ---: | ---: | ---: | ---: |
| text-only | 350 / 412 | 85.0% | 1.30 s | 3.90 s |
| multimodal-t | 182 / 220 | 82.7% | 1.35 s | 2.61 s |
| multimodal-f | 74 / 88 | 84.1% | 1.31 s | 2.67 s |
| meta-data | 131 / 258 | 50.8% | 1.14 s | 2.87 s |

The 117 `unanswerable` questions and seven `una-web` questions were also searched and assessed, but excluded from answerable-reference coverage. Empty excerpts do not prove a fact is absent from the entire document. External-web questions require evidence outside the library. Four unanswerable cases returned passages that appeared to conflict with the reference’s premise; these are flagged in the raw assessment, without claiming a chat hallucination.

| Domain | Supported / answerable | Coverage | Median | p95 |
| --- | ---: | ---: | ---: | ---: |
| Academia | 218 / 266 | 82.0% | 1.33 s | 2.76 s |
| Finance | 190 / 266 | 71.4% | 1.38 s | 7.90 s |
| Government | 91 / 131 | 69.5% | 1.28 s | 4.89 s |
| Law | 116 / 165 | 70.3% | 1.47 s | 11.05 s |
| News | 122 / 150 | 81.3% | 1.17 s | 2.77 s |

Library-wide retrieval was tested separately with ten self-contained questions across domains. The paired-document run cannot establish whole-library routing accuracy for ambiguous questions such as “Who is the last author of the paper?”

| Same ten library-wide questions | Before richer folder outlines | After |
| --- | ---: | ---: |
| Supported references | 6 / 10 | 7 / 10 |
| Median | 5.52 s | 3.73 s |
| p95 | 15.53 s | 9.91 s |
| Empty results | 2 | 1 |

This small sample is diagnostic, not an estimate of library-wide accuracy. Three questions still lacked sufficient evidence: a dataset statistic comparison, a minimum-marriage-age law, and a complete list of emergency powers.

The original FDA question now returns “about 30 million Americans experience hearing loss,” matching DocBench. It succeeded in the full benchmark, the library-wide check, and all three repeated searches of the actual 98-document user library. Those live searches took 4.00 s, 2.79 s, 3.11 s.

Changes applied:

- Library searches now fetch stored document outlines and lazily open full indexes for explored document branches. The 229-document metadata read fell from roughly 394 MB to 291 KB and measured 16 ms after the change. Full index loading and outward descriptions still require fresh access checks.
- Attached-document searches constrain the initial SQL read to the selected resources.
- Folder routing descriptions now include bounded, authorized child outlines, so routing can consider what a folder actually contains.
- Section routing and passage scoring include source page ranges; scoring distinguishes the source’s own authors from authors in bibliography entries and requires the requested relationships and qualifiers.
- A generated outline column stays synchronized with parsed index updates. Migration 013 was verified on the actual library after an existing migration-number collision was corrected. The local server was restarted and `/health/ready` returned healthy.

Focused validation: all 25 retrieval checks passed, including lazy loading, revocation before full-index loading, outbound authorization, routing budgets, and source provenance. Project type checking and the benchmark script’s strict type check passed. No chat tests were run after the scope clarification.

Remaining gaps observed in the saved results:

- Whole-document word/mention/figure/table counts, document length, and absence assertions often cannot be recovered from bounded passages. Metadata coverage is 50.8%.
- Large table fragments can omit year or metric headers needed to interpret the retrieved values. Case `59:3` contains retained-earnings values without their year labels.
- Formula extraction can lose fractions. Rendered PDF inspection in case `13:0` showed a denominator missing from the indexed text.
- Some routes still return related material instead of the requested evidence. Case `60:2` returned stock-performance sections without the requested ticker; `63:1` returned no supporting equity excerpt.
- Some reference answers are internally inconsistent or disagree with the PDF. These were retained as strict mismatches rather than silently correcting benchmark labels.

Examples manually verified from the returned evidence:

| Question ID | Finding |
| --- | --- |
| `15:1` | The opening author list and affiliation table supply seven authors. |
| `21:4` | The paired search returns 54.5 and 24.6, allowing the expected difference of 29.9. Library routing still missed this table. |
| `17:0` | The reference calls 92.3 accuracy; PDF Table 5 labels it SANITY. Model accuracy reaches 63.6. |
| `17:2` | The question asks why versus where; the reference instead answers what versus where. |
| `34:4` | The returned reference inputs 54.31 and 44.24 subtract to 10.07, while the reference says 9.87. |
| `11:1` | Manual review confirmed 67.5 and resolved an evaluator quote-format error. |

The paired run was pinned to retrieval fingerprint `40cfe336820599c7d376b76e28a6080d64b15a4414a53f4e67cacf2ce137b666`. The later folder-outline change only affects the library routing branch, which is bypassed when the paired document IDs are supplied; it was checked separately with fingerprint `cfe9047be6f303d342ef3040eb505680692af47f586917c5168c417e2af31073`. The rows are not mixed across implementations. PDF checksum and question hashes are recorded in each run configuration.

Reproduction with the local DocBench manifest and configured parsing/retrieval credentials:

```sh
pnpm exec tsx --env-file-if-exists=.env scripts/docbench-prepare.ts
pnpm exec tsx --env-file-if-exists=.env scripts/docbench-search.ts --label verification --concurrency 3
pnpm exec tsx --env-file-if-exists=.env scripts/docbench-search.ts --label verification --evaluate --concurrency 8
```

Use a fresh label after retrieval implementation changes. An existing label can resume interrupted searches; `--retry-errors` retries failed searches. `--scope library` runs original questions without a paired-document restriction; `--ids` selects explicit question IDs. `--evaluate --follow` assesses new saved results while retrieval runs separately.

Saved evidence: [full summary](../.data/docbench/runs/search-v2-document/summary.json), [all 1,102 results and source excerpts](../.data/docbench/runs/search-v2-document/results.json), [241 unsupported references](../.data/docbench/audit/unsupported-references.json), [manual spot reviews](../.data/docbench/audit/manual-review.json), [library-wide results](../.data/docbench/runs/search-v3-library/results.json), and [actual library readback](../.data/docbench/audit/live-search.json). These local benchmark artifacts are ignored by Git; this report and the runner are reviewable workspace files.
