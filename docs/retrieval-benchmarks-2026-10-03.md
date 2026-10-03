# Retrieval experiment decision — 2026-10-03

Retain only early evidence delivery: return an authorized section before loading or routing its children. If its evidence is insufficient, resume the same traversal with fresh access checks. This avoids provider work that an adequate answer never needs. Passage ordering, document inspection, answer prompts, and model defaults remain as before this experiment.

The isolated change used the same 240 DocBench questions, parsed documents, provider, document scope, and concurrency of three as the baseline:

| Measurement | Baseline | Early evidence |
| --- | ---: | ---: |
| Median retrieval | 973 ms | 864 ms |
| p95 retrieval | 5,398 ms | 4,226 ms |
| Provider requests | 1,486 | 1,414 |
| Raw answerable coverage | 188/212 | 186/212 |

Median retrieval improved 11.2%, overall p95 improved 21.7%, and provider requests fell 4.8%. These are single live-provider runs. The answerable-only median improved 932 → 827 ms, while its p95 increased 2,720 → 2,813 ms. Do not claim a uniform tail-latency improvement or an accuracy gain.

All four raw coverage disagreements were inspected. Their relevant support was equivalent; the verdicts differed over completeness or reference interpretation. The retained regression test verifies that child loading and routing are skipped until evidence is needed, traversal resumes, and revoked access prevents further reads.

Remove the additional passage ranking, literal-match excerpts, printed-page resolution, and prompt changes: they did not establish an aggregate quality improvement. The broader 250-question blinded QA comparison was 203/250 on both sides. The larger lookup budget and fast-model trial also did not justify changing defaults.

The extra benchmark runner, paired-judge scripts, dataset changes, and detailed research report are preserved locally under `.data/experiments/retrieval-20261002/cleanup-archive/`, outside the tracked change. Frozen runtimes, raw benchmark results, and judgments remain under `.data/`. The earlier sampled-section routing improvement is retained independently of this experiment.
