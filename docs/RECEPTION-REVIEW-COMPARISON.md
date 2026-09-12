# Compare a proposal with its prior publication

The staged reception payload already pins previousReviewId. Read that immutable
review by ID plus tenant and session, not the latest row, to explain changes in
the staff detail page and existing scoped MCP detail tool. Missing/mismatched
baseline fails closed. First publication returns no comparison.

Compare all descriptive fields including added/removed fields, exact values and
citation sets (order alone is not a change). Compare price amount, rationale and
citations without money arithmetic. Separately flag source revision and agreement
ID changes; unchanged citation IDs do not prove unchanged source content. Display
the exact proposed evidence and terms as before. No raw photo path is returned.

This is a limited read-only comparison, not legal equivalence, seller approval,
commercial acceptance or a complete diff of expiry, images and contractual text.
Every proposed fact still requires explicit review, including unchanged fields.
Existing SQL rechecks current versions when staff decide. Historical comparison
keeps the pinned baseline after newer reviews appear; stale guidance stays separate.

Test additions/removals, source reordering versus replacement, price rationale-only
changes, changed agreement/source revision, unchanged inputs and mismatched baseline.
Verify the shared read through real local MCP and the staff browser, including
historical baseline after another proposal is approved. No migration or provider call.
