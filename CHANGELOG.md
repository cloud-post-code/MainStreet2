# Changelog

All notable changes to this project will be documented in this file.

## [0.1.1.0] - 2026-05-26

### Added
- **Contextual suggestion chips** — Mason now generates smart quick-reply buttons server-side. When Mason shows products, chips offer price refinement (e.g., "Under $25") and satisfaction options. When Mason asks a clarifying question, chips match the question type: budget, occasion, style, recipient, age, colour, or hobbies. Chips are always cleared between turns, so stale options never linger.
- **Gift-recipient pronoun personalisation** — budget chips pick up gender signals from the full conversation ("she's worth it!" / "he's worth it!" / "they're worth it!") across all turns, not just the opening message.

### Fixed
- **Product cards no longer disappear when Mason's response contains a URL** — the question-detection heuristic previously matched any `?` in the text, including URL query strings (`?id=123`), which silently suppressed product cards. Now uses `\?(\s|$)` to detect genuine end-of-sentence questions.
- **Zero-results injection no longer fires on OpenAI extraction failures** — `searchRan` is now derived from a truthy query string (`!!derivedQuery`) rather than a null-check, so Mason doesn't get incorrectly silenced when the query derivation call times out or returns empty.
- **Suggestion chips now clear between turns** — previously, chips from a prior turn remained visible if the next turn generated no chips. Chips are now always replaced (including with an empty set) on every `done` event.
- **Pronoun context scans all user messages** — mid-conversation gender signals ("it's for my girlfriend") were missed when only the first user message was read. All user turns are now concatenated for context.

## [0.1.0.1] - 2026-05-25

### Fixed
- **Product cards now appear in chat** — the `products` SSE event was never emitted from the API, so the product strip UI was dead code. Cards now render after Mason recommends items.
- **Products are suppressed while Mason is asking questions** — the `products` event only fires when Mason's response does not end with `?`, preventing premature card display during clarification turns.
- **Mason can no longer hallucinate products** — system prompt updated with explicit DATABASE-ONLY RULE: Mason may only reference products from the injected search results, never invent or guess items.

### Changed
- **Mason's guidance flow** — prompt restructured to ask one focused clarifying question when a request is vague (who/budget/occasion), then recommend on the next turn. Never asks two questions in a row.
- **Recommendations capped at 3–4 products** — search result limit reduced from 5 to 4 to match the intended UX of a focused recommendation list.
- **Recommendation format** — Mason now names shop, item, and one sentence on why it fits the customer's need for each product.
