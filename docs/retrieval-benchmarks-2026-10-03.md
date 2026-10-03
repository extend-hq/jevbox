# Retrieval and document QA experiments — 2026-10-03

The goal was to improve general document search and answering without adding model calls to the ordinary search path. The retained candidate yields available evidence before routing further, orders passages within a section using cheap query relevance, and lets document inspection return cited literal-term matches with page locations and pagination. It preserves section recovery, document fairness, access checks, original passage contents, and the existing five-call answer budget.

The historical section-sampling experiment was useful: reviewed DocBench coverage rose from 186/212 to 193/212, with median retrieval 1,048 → 1,027 ms and p95 5,651 → 5,514 ms. That tested sampled source excerpts added to headings/outlines. It did not compare against generated summaries. See [the recorded experiment](section-sampling-2026-10-02.md).

## Matched retrieval experiment

All variants used the same 240 stratified questions, selected before editing with seed `fast-evidence-20261002`, document scope, concurrency three, the same parsed documents, real authorization, and the same retrieval provider. Of these, 212 are answerable, 27 unanswerable, and one requires external information. No reference annotations entered retrieval. Identical evidence reused the same assessment; changed evidence was independently assessed with quote validation.

| Variant | Raw evidence coverage | Median, all 240 | p95, all 240 | Provider requests | Errors |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline | 188/212 (88.7%) | 973 ms | 5,398 ms | 1,486 | 0 |
| Yield evidence before deeper routing | 186/212 (87.7%) | 864 ms | 4,226 ms | 1,414 | 0 |
| Yield + passage priority | 187/212 (88.2%) | 897 ms | 4,342 ms | 1,433 | 0 |

The combined candidate reduced overall median latency by 7.8%, p95 by 19.6%, and provider requests by 3.6% in this run. This is a latency improvement, not evidence of better retrieval accuracy. The answerable-only latency slice was mixed: median 932 → 842 ms, p95 2,720 → 3,501 ms. These are single runs against live providers, not stable service-level guarantees; the priority run also overlapped Q&A traffic.

Manual review of all three raw discordant answerable pairs produced **187/212 on both sides, with no gains or losses**. One pair omitted proof of the final page in both conditions; one incorrectly required an incidental reference detail; one exposed the same arithmetic conflict with the reference. Raw judgments remain untouched. The raw paired difference is −0.47 percentage points, exact McNemar p=1.0, with an approximate document-cluster bootstrap interval of −2.01 to +1.0 points. Neither raw nor reviewed evidence supports a quality gain.

Artifacts are under `.data/experiments/retrieval-20261002/`: `retrieval-comparison.json`, `retrieval-paired-review.json`, `retrieval-reviewed-comparison.json`, and the frozen runtime directories. Raw retrieval rows are under `.data/docbench/runs/fast-evidence-{baseline,yield,priority}-document/`.

## End-to-end QA and evaluation reliability

A new direct mode runs the production answer policy, search, inspection, visual-page tool, and citation formatting from a hashed backend snapshot. It preserves the exact source excerpts and rendered images used by the answer. This removes the earlier ambiguity about which revision the HTTP server had loaded and the need to reconstruct incomplete inspection evidence. Direct timing excludes the chat queue and transport, so it must not be compared directly with the old HTTP timing.

The paired run uses the existing 250 questions (50 each from FinanceBench, QASPER, MMLongBench-Doc, ViDoSeek, and LongDocURL), with fresh histories, GPT-5.6 Sol answering, and GPT-6 Luna judging. The baseline finished at 201/250. Candidate and additional V2 results are being finalized. A transient provider failure interrupted later candidate cases; retries preserve the original implementation and append to the same result log.

Near-equivalent answers sometimes received opposite independent verdicts. `scripts/judge-benchmark-pairs.ts` therefore supplies randomized A/B answers together with references, hides the treatment, excludes retrieved documents from correctness grading, and enforces consistent labels for answers the judge considers equivalent. This checks correctness separately from evidence sufficiency and grounding. It does not silently repair questionable reference annotations or turn a local sample into an official leaderboard result.

An additional 33-question difficult-case experiment allowed eight total lookups while retaining a cap of five semantic searches. It scored 7/33 versus 8/33 for the baseline on those questions. This is a selected diagnostic set with wide uncertainty, and it changed several components together. It offers no reason to increase the production budget, so the larger limit was not retained.

## Current research and missing coverage

Published scores are useful directionally, but our small samples, answer models, judge rubrics, corpus scopes, and source representations differ. We cannot establish SOTA from them.

