# Knowledge Base Document Ingestion Design

Date: 2026-06-19

## Purpose

MEP Lab needs a production document ingestion pipeline for the Building Code MCP tools. The tools currently rely on synthetic fixture data for development tests. That is acceptable for tests only, but not for the feature itself. In production, Building_Code MCP tools must query only the canonical index built from documents uploaded by the user through the Knowledge Base UI.

The first production slice should support a minimal user flow:

1. The user opens a new Knowledge Base tab in the settings sidebar.
2. The user uploads supported documents by drag-and-drop or file picker.
3. MEP Lab parses, canonicalizes, chunks, embeds, and indexes the documents automatically.
4. Building_Code MCP tools query the last successful index snapshot created from uploaded documents.
5. The UI shows imported documents, parser/index diagnostics, and graph metrics derived from deterministic code references.

## Recommendation

Use Docling as the single canonical parser for the first production pipeline.

Docling is the best fit for this feature because it is local-first, MIT-licensed, supports the target file types, and outputs structured representations that preserve layout, tables, reading order, OCR output, and document metadata. It supports PDF, DOCX, XLSX, plain text/Markdown, CSV, images, HTML, and other formats. It also provides document-aware chunking primitives that can inform, but not fully replace, MEP Lab's building-code-specific canonical chunking.

Do not convert every supported format into PDF before parsing. Native DOCX and XLSX contain structure that should not be discarded. The parser should handle each supported format directly, and MEP Lab should normalize the parser output into the existing building-code index contract.

Alternatives considered:

- Marker: strong local parser with PDF/DOCX/XLSX support, but GPL-3.0 and commercial/self-hosting licensing constraints make it a poor default dependency for this app.
- LlamaParse or Unstructured API/Pipelines: useful future opt-in cloud parsers, but they require third-party upload, credentials, cost, and explicit user consent.
- Unstructured open source: broad file support, but its own documentation positions it as a prototyping library rather than the production path.

Sources:

- Docling features: https://docling-project.github.io/docling/
- Docling supported formats: https://docling-project.github.io/docling/usage/supported_formats/
- Docling chunking: https://docling-project.github.io/docling/concepts/chunking/
- Marker: https://github.com/datalab-to/marker
- LlamaParse getting started: https://developers.llamaindex.ai/llamaparse/parse/getting_started/
- Unstructured open source overview: https://docs.unstructured.io/open-source/introduction/overview
- Unstructured supported file types: https://docs.unstructured.io/open-source/introduction/supported-file-types

## Architecture

Add a main-process `KnowledgeBaseService` responsible for upload ingestion, document registry management, canonical index rebuilds, and status/diagnostic reads for the renderer.

The pipeline is:

```text
uploaded file
  -> supported-file validation
  -> copied source file under app-owned knowledge-base storage
  -> Docling parse result
  -> building-code canonical adapter
  -> deterministic cross-reference resolver
  -> table extraction
  -> canonical chunk builder
  -> embedding pass
  -> atomic index snapshot
  -> Building_Code MCP tools
```

The existing building-code modules should remain the retrieval core:

- `types.ts` remains the canonical evidence/index contract.
- `retrieval.ts` continues to power `search`, `read_section`, `resolve_cross_refs`, and `lookup_table`.
- `chunking.ts`, `cross-reference.ts`, `table.ts`, and `embedding.ts` are reused and expanded where needed.
- `pdf-extract.ts` should be replaced or generalized into parser-backed extraction. The fixture-only extraction path should not be used in production.

The Building_Code MCP server must load only the persisted knowledge-base index in production. Test fixtures can remain as test helpers, but production tool schemas must not expose a `fixture` argument and runtime code must not fall back to bundled synthetic data.

## Storage And Data Contract

Use an app-owned storage root such as:

```text
userData/knowledge-base/building-code/
  documents.json
  sources/
  parsed/
  index/
    index.json
    vectors.json
```

The document registry stores one record per uploaded file:

- `documentId`
- original filename
- MIME type or detected file type
- byte checksum
- copied source file path
- parser name and parser version
- parse status: `queued`, `parsing`, `embedding`, `ready`, `ready_with_warnings`, `failed`, `removed`
- timestamps for upload, parse start, parse completion, and last index rebuild
- metadata: code family, edition, jurisdiction scope, source title
- diagnostics and failure messages
- index summary: node count, table count, chunk count, resolved reference count, unresolved reference count

Extend the building-code canonical records as needed:

- `CodeSourceRecord` should include `documentId` and a local source path or app-internal source URI.
- `CodeNodeRecord` should preserve parser provenance, page range, source element ids, confidence, and layout bounding boxes when available.
- `CodeCrossReferenceRecord` remains the deterministic graph edge source and may later be extended with semantic or structural edge kinds.

The service should rebuild the active index transactionally from all `ready` and `ready_with_warnings` documents after upload, removal, or reparse. Rebuild-on-change is safer for the first production version than incremental mutation. If parsing or indexing fails, the last successful index remains active.

## Parsing And Canonicalization

Docling parses each supported file directly. The adapter maps Docling output into building-code records.

Canonicalization rules:

- Headings become canonical nodes when they match code-like references such as `Section 3.2.1`, `Table 9.10.3.1`, `Appendix A`, or jurisdiction-specific equivalents.
- Content between headings attaches to the nearest canonical node.
- Tables become both `CodeNodeRecord` table nodes and structured `CodeTableRecord` rows and notes.
- Page ranges and layout metadata are preserved for citations and diagnostics.
- Unsupported or ambiguous parser elements produce diagnostics instead of being silently discarded.

For PDFs where headings are visual text rather than Markdown headings, add a deterministic heading detector over Docling elements/text. It should recognize:

