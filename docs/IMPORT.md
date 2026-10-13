# Import from the previous system

Roadmap 3.3: "Import as a staged operation: files in, model proposes
mapping, preview, approve, commit; provenance kept per imported row." This
seller flow uses staged operations; explicitly confirmed item imports register
new intakes under current terms. Historical stock and balances remain separate.

## Sellers (delivered)

- Page `/intake/import` (menu: Sellers), owner or admin. The CSV file is
  parsed in the browser (`parseCsv`: comma or semicolon, quotes, CRLF, BOM);
  the header names are matched against a fixed list of Swedish and English
  names (`guessMapping`), and the person can change every column. The
  preview shows all accepted rows up to the 200-row limit and why others are left out (no
  name, neither e-mail nor phone, invalid e-mail). No AI is involved yet; a
  model-proposed mapping is a later step behind the same review.
- Staging posts one `importSellers` operation with the file name and up to
  200 rows to `/api/import`. Nothing is registered by the upload.
- The single Import button on the preview stages and approves the reviewed
  snapshot through the existing authenticated APIs, using stable proposal and
  decision IDs for retries. No separate queue review or reason is required.
  Only a verified executed decision shows completion on the same page.
  Approval registers every row through
  `register_seller` as the approver. A row whose e-mail already belongs to a
  seller of the store is skipped; the access event `sellers.imported`
  records created and skipped counts. Low risk: the person who staged may
  approve, so a store with one person can import.
- The operation payload is the provenance: file name and the rows as
  staged, kept with the decision.

## Items as new intakes

Owners/admins open Import items under Goods (`/intake/import/items`).
Download the CSV template, keep its six headers (`reference`, `sellerId`,
`email`, `description`, `price`, `currency`), replace the example and check up
to 200 rows. Preview is read-only. After checking every row, confirm that the
goods are physically in the store and click Import.

Every row needs a unique source reference, description, positive decimal price
and the store's explicit currency. Prices accept a decimal comma or dot, up to
two decimal places, up to 999999.99, without thousands separators; no conversion or rounding is
guessed. Use an existing Komisio seller UUID, exact current email, or both if
they agree. Duplicate emails require an ID. Names are never fuzzy-matched.
The template's headers are fixed across UI languages; column order may change.

The preview keeps every row and lists corrections, including both occurrences
of duplicate references. A private JSON report can be downloaded. All errors
must be corrected before import. Matching is tenant-scoped, owner/admin and MFA
protected. File structure and row limits fail without dropping rows.

The engine composes reception, staff price evidence, physical receipt and
commercial acceptance in one transaction, using the ordinary quick reception
rules. Current store policy and seller-specific commission apply; existing
agreement requirements, VAT, seller-month fees, sale periods and plan limits
are preserved. Stores requiring full intake or individual seller review must use
their normal reception workflow. Preview pins policy, agreement and seller-term
versions; changed terms or seller lookup information require a fresh preview.
An error anywhere rolls back the whole batch, including receipts and fees.

Immutable access events retain the source file name, exact confirmed rows,
actor and resulting item links. Source references are unique across all item
imports in the same store, independent of file name. An identical reference and
item payload is skipped; changed facts conflict, never overwrite or restock.
Keep original references when splitting or retrying a file. A different reference
is a different item; this does not detect goods already registered manually.
An uncertain response locks the request snapshot for safe retry. The result
shows created/skipped counts and links to the actual items and their new Komisio
references. Source references do not replace Komisio label/barcode identities.

## Products from a connected POS

Owners/admins use `/intake/import/pos` for PayPal POS and Shopify. Fetch a
bounded catalog page, search the fetched rows, and review each product variant.
More pages are fetched explicitly. Exact Komisio references suggest matches;
staff always choose whether to link an existing item or receive a new
consignment. Existing store-owned items can be linked; new ones must first use
the purchase workflow. Price and currency must agree when linking.

New consignments require an existing seller and confirmation of physical custody
of one unit. They use the same current-terms reception engine as file imports.
Known quantities other than one are refused. PayPal catalog reads do not provide
stock quantities; Shopify untracked stock is also shown as unknown. The review
is actor/account-bound and source facts are checked again before committing.

Immutable links retain provider, account, product, variant, SKU and barcode.
The source catalog is never changed: no product creation, stock initialization,
image copying or replacement of an existing barcode. Continue using existing POS
labels; new Komisio labels do not update the source barcode. Source-managed
products are excluded from outbound catalog updates, so price and stock changes
remain in the POS for now. Item status and search distinguish **Linked** from
**Synced**.

Sales after the link time can match the provider identity through the existing
receipt integration. Its connection, retrieval/automation, channel and location
settings still apply. Historical sales are not applied to the new intake.
Whole-line refunds reuse the original sale and ordinary return rules. Duplicate
imports, simultaneous confirmations and lost responses cannot create another
item for the same source variant. A different variant remains a separate product;
matching by description is never automatic.

## Not imported

Historical terms, balances, agreements, sales, photos and store-owned purchases.
Importing balances would create ledger rows from an outside source and needs
its own decision. The MCP tools "propose import
mapping" and "commit import" follow when a model proposes the mapping.

## Verification

`supabase/tests/0100_import_sellers.test.sql` (validation, staging without
writes, preflight count of known e-mails, approval by the same person,
skipped duplicates, counts, queue filter, read-only refused) and
`tests/unit/import-sellers.test.ts` (parser, mapping guess, row mapping,
payload bounds).
Inventory preflight is covered by `0292_inventory_import_preflight.test.sql`,
`tests/unit/inventory-import.test.ts` and a browser journey checking correction,
private report, mobile layout, tenant changes, staff denial and absence of
inventory writes during preview. `0313_inventory_import.test.sql` checks actual
import, replay, immutable references, atomic rollback, agreement and access
guards. `inventory-import.spec.ts` tests confirmation, lost responses and renamed
files in the browser; `inventory-import-race.mjs` proves concurrent imports of
the same source reference create one item.

POS coverage includes `0314_pos_catalog_import.test.sql`, adapter and review-token
unit tests, `pos-import-race.mjs`, and `pos-import.spec.ts` (both providers,
paging, 301 sellers, lost responses, existing-item linking and mobile layout).
External provider responses are synthetic in automated tests; these do not
establish acceptance against a live merchant catalog or a physical scanner.
