# ADR: event-driven single-garment reception

Status: accepted under explicit owner authorization, 2026-09-11.

## Context and reference

The owner wants vision-assisted reception and seller approval on mobile rather
than expanding CRUD screens. Bag receipts and descriptive drafts remain useful,
but do not represent wall reception, image provenance or seller consent.

[Accounted architecture, pinned reviewed revision](https://github.com/erp-mafia/accounted/blob/91ab339a863239650f77eae8ab9d415574a90632/ARCHITECTURE.md)
separates engine, database enforcement, extensions and agent access. Posting from
agents is staged for approval, with separate workflow skills. Komisio has shared
staff operations and database controls, a local read/preview MCP adapter, but no hosted MCP, extension runtime or
unattended vision hardware. An optional inference adapter now demonstrates these
boundaries through the reception workflow; it requires explicit configuration.
No source code is copied from Accounted.

## Decision

Use a single-garment contract independent of bag custody and interface. A trusted
adapter supplies session context and immutable source references. Model output
contains descriptive suggestions, uncertainty and a sourced price suggestion.
The engine checks source references and revision. Store-reviewed terms and
content become an exact seller-review snapshot. A decision binds to that review.
Pure functions do not establish identity, persist consent or enforce database
authorization; the durable slice must independently guarantee those properties.

| Responsibility | Home |
| --- | --- |
| Observation/proposal/review/decision contracts | lib/engine/reception.ts |
| Model-independent assistance port | lib/assistance/reception.ts |
| Garment workflow guidance | skills/garment-reception/SKILL.md |
| Private staff image capture/storage | lib/engine/reception-photos.ts and Storage RLS |
| Provider calls and configuration | lib/assistance/openai-reception.ts and reception-config.ts |
| Attempt reservation and cost guard | lib/engine/reception-assistance.ts and database |
| Authoritative sessions, snapshots and decisions | Engine and database |
| Mobile review | Thin application surface |
| Local authenticated agent reads/previews | mcp/; hosted OAuth and durable staging remain future work |

Skills guide inference; validated configuration describes supported policies;
engine/database enforce identity, isolation and permitted transitions. Photos
belong in protected object storage with database references, not Git or skills.

## Alternatives and consequences

The [durable-source slice](DURABLE-RECEPTION.md) now adds authenticated session
creation and immutable textual source snapshots. The pure previews above remain
previews. The [immutable review](RECEPTION-REVIEWS.md) and
[seller response](SELLER-REVIEW.md) now have independent database enforcement.
[Private staff images](RECEPTION-PHOTOS.md) are now implemented. Seller image
delivery remains separate. [Optional inference](RECEPTION-ASSISTANCE.md) now has
bounded provider calls, source checks, attempt reservations and explicit staff
review. Live model access/quality are unverified; the staging configuration is off.

Reject a chat agent with direct SQL, a copied legacy item schema, and mandatory
fake bag receipts for wall reception. Shared contracts require explicit adapters
but let camera hardware, model and interface change independently.

Do not label a simulation as live AI or claim saved consent from pure functions.
No tax, commission or automatic sale rule is inferred. Source quality and seller
identity remain external-pilot gates. The delivery order is documented in
AUTONOMOUS-INTAKE-2026-09-12.md.