- `Section`, `Subsection`, `Article`, `Sentence`, `Part`, `Chapter`, `Table`, `Figure`, and `Appendix` prefixes.
- Numeric code references without explicit prefixes, such as `9.10.3.1`.
- Table captions and appendix notes.
- Common all-caps chapter/part headings.

The first production pipeline should not require an LLM to create the canonical index. LLM-based repair can be considered later as an explicit, inspectable enhancement.

## Cross-Reference Graph

The first graph primitive is deterministic reference resolution.

The resolver should expand beyond the current fixture regex to handle common building-code forms:

- `Section 9.10.3.1`
- `Article 3.2.2.20.`
- `Sentence 9.10.3.1.(1)`
- `Subsection 4.1.5.`
- `Part 6`
- `Chapter 5`
- `Table 7.3.1`
- `Figure 3.1.4`
- `Appendix A`
- `Note A-3.2.1.`

Resolved cross references become graph edges. Unresolved references remain visible in diagnostics and graph metrics. Semantic edges can be added later, but they must not replace explicit reference edges.

## Knowledge Base UI

Add a new `Knowledge Base` tab to `SettingsPanel` beside Memory, Skills, and related settings tabs.

The UI should be minimal and operational:

- Upload section: drag-and-drop zone plus file picker button.
- Upload queue: filename, status, current phase, and failure message.
- Knowledge base list: title, edition/jurisdiction, source filename, node count, table count, resolved/unresolved reference count, and last parsed time.
- Document actions: reparse, remove, reveal source.
- Graph summary: counts for sections, tables, reference edges, unresolved edges, and a simple selected-node explorer.
- Diagnostics detail: expandable parse/index diagnostics for low-confidence pages, skipped elements, unresolved references, and embedding failures.

Do not expose multiple parser modes or extraction granularity choices in the first slice. Uploading a supported document automatically parses and indexes it.

Accepted extensions for the first slice:

- `.pdf`
- `.docx`
- `.doc`
- `.xlsx`
- `.xls`
- `.txt`
- `.md`
- `.csv`

The final accepted set should be gated by the packaged Docling runtime. If a legacy format needs an optional system dependency, reject it clearly until the runtime supports it reliably.

## Embeddings And Retrieval

Embeddings should continue to use the existing `BuildingCodeEmbeddingClient` contract. The default embedding settings should inherit from the existing memory embedding runtime configuration, as the current MCP preset already does.

Indexing behavior:

- Exact `read_section`, `resolve_cross_refs`, and `lookup_table` should work when canonical records exist, even if embeddings are temporarily unavailable.
- `search` requires embeddings for semantic ranking. If embeddings fail, the MCP tool should return a clear semantic-search-unavailable error or fall back to deterministic lexical search only if the fallback is explicitly implemented and tested.
- Embedding cache keys should be stable across rebuilds when the source checksum, node id, chunk text, and model remain unchanged.

## Error Handling

Required behavior:

- Unsupported file type: reject before copy/index and show a concise error.
- Parser unavailable: show an actionable setup/runtime error and leave the existing index active.
- Partial parse: import high-confidence canonical nodes, attach diagnostics, and mark the document `ready_with_warnings`.
- No canonical headings detected: fail the document with `no canonical building-code sections found`, unless the file is plain text/Markdown with explicit section markers.
- Embedding failure: keep parsed canonical records, mark semantic search unavailable, and leave exact reads/table lookups available.
- Rebuild failure: retain the last successful index snapshot.
- Empty knowledge base: Building_Code MCP tools return a clear empty-knowledge-base error.

## Production Guarantees

- Production Building_Code MCP tools never query synthetic fixture data.
- Production tool schemas do not expose `fixture` switches.
- Every answerable Building_Code result has citation evidence tied to an uploaded document, logical reference, and page range when available.
- A failed parse or embedding pass does not corrupt the last good index.
- The full active index can be rebuilt from uploaded source files and the document registry.

## Test Plan

Unit tests:

- Supported file validation.
- Document registry create/update/remove behavior.
- Source checksum stability.
- Atomic index snapshot writes.
- Empty-index MCP behavior.
- No production fixture argument or fixture fallback in Building_Code tool schemas.
- Embedding cache reuse across rebuilds.

Adapter tests:

- Generated minimal DOCX with sections and subsections.
- Generated minimal XLSX with tabular code data.
- Generated minimal PDF with section headings, continued page ranges, and table captions.
- Plain text and Markdown files with explicit section markers.
- Failure case for documents with no canonical building-code headings.

Cross-reference tests:

- Section, article, sentence, subsection, part, table, figure, appendix, and note references.
- Resolved and unresolved reference diagnostics.
- Graph metrics derived from `CodeCrossReferenceRecord`.

Renderer tests:

- Knowledge Base tab appears in settings navigation.
- Upload queue status rendering.
- Imported document list and empty state.
- Diagnostics expansion.
- Remove/reparse action wiring.

Integration tests:

- Upload fixture document through service API, rebuild index, then call `search`, `read_section`, `resolve_cross_refs`, and `lookup_table`.
- Simulate parser failure and verify the prior index remains active.
- Simulate embedding failure and verify exact reads remain available while semantic search reports unavailable.

## Implementation Boundaries

This design covers the next feature slice only. The following are intentionally deferred:

- Heavy interactive force-directed graph visualization.
- User-selectable parser engines.
- LLM-based parse repair or section inference.
- Cloud parser providers.
- Multi-tenant or shared remote knowledge bases.
- Incremental index mutation for very large libraries.

The first implementation should create a production-grade local ingestion path, remove fixture access from production MCP tools, and expose a small, trustworthy Knowledge Base UI.
