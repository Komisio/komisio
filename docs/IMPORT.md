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

## Not in this slice

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
