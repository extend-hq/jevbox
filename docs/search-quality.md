# Improving retrieval across document systems

Measure evidence coverage separately from generated-answer accuracy. A relevant excerpt can still omit an operand, qualifier, header, or part of a list. A system that returns related text should not receive credit for making the correct answer recoverable.

The same failure analysis applies to tree search, sparse or dense retrieval, and graph-based RAG:

| Failure | General treatment | Implemented here |
| --- | --- | --- |
| Values lose their meaning when chunked | Preserve typed evidence units, column headers, captions, row spans, units, and source provenance | Table rows and connected row groups retain headers, captions, and adjacent context; existing indexes upgrade from cached extraction |
| Counts are inferred from a small sample | Use full-document aggregates with a defined counting method and completeness flags | Searchable page, word, term, abbreviation, parsed-object, and numbered-caption statistics |
| Relevant evidence is incomplete | Distinguish topic relevance from coverage of the whole question | Stricter passage rubric and bounded evidence-set checks before stopping |
| Routing cannot see the content of a collection | Give candidate selectors bounded, authorized descriptions of their children | Stored document outlines, derived search profiles, and per-request folder descriptions |
| A single candidate-selection path misses a source | Combine independent source hints, then verify actual evidence | A small corpus-weighted metadata candidate branch complements tree traversal |
| Every query loads the entire corpus | Separate small routing metadata from large source content | Lazy full-index loading, scoped SQL, and bounded provider concurrency |
| Extraction loses a visual relationship | Preserve the original page or crop and escalate perception only when needed | Layout and source block coordinates are retained; query-time visual recovery remains future work |

Table structure is part of the evidence, rather than formatting to discard. [TableRAG](https://arxiv.org/abs/2506.10380) identifies flattening and chunking as sources of information loss and combines text retrieval with structured operations for multi-step table reasoning. Our implementation preserves evidence structure; it does not implement that paper's SQL reasoning pipeline.

Whole-document statistics must distinguish physical parsed objects from logical entities. Several panels may share one numbered figure caption. Counts of extracted words and token matches must state their normalization and inclusion rules. Heading inventories locate source material without proving complete author lists or surrounding claims. A truncated inventory cannot establish absence.

Treat completeness as a query-dependent requirement. A single local fact can finish after one strong result; a comparison needs both values and matching units/conditions. A list needs every requested member, and an absence assertion needs exhaustive coverage. Score the combined evidence when several partial passages may jointly suffice. Continue within explicit budgets when coverage is weak.

Keep source-selection metadata separate from source evidence and from navigation previews. Captions and body terms can help find a document, but placing them ahead of headings in a bounded folder preview can hide its structure. Prefer stronger title/heading signals and weaker body-derived hints; preserve an independent route for recovery. Authorization must filter candidate inputs before any outward model call, then be checked again when loading or returning evidence.

The next reusable improvements should be tested as separate ablations:

1. Preserve formulas and visual evidence through page/crop retrieval, then use targeted perception to extract missing values. Keep interpretation separate from logical reasoning. [AutoThinkRAG](https://arxiv.org/html/2603.05551v2) reports 82.13% DocBench answer accuracy with query-complexity routing and separated visual perception/reasoning; this is not directly comparable with our retrieval-only measure.
2. Add query decomposition for cross-section comparisons and complete lists, then merge and check coverage. Avoid paying for decomposition when one local passage suffices.
3. Compare independent candidate selectors, such as sparse/dense retrieval plus document structure, at a fixed evidence budget. Introduce an index only if held-out measurements improve coverage and latency together.
4. Record parser-quality signals and extraction completeness. A count of parsed objects is not a guarantee that every visual object was recognized.

Evaluate on unchanged questions and documents, with reference answers withheld from indexing and retrieval. Pin implementation and corpus versions; save excerpts, routes, timing, and reference conflicts. Report retrieval coverage, answer accuracy, abstention, and latency independently. Use paired comparisons, inspect gains and regressions, and retain incorrect or ambiguous reference answers as explicit audit findings rather than tuning search to reproduce them.
