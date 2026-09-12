# Immutable reception review snapshots

Staff can prepare a complete seller-review snapshot through the shared
publishReceptionReview command. This stores metadata, exact decimal price
proposal and evidence, pins the immutable source revision and current seller
agreement, and records the authenticated author. It sends no email or message
and grants no seller access by itself. The word publish in the engine names an
internal immutable version, not external publication or sale eligibility.

The database independently rejects unknown fields, absent/duplicate evidence,
tentative metadata, open questions, unsupported price formats and price references
that do not point to price evidence. The proposed selling price also has a stored
numeric(8,2) projection; no float arithmetic, commission or VAT is calculated.
Reference validation proves linkage, not the truth of an observation or appraisal.

Each new review requires the current source revision and expected previous review
ID. A competing publication fails instead of superseding unseen work. A retry
resolves its original immutable result, even if a later version exists. New
reviews use the currently published agreement; older reviews retain their pinned
terms. Initial expiry is explicitly selected within seven days. Historical reads
remain available after expiry. Source changes make the review stale for a future
decision, without editing the review itself.

The staff GET /api/reception/[id] response includes latestReview, exact terms,
sourceCurrent and expired. These are a read-time observation, not a capability to
approve: the eventual seller-decision database operation must recheck current
version, expiry and verified identity atomically.

Apply additive 20260911231000_reception_reviews.sql before dependent app deploy.
The existing intake flag and role/MFA controls apply. Tests cover immutable terms,
source provenance, stale revisions, replay, numeric price, roles and cross-store
access. Real concurrent connections test competing publications and retries.
The authenticated API journey saves/reads the exact snapshot and demonstrates
that a source change invalidates it. No hosted seller walkthrough is claimed.

Rollback retains snapshots and the additive schema; use a prior compatible app or
disable intake while forward-fixing. No provider credentials are needed. Seller
identity and mobile response are implemented separately in
[seller review](SELLER-REVIEW.md). Protected photos, live model inference and
agent writes remain future steps.
