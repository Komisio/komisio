# Zettle API adapter

Current official references, checked2026-09-13:

- [Product Library OpenAPI](https://developer.zettle.com/docs/api/product-library/reference)
- [Create products](https://developer.zettle.com/docs/api/product-library/user-guides/manage-products/create-products)
- [Purchase API](https://developer.zettle.com/docs/api/purchase/api-reference-md)
- [Inventory API](https://developer.zettle.com/docs/api/inventory/reference)
- [FAQ: no sandbox](https://developer.zettle.com/docs/faq)

The older `iZettle/api-documentation` repository is deprecated; current developer
site specifications govern this adapter. No third-party source code is copied.

`http.ts` uses fixed official API hosts, an injected token provider, bounded JSON,
timeouts, no redirects, merchant identity verification and conditional ETag PUT.
A retry GET reconciles a lost create/update acknowledgement using stable UUIDs.
401/403,429 and5xx are surfaced without blindly replaying mutations. The app only
wires this adapter to the loopback HTTP simulator today; OAuth activation is pending.

`catalog.ts` describes the managed one-variant product. `purchase.ts` minimizes
receipts; purchaseUUID1 is the external receipt identity, monetary amounts are
minor units, quantity is text, and lastPurchaseHash is pagination. Exact exported
product/variant IDs are preserved for engine matching. Card/employee/location
fields are discarded. Unsupported financial cases stop for resolution.

The simulator is original synthetic data shaped after these specifications, not
recorded merchant traffic. It deliberately does not claim inventory coverage.
See [workflow, tests and live prerequisites](../../docs/ZETTLE-FIXTURE-PULL.md).
