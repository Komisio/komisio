# Import from the previous system

Roadmap 3.3: "Import as a staged operation: files in, model proposes
mapping, preview, approve, commit; provenance kept per imported row." This
first slice imports sellers; items and balances are separate decisions.

## Sellers (delivered)

- Page `/intake/import` (menu: Sellers), owner or admin. The CSV file is
  parsed in the browser (`parseCsv`: comma or semicolon, quotes, CRLF, BOM);
  the header names are matched against a fixed list of Swedish and English
  names (`guessMapping`), and the person can change every column. The
  preview shows the first ten accepted rows and why others are left out (no
  name, neither e-mail nor phone, invalid e-mail). No AI is involved yet; a
  model-proposed mapping is a later step behind the same review.
- Staging posts one `importSellers` operation with the file name and up to
  200 rows to `/api/import`. Nothing is registered by the upload.
- Approval in the operations queue registers every row through
  `register_seller` as the approver. A row whose e-mail already belongs to a
  seller of the store is skipped; the access event `sellers.imported`
  records created and skipped counts. Low risk: the person who staged may
  approve, so a store with one person can import.
- The operation payload is the provenance: file name and the rows as
  staged, kept with the decision.

## Inventory-file preflight

Owners/admins can open `/intake/import/items` from the seller-import page.
Download the CSV template, keep its six headers (`reference`, `sellerId`,
`email`, `description`, `price`, `currency`), replace the example and check up
to 200 rows. This is a read-only preparation tool, not an inventory import.

Every row needs a unique source reference, description, positive decimal price
and the store's explicit currency. Prices accept a decimal comma or dot, up to
two decimal places, without thousands separators; no conversion or rounding is
guessed. Use an existing Komisio seller UUID, exact current email, or both if
they agree. Duplicate emails require an ID. Names are never fuzzy-matched.
The template's headers are fixed across UI languages; column order may change.

The result keeps every row and lists corrections, including both occurrences
of duplicate references. A private JSON report records the checked snapshot.
Files and reports are not persisted by the server. Matching is tenant-scoped,
owner/admin and MFA protected. File structure and row limits fail visibly
instead of dropping rows. Passing the check does not establish custody,
ownership, historical agreements, commission, VAT, or absence of duplicates
in an earlier system or a previous file.

## Not imported

Items, balances, agreements and history. Importing balances would create
ledger rows from an outside source and needs its own decision; importing
items needs custody and terms per item. The MCP tools "propose import
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
inventory writes.
