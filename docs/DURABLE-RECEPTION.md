# Durable reception sources

The first persistent slice stores session identity separately from append-only
source snapshots. It does not create a bag, assert custody, publish an offer,
grant seller access or approve a sale. It prepares durable input for the headless
contract in lib/engine/reception.ts.

## Shared operations

- createReception binds authenticated staff, store and existing seller. Its
  request ID is the session ID; identical actor-bound retries resolve once.
- saveReceptionSources appends a full snapshot at the expected revision. A
  request ID resolves its original result after later revisions; different
  payload/actor conflicts. New stale requests fail. Source IDs retain their
  original content; corrections require a new source ID.
- readReceptionSession returns an empty session or validated ready contract.
  GET /api/reception/[id] uses active-store context and no-store headers. Writes
  use the existing same-origin, body-bounded /api/intake endpoint.

Initial sources are staff-entered observation or price-evidence text. References
are evidence labels, not executable URLs or verified prices. Photo kinds are
rejected until a protected capture adapter validates object ownership. The AI
port cannot directly write sources or manufacture trusted provenance.

## Database boundary

reception_sessions binds a seller through a composite store foreign key;
reception_source_revisions holds 1–20 strictly shaped sources per revision.
Database validation checks keys, types, UUIDs, duplicate IDs and size bounds.
The current view uses security_invoker. Existing owner/admin/staff roles can
write; readonly can read. Revoked access, incomplete MFA and anonymous callers
cannot bypass the engine. Direct table writes are not granted; immutable
triggers preserve session identity and source history.

Store-row locks serialize revisions with membership changes. A two-connection
test checks competing updates and identical retries. Audit events include
references/revision, not source text or contact details.

## Deployment and verification

Apply additive 20260911220000_reception_sources.sql to verified staging before
the dependent app. The existing intake flag applies. Local tests add 32 database
assertions covering source identity, isolation, readonly, revoked membership,
MFA and replay. The browser journey saves and reads through the API, rejects
stale/changed sources, switches store and verifies anonymous denial without a
GUI or fake bag. Exact-head CI is required before merge.

No model key, dependency or seller identity policy is introduced. Hosted health
checks alone do not prove seller review or vision. Retain the additive schema
and history on rollback; restore a compatible prior app or hide intake during a
forward fix. Do not delete evidence to recover from an application error.

Next: proposal/review/decision persistence and separately scoped seller access,
then private images and a real optional provider adapter. Seller mobile approval,
live vision and MCP are not implemented by this slice.
