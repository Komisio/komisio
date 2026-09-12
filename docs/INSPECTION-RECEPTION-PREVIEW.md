# Inspection draft to reception: unsaved preparation

Implements the functional roadmap's next descriptive comparison slice without
implementing commercial convergence. A saved active inspection draft is compared
with the existing reception field contract. Only its description, nonempty
category and condition are shown as candidate values; optional empty fields are
omitted. Category/condition equivalence still needs human confirmation (ADR A4).

The origin is the actual bag ID, draft ID and saved revision. It is not a reception
source ID. No source IDs, photos, observed certainty, price, agreement, session,
proposal or seller consent are invented. The result is deliberately not a valid
`receptionSuggestions` payload and cannot be submitted as a published review.

Preparation lists the steps outside this comparison: choose/create the matching
seller's reception, record and review descriptive sources, add a selling price
with price evidence, select the published terms and review each fact. These are
requirements of the existing review contract, not new commercial rules. The
preview does not inspect other receptions or agreements and must not claim those
records are absent. No automatic link or copy to a reception is created.

UI and MCP share the same pure comparison. The server page uses its already
authorized saved snapshot, never unsaved form input. MCP reads the active saved
draft via the existing authenticated engine and requires an exact expected
revision under opt-in `inspection:preview`; stale/archive/tenant/MFA checks apply.
Read-time freshness is not a lock. The view shows its saved revision and reminds
staff that subsequent edits require refreshing the saved view.

No schema, write, model call, source conversion or acceptance is added. Nothing
becomes available for sale. Verify pure mapping/minimization/nonmutation and real
MCP identity/scope/stale/archive denial, plus browser saved-versus-unsaved and
history/archive visibility. Full commercial convergence remains the proposed ADR.
