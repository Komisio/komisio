# ADR: shared inspection drafts before item persistence

**Status:** Accepted. The proposal contract and staff draft persistence are implemented; model and agent adapters remain planned.
**Date:** 2026-09-11
**Deciders:** Implemented under the owner's autonomous-development authorization and explicit AI-first direction.

## Context and reference

The owner wants Accounted's engine-first approach, with the earlier Komisio used
for workflow evidence only. A received bag is custody; describing its contents
is preparation; commercial acceptance and making goods available for sale are
separate decisions. A large inherited item schema would conflate these steps.

Accounted's [architecture at the reviewed revision](https://github.com/erp-mafia/accounted/blob/91ab339a863239650f77eae8ab9d415574a90632/ARCHITECTURE.md)
describes a common bookkeeping engine, draft/commit operations, database-enforced
invariants, optional extensions and an authenticated MCP surface with staged
posting. Komisio adopts those architectural boundaries, not their accounting
rules, code, table names or current tool count. The reference is design evidence,
not an independent security audit of Accounted.

## Decision

Use one pure descriptive contract in `lib/engine/inspection.ts`. Manual editing
and optional AI suggestions share the same bounded fields. Suggestions are data,
never executable commands. They carry a contract version and the exact draft
context/revision. Applying a proposal requires explicit field selection. Any
intervening edit makes the whole proposal stale, including edit-and-undo. The
conservative whole-draft check is simpler than merging conflicting field edits.

| Responsibility | Home | Why |
| --- | --- | --- |
| Store membership, custody, seller and historical evidence | Database and authenticated engine | Must remain true regardless of model or interface |
| Descriptions, categories, condition suggestions | Optional AI adapter plus shared draft contract | Fallible enrichment that staff can review |
| Instructions for inspecting goods and expressing uncertainty | Versioned skills | Readable guidance, updateable without inventing new entities |
| Supported store policies | Explicit versioned configuration and deterministic enforcement | A prompt cannot enforce a required prerequisite |
| Approved price, tax treatment, sale, seller balance and payout | Future tested engine/database operations | Must not depend on a model following instructions |
| Model selection, inference cost, retries and provider secrets | Future optional adapter | Core manual operation must remain usable without it |

Tenant IDs in the draft prevent accidental context mixing only. They do not
prove authorization. A future server operation must resolve the authenticated
actor, recheck membership/MFA and bag ownership in the database, and handle stale
revisions and retries atomically. Model output cannot choose the actor, role,
approval status or an executable operation. No schema validation substitutes for
these checks.

## Options considered

1. **Reuse the old item model:** quick field coverage, but prematurely fixes
   catalogue, VAT and lifecycle assumptions. Rejected.
2. **Put everything in skills or arbitrary JSON:** flexible, but cannot guarantee
   identity, financial correctness or repeatable state transitions. Rejected.
3. **Small shared draft contract, then narrowly scoped persistence:** chosen.
   Adds deliberate steps but preserves replaceable models and a dependable core.

## Implemented and not implemented

Implemented: strict schemas, manual draft editing, explicit suggestion selection,
stale/context rejection and a non-persisted preview with meaningful description.
Tests cover late AI responses, unknown financial/authority fields, duplicate
selection, contract versions and use without a model. Text stays untrusted data;
future GUI adapters must render it as text, and model adapters must isolate it
from instructions. The pure functions provide no prompt-injection guarantee.

The subsequent [saved inspection delivery](SAVED-INSPECTION.md) adds a staff
screen and descriptive draft persistence. There is still no saleable item, model
call, MCP endpoint or durable agent approval. `previewInspection` itself reports `persisted: false`
and `availableForSale: false`. Schema version 1 is a draft interchange contract,
not a database schema or promise that an item has been accepted. Input provenance
must be attached by a trusted adapter when suggestions become persistent; a
model-supplied provider name is not trusted provenance.

## Next delivery sequence

1. Persist resumable inspection drafts per received bag with a small explicit
   model, optimistic concurrency, authenticated actor and atomic retry handling.
   Allow staff to resume shared store work; preserve original custody records.
2. Add the staff inspection screen using this contract. Clearly distinguish
   unsaved edits, saved drafts and commercial acceptance. Demonstrate recovery
   across reload, role removal, multiple staff and changed active store.
3. Add an optional suggestion adapter with an explicit model/cost configuration,
   source provenance, timeouts and manual fallback. Start with description and
   categorization; photo storage/access is a separate scoped delivery.
4. Add narrowly scoped authenticated agent access and durable proposal approval
   through the same operations. Test replay, expiry, payload binding and revoked
   credentials before enabling execution. No service-role bypass.
5. Define commercial acceptance/pricing and rejected-goods handling from tenant
   workflows before adding sale eligibility, POS publication or financial fields.

The pure contract shipped without a migration. Saved staff drafts use the
additive migration and existing intake flag described in SAVED-INSPECTION.md.
