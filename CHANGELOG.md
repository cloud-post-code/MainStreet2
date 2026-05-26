# Changelog

All notable changes to this project will be documented in this file.

## [0.1.1.0] - 2026-05-26

### Added
- **Agentic tool-calling loop** — Mason now uses real OpenAI function calling (finish_reason=tool_calls) to drive her own search strategy, replacing the pre-search query-extraction pattern.
- **Multi-query vector search** — Mason sends 2–4 semantic variants per turn; all queries are batch-embedded in one API call, parallel pgvector RPCs run at threshold 0.72, results deduped by max similarity.
- **Business search tool** — `search_businesses` lets Mason look up local shops by name, type, or specialty using ilike on the businesses table.
- **`build_cards` tool** — Mason explicitly selects which product and business IDs to render as cards; renders `products` and `businesses` SSE events with curated picks only.
- **Business card UI** — business cards (shop name, town, category, Local badge) render below product strips with a green-tinted border to distinguish from product cards.

### Fixed
- **Double round-trip eliminated** — on finish_reason=stop, text from the non-streaming call is emitted directly instead of re-calling OpenAI with stream:true (~500ms saved per turn, output tokens halved).
- **Empty fullText guard** — if the tool loop exhausts all rounds without a stop response, an error is returned instead of persisting a blank assistant message.
- **LIKE wildcard injection** — LLM-supplied query/town strings are escaped before interpolation into ilike patterns.
- **Embedding count assertion** — mismatch between query count and returned embeddings now throws rather than sending undefined vectors to pgvector.
- **Categories join type** — Supabase one-to-many join returns an array; fixed to take `[0]` instead of casting as a single object.

### Removed
- **Dead code** — `deriveSearchQuery` and `searchProducts` (old single-query path) removed; no longer called anywhere.

## [0.1.0.1] - 2026-05-25

### Fixed
- **Product cards now appear in chat** — the `products` SSE event was never emitted from the API, so the product strip UI was dead code. Cards now render after Mason recommends items.
- **Products are suppressed while Mason is asking questions** — the `products` event only fires when Mason's response does not end with `?`, preventing premature card display during clarification turns.
- **Mason can no longer hallucinate products** — system prompt updated with explicit DATABASE-ONLY RULE: Mason may only reference products from the injected search results, never invent or guess items.

### Changed
- **Mason's guidance flow** — prompt restructured to ask one focused clarifying question when a request is vague (who/budget/occasion), then recommend on the next turn. Never asks two questions in a row.
- **Recommendations capped at 3–4 products** — search result limit reduced from 5 to 4 to match the intended UX of a focused recommendation list.
- **Recommendation format** — Mason now names shop, item, and one sentence on why it fits the customer's need for each product.
