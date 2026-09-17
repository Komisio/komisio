# Seller review and response

The review page at /review/<token> is a thin surface over shared engine operations
and database authorization. It is outside the staff dashboard: sellers do not
need to create a store or join tenant_members. The link alone is insufficient;
the account must have a confirmed email matching the review's immutable recipient
snapshot and satisfy any enrolled MFA requirement. This is email-based access,
not a verified electronic identity and not an assertion of a person's legal
identity.

Staff explicitly issues or revokes access through POST /api/reception/access.
The engine generates 32 random bytes and persists only their SHA-256 hash.
Issuance returns the path once. Each change requires the current access event ID;
replacement or revocation appends an event and makes earlier links unavailable.
If an issuance response is lost, reload the reception's latestReview.access and
explicitly issue a replacement with a new request ID. Never guess success or
silently reuse an unavailable plaintext token. A SQL retry of the same exact
issuance remains idempotent. No email is sent automatically.

The restricted seller read operation exposes reviewed metadata, selling-price
rationale, store name, exact pinned terms, expiry and any saved response. It does
not expose staff notes, source references, other sellers or tenant administration.
The database hashes the raw token itself; a stored hash cannot be used as a link.
The route uses no-store, no-referrer and noindex and embeds no external evidence
URLs. Operators must still treat links as sensitive and configure any future
analytics, monitoring or request logging to redact capability paths.

Reading the review, its photo descriptors and the Storage policy check use a
STABLE database function that takes no store lock; PostgreSQL forbids row locks
inside STABLE functions, so this is enforced rather than promised.

POST /api/seller/review invokes the shared respondToReview operation without an
active-store prerequisite. The database rechecks recipient, link, expiry, current
review and source revision under the same lock used by staff changes. One
immutable response is permitted per review. Same-actor, same-request retries
return the original result while access remains valid. Changed decisions or
competing responses fail. New reviews require a new response; historic responses
are retained. Revoked, superseded and expired links cannot read or respond, even
when a historical response exists. A separate long-lived seller history is future
work. Approval is not commercial acceptance, general agreement evidence, POS
publication or payout authorization.

The mobile page supports registration/confirmation, sign-in, account switching,
exact terms and approve/decline. It requires reading acknowledgement before the
approve button is enabled. Password recovery currently leads to account settings;
the seller can reopen their review link afterwards. Phone-only identification,
verified electronic identity and external review-mail delivery are future
steps. The
[operator workspace](RECEPTION-WORKSPACE.md) now exposes preparation and link
management through the same engine. There is still no live AI, photo capture or
image storage in this slice.

Apply 20260912001000_seller_review.sql and the additive projection correction
20260912001100 before deploying the dependent application. Both are additive;
retain review/access/response history on rollback. The existing intake flag gates
the application. Database authorization remains independent of this UI flag.
Tests cover confirmed email and MFA, isolated reads, revocation/replacement,
expiry, changed source/review, immutable response, replay and concurrent opposing
responses. A local synthetic mobile journey covers registration, approval,
revocation and a fresh review's decline without staff membership. Hosted end-to-end
seller delivery is not claimed until separately exercised.
