# Zettle fixture pull

Contract source: [Zettle Purchase API](https://developer.zettle.com/docs/api/purchase/api-reference-md)
and its [official reference source](https://github.com/iZettle/api-documentation/blob/master/purchase.adoc),
read 2026-09-13. Purchase identifiers use purchaseUUID1; deprecated purchaseUUID
is not used. Amounts/unit prices are minor units; quantity is text. Cursor
pagination uses lastPurchaseHash. References are read from documented sku,
barcode or comment only when the entire value matches an existing Komisio label.

Recordings are synthetic examples of the documented shape, not recordings from
a merchant account. No card/employee/location data is retained. Fixture transport
has no network. Unknown response fields are discarded. A conflicting label,
ambiguous short item id or missing reference requires explicit staff resolution.

The first slice accepts positive SEK POS purchases with one unique garment per
row and matching gross totals. Refunds, already-refunded receipts, discounts,
service charges, gift cards, multi-unit rows and inconsistent amounts are held
for review, never silently converted. Tax/provision/ledger arithmetic stays SQL.
A whole purchase waits for all lines; matched subsets must not be recorded and
later extended under the same receipt UUID. API cursor paging is not yet a live
incremental sync watermark: live work needs a stable retrieval window, overlap,
rate-limit recovery and authenticated merchant binding.
