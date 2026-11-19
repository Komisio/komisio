# Stores grouped under one company

Each store remains its own tenant. A person can belong to multiple stores and
switch between them; policies, integrations, sellers, balances and day closes
remain store-scoped.

An owner can group stores they own. `chain_economy_summary` returns per-store
figures and their total only when the caller is owner or admin in every store
included. Grouping does not grant access to another store.

An owner/admin in both stores can transfer a consignment item. The engine records
the end in the source and a linked receipt in the target rather than changing
the item's tenant. The target accepts it under its own terms. Existing seller
balances remain where the sales occurred; a stock transfer is not a ledger
transfer or a shared seller account.

See `supabase/tests/0096_chains.test.sql` and
`supabase/tests/0097_item_transfers.test.sql` for the authorization and transfer
contracts. Store-owned inventory and acceptance are described in
[PURCHASES.md](PURCHASES.md) and [ARCHITECTURE.md](../ARCHITECTURE.md).
