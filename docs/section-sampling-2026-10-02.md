# Section excerpt retrieval experiment — October 2, 2026

A fixed 240-question pilot found better evidence coverage when JEV received selected source excerpts alongside section outlines. After reviewing all changed answerable labels, coverage rose from **186/212 (87.7%) to 193/212 (91.0%)**: **seven verified gains and no verified evidence losses**. This is a model-assisted within-document retrieval result, with manual review of changed labels. It is not end-to-end answer accuracy or evidence of better whole-library document selection.

| Matched pilot | Outline | Selected excerpts |
| --- | ---: | ---: |
| Searches completed / errors | 240 / 0 | 240 / 0 |
| Reviewed supported answerable references | 186 / 212 (87.7%) | 193 / 212 (91.0%) |
| Raw evaluator supported references | 187 / 212 (88.2%) | 195 / 212 (92.0%) |
| Median retrieval time | 1.048 s | 1.027 s |
| 95th percentile | 5.651 s | 5.514 s |
| Mean retrieval time | 1.705 s | 1.554 s |
| Retrieval provider requests | 1,801 | 1,589 |
| Routing requests | 700 | 685 |
| Evidence-scoring requests | 1,101 | 904 |
| Total request-body characters | 22,580,714 | 31,323,686 |
| Empty results across all question types | 27 | 25 |

The reviewed coverage increase is **3.3 percentage points**. Provider requests fell **11.8%**, mostly because fewer evidence-scoring calls were needed. Request-body characters increased **38.7%**. Characters are a payload-size proxy, not a token or dollar measurement; fewer calls do not establish a cost reduction. Latency was similar in this sequential pilot and should not be treated as a guaranteed speed improvement.

## Sampling strategy

`buildSectionPreviews` reads normalized original text after an explored document's full index passes authorization. It splits paragraphs into short sentence windows, retaining long-text windows across the entire section rather than sampling only its beginning. It weights query terms by their frequency across the document's sections and uses BM25-style term-frequency and length normalization to rank windows. A redundancy penalty and a preference for distinct child sections provide diversity.

Each section can include up to three excerpts: a strong query-relevant window when available, an opening window for general context, and an additional window selected for relevance and diversity. Parent sections can include child-section excerpts. Each excerpt carries its source heading and page. Descriptions reserve space for headings and page ranges and stay within the existing **1,200-character cap**. The global routing menu, beam width, passage limits, evidence rubric, coverage checks, and stopping rules are identical between arms. Actual payload sizes can differ within those caps.

The sampler makes no extra model call, generates no content summary, and does not modify extracted text, passages, blocks, or stored indexes. Routing previews are not returned as answer evidence. Normal scoring still sees the complete original source passages. Access checks still run before routing and after provider responses.

The experiment is opt-in through `retrieveDocuments(..., { sectionPreview: "sampled" })`. The application continues to use outline previews by default. This experiment enriches section routing after a document has been opened; it does not add body previews to initial folder/document selection.

