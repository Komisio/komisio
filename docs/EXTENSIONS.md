# Extensions

Everything beyond the core consignment engine is an extension. This document
is the contract.

## Core

What every store gets: tenants and membership, consignors, intake, items and
their history, sales and returns, the consignor ledger, settlements, payouts as
records, and the daily closing data. The core works with no extension enabled.

## Extensions

Self-contained modules under `extensions/<slug>/` with a `manifest.json`
(metadata, entry point, required environment, dependencies) and an `index.ts`
exporting the extension definition. The operator decides at build time which
extensions are compiled in (`extensions.config.json`).

Planned first extensions: Zettle (POS sales and the certified cash register),
web shop / marketplace sync, Swish and bank payout rails, AI-assisted intake,
accounting export (Accounted, Fortnox).

## The rules

1. **Extensions never write core tables directly.** They read core data
   through documented queries and store their own data in their own tables.
2. **An extension that must cause a core fact** — a POS sale, a confirmed
   payout — does so by **staging an operation through the engine**
   (`pending_operations`), with an identified actor and a risk level.
   Low-risk operations may auto-execute per scope; everything else waits for
   approval. Strictly read-only extensions would not suffice: consignment
   sales enter from the POS, so a staged write path is required.
3. **Enabling or disabling an extension can never corrupt core data.** The
   core must pass all tests with every extension removed.
4. **Extensions declare what they read.** `readsCoreTables` in the manifest
   is enforced by review and, later, by database grants per extension role.
5. **Third-party extensions that use only this API may be licensed under any
   terms** (`NOTICE`).

The runtime interface (routes, API routes, sidebar items, event handlers,
services, lifecycle hooks) will be specified when the first extension is
built.
