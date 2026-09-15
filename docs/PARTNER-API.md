# Partner API: design proposal

Status: proposal for the owner, 2026-09-15. Nothing is implemented. This
opens a new access boundary (credentials that are not a person's session),
so it waits for explicit decisions before code, as the chain grouping did.

## Purpose

Roadmap 3.1: "a scoped REST subset for POS/webshop partners with OAuth
client credentials". A partner (a POS vendor, a web shop, a kiosk) reads a
store's saleable items and reports completed sales, without a person's
login and without the local MCP process. Agents keep MCP; partners get
REST. Both call the same engine.

## Proposed shape

- **Clients per store.** An owner creates a client in the settings with a
  name and a scope set; Komisio shows the client id once and the secret
  once, stores only a hash of the secret (Argon2 or scrypt through Node's
  crypto), and records creation, rotation and revocation as events. A
  client belongs to exactly one store and cannot be moved.
- **Tokens.** `POST /api/partner/token` with client credentials returns a
  short-lived bearer token (one hour) signed with the server credential
  key, carrying the store, the client and the scopes. No refresh tokens:
  the client asks again with its credentials.
- **Actor in the database.** Requests run as the automation identity with
  a per-request grant bound to the client's store and scopes, the way
  scheduled Zettle retrieval runs (`automation_allowed(tenant, scope)`),
  never as the owner and never with a service role. Every write records
  the client id as `actor_label`.
- **Scopes and endpoints, first set.**
  - `items:read`: `GET /api/partner/v1/items` (accepted, unsold items with
    title, category, price, currency, item id) and `GET /items/{id}`.
  - `sales:write`: `POST /api/partner/v1/sales` with the partner's own
    external id, occurred time, currency and lines of item id and price in
    öre; idempotent on external id through the existing `record_sale`; a
    line with an unknown item holds the sale for a person, as Zettle does.
  - `returns:write`: `POST /api/partner/v1/returns` staging a return for
    approval, never executing it.
  - `store:read`: `GET /api/partner/v1/store` (name, currency, public
    profile).
- **Limits.** 60 requests per minute per client, bodies at most 64 KiB,
  pages of at most 100. Errors are the engine's fixed codes.
- **Provenance.** `partner_requests` records client, endpoint, request id,
  outcome and time for every write; reads are counted per client and day.

## Questions for the owner

1. Is the scope set above the right first set, or should the first partner
   API be read-only (`items:read`, `store:read`) until a partner asks for
   writes?
2. Who may create clients: owner only (proposed) or admin as well?
3. Should a partner sale be recorded directly like a Zettle receipt (owner
   correction 2026-09-13: verified checkout facts need no second approval),
   or staged for approval because the partner is not a verified POS?
   Proposed: recorded directly under `sales:write`, held when a line does
   not match.
4. Does the pilot need this before production, or after the first
   partner conversation? Proposed: after; nothing in the pilot uses it.

## Not in this proposal

Webhooks from Komisio to partners, OAuth authorization code for people,
partner access across a chain, and any billing of API usage.