The design borrows the principle of retaining query relevance and sentence context from [query-aware snippet extraction research](https://aclanthology.org/2022.emnlp-main.197/). Its lexical weighting and diversity heuristic are a local implementation, not a reproduction of that paper's learned model.

## Measurement and review

The same 240 original questions were selected proportionally across domain and question-type strata using a fixed hash seed, `routing-preview-2026-10-02`, before running either arm. They span 155 documents from the existing 229-document corpus. The sample contains 212 answerable questions, 27 unanswerable questions, and one external-web question. No reference answer is used for indexing, sampling, routing, or evidence scoring.

Both arms ran from one frozen source snapshot against the existing isolated benchmark schema, with three concurrent searches, real PostgreSQL/SpiceDB access, and TypeSafe `jev-latest`. A separate `gpt-6-luna` evaluator assessed evidence with the unchanged quote-validated rubric. References were supplied only to that evaluator. Evaluations were reused only for identical question, reference, evidence text, section, page, and source order under the same evaluator version and configuration. The treatment reused 121 baseline assessments; the baseline reused 120 identical historical assessments. All searches completed, and final assessments had no unresolved errors.

The raw comparison had nine gains and one loss. Review of all ten changed labels identified three corrections:

- One apparent gain reported a phrase count that still contradicted the frozen reference in both arms.
- One apparent gain confused the count of a role phrase with a complete-document count of the associated person's name. The treatment located the person, but the returned evidence did not establish a complete name count.
- The apparent loss came from a reference assigning total counts to a subset. Both arms returned the same complete historical table. Inspection of the original PDF chart and table confirmed the category distinction. This remains a strict reference mismatch in both arms.

These corrections are stored separately; original retrieval and evaluator outputs remain untouched. One verified table gain includes a contradiction between prose and a table already present in the document; the returned table explicitly establishes the requested reference value. Some questions are underspecified about jurisdiction or task, so this metric evaluates recoverability of the frozen reference rather than every possible interpretation.

| Answerable question type | Outline | Selected excerpts |
| --- | ---: | ---: |
| Text | 84 / 89 | 88 / 89 |
| Tables | 43 / 48 | 45 / 48 |
| Metadata | 41 / 56 | 42 / 56 |
| Figures | 18 / 19 | 18 / 19 |

The exact paired McNemar calculation is p=0.0156; an approximate paired 95% interval for the coverage change is +0.9 to +5.7 points. These calculations assume independent question pairs. Shared documents and model-assisted labels limit their interpretation. Only changed labels received independent review, and this was one retrieval run per arm rather than a repeated or full-corpus confirmation. No sampling parameters were tuned after observing outcomes.

## Validation and reproduction

All 49 focused retrieval, indexing, and preview tests passed. Project type checking and explicit strict checking of the benchmark script passed. Tests cover late query text, parent/child coverage, negation, duplicate windows, Unicode terms, bounded descriptions, unchanged extraction, and live access revocation.

Use fresh labels when rerunning. With the prepared corpus and configured credentials:

```sh
node --env-file-if-exists=.env --import tsx scripts/docbench-search.ts --label preview-outline-check --sample 240 --concurrency 3 --preview outline
node --env-file-if-exists=.env --import tsx scripts/docbench-search.ts --label preview-outline-check --sample 240 --concurrency 8 --preview outline --evaluate
node --env-file-if-exists=.env --import tsx scripts/docbench-search.ts --label preview-excerpts-check --sample 240 --concurrency 3 --preview sampled
node --env-file-if-exists=.env --import tsx scripts/docbench-search.ts --label preview-excerpts-check --sample 240 --concurrency 8 --preview sampled --evaluate --reuse-from preview-outline-check-document
```

The frozen outline fingerprint is `654426bd67f0cbce66ded9a0eaa4b71b88ef3c2166ba2ffd241918855841d3bf`; the excerpt fingerprint is `d3a54bd70be3684b87c3135f13e0bf9862d8e87323e85f9ee30c04248bb4c112`. The fingerprint includes the preview mode. Subsequent concurrent workspace edits are not represented by these measurements.

Saved local evidence: [raw comparison](../.data/docbench/experiments/section-sampling-20261002/comparison.json), [reviewed comparison](../.data/docbench/experiments/section-sampling-20261002/reviewed-comparison.json), [manual review](../.data/docbench/experiments/section-sampling-20261002/manual-review.json), [all changed cases](../.data/docbench/experiments/section-sampling-20261002/changed-cases.json), [outline summary](../.data/docbench/runs/sampling-outline-pilot-document/summary.json), [excerpt summary](../.data/docbench/runs/sampling-excerpts-pilot-document/summary.json), and [frozen source snapshot](../.data/docbench/experiments/section-sampling-20261002/snapshot/). Raw artifacts and the snapshot are ignored by Git; the implementation, tests, benchmark options, and this report are reviewable project files.