| Evidence | Finding relevant to this repository | Implication |
| --- | --- | --- |
| [DocAtlas](https://github.com/microsoft/DocAtlas-Harness), 2026 | Reports 78.8 LongDocURL LasJ and 71.4 MMLongBench-Doc accuracy with GPT-5.4; explicit evidence state and document navigation | LongDocURL remains a priority; distinguish searching from complete evidence assembly |
| [DocMemo](https://arxiv.org/html/2608.07067v1), August 2026 | Reports 81.1 on LongDocURL with a different evaluation setup; uses memory-guided evidence discovery | Track already-read evidence and remaining requirements instead of repeating broad retrieval |
| [TAEC](https://arxiv.org/html/2609.37349v1), September 29, 2026 | Coordinates evidence across a trajectory and controls context exposure | Admit complementary evidence and avoid filling the answer context with redundant passages |
| [Controlled VLM pipeline study](https://arxiv.org/html/2609.29933v1), September 2026 | Retrieved visual pages outperform text-only retrieval; more context and higher image settings do not monotonically help | Keep the fast text path and invoke original-page inspection for visual uncertainty |
| [MIDR](https://arxiv.org/html/2609.01316v1), September 2026 | Moves visual enrichment into indexing; reports a smaller index and faster queries than its unoptimized visual late-interaction baseline | An offline visual/lexical index is a plausible next architecture experiment; published latency ratios are implementation-specific |
| [Cohere Embed 5](https://cohere.com/blog/embed-5), September 30, 2026 | Shared Pro/Fast embedding space allows different indexing/query models; its ViDoRe 85.8 uses RCP-nDCG@10 on parsed text | Benchmark a fast hybrid candidate stage before replacing routing; this score is not comparable with ordinary nDCG or our accuracy |

The corrected [MMLongBench-Doc V2](https://github.com/VectifyAI/MMLongBench-Doc-V2) was added to the dataset importer and runner. It has 1,071 questions over 134 PDFs, fixes 106 annotations, removes invalid/duplicate rows, and changes the grading protocol. A deterministic new sample of 50 questions across seven PDFs was prepared and indexed. Its score must be labeled as our common-judge diagnostic sample, not V2's official pinned-judge score or a V1 improvement.

Other coverage worth adding:

- [ViDoRe V3](https://arxiv.org/html/2601.08620v1): multilingual, multimodal retrieval with page relevance and grounding annotations. Measure nDCG@10, page recall, complete-evidence recall, latency, and index size on the full distractor corpus. This was researched, not run.
- [MADQA](https://github.com/Snowflake-Labs/MADQA): 500 test questions over 800 PDFs, measuring accuracy against effort. This directly addresses the current gap in large-library testing. Researched, not run.
- [OfficeQA Pro V2](https://github.com/databricks/officeqa): 90 questions over a new 1,435-document corpus; the repository reports the best tested agent at 54.4%. The data is gated. Researched, not run.
- [FinRAGBench-V](https://github.com/zhaosuifeng/FinRAGBench-V): financial multimodal reasoning plus visual citations. Useful beyond the text-heavy FinanceBench sample. Researched, not run.

LongDocURL needs a protocol correction before a leaderboard comparison: its `start_end_idx` is the question-construction range, while `images` lists the actual evaluation input pages (zero-based filenames). All 50 selected questions use 30 input pages. The importer now records construction and input pages separately, following the [official dataset documentation](https://huggingface.co/datasets/dengchao/LongDocURL). Existing artifacts remain unchanged and the current application runs still receive the entire PDF. Applying the narrower construction range would incorrectly give the model extra scope information.

The next substantial accuracy experiment should combine a cheap lexical/visual candidate index with the existing semantic evidence scorer, then evaluate on a full-corpus benchmark with untouched held-out questions. Preserve exact entities, dates, units, and source boundaries; use images for unresolved visual facts; measure complete evidence rather than whether any relevant passage was found. Raising search depth or context size globally is not supported by this experiment.

## Reproduction and checks

`scripts/docbench-search.ts` records the retrieval implementation and fixed query sample. `scripts/local-benchmarks.ts --direct` records the backend implementation hash and exact evidence. `scripts/compare-benchmarks.py` produces paired differences, discordant IDs, exact McNemar results, and document-cluster bootstrap intervals. `scripts/judge-benchmark-pairs.ts` provides resumable blinded correctness checks.

The frozen directories preserve the implementations used while unrelated work continued in the shared checkout. No deployment or commit was performed. The 55 focused tests passed, including resuming deferred routes, late passage prioritization, authorization revocation, literal-match pagination, and original PDF rendering. TypeScript validation includes the new benchmark scripts in addition to the application.
