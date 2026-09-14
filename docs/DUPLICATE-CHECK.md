# Duplicate check

Status: sellers delivered 2026-09-14 (migration `20260916220000`); exact
photo repeats delivered 2026-09-14 (migration `20260916230000`); photo
similarity designed, not built.

Two things get registered twice in a second-hand store: the same person, when
the counter cannot find them and creates a new seller record, and the same
garment, when a photo set is uploaded again or an item is received a second
time. Komisio treats both the same way: the engine shows the evidence, a
person decides, and nothing is merged or deleted automatically. A wrong
automatic merge would move ledger entries, agreements and custody between
people; a wrong automatic delete would destroy a source. Neither is
recoverable, so neither is automatic.

## Sellers

`seller_matches(tenant, name, email, phone)` returns up to five sellers of
the store whose e-mail is the same (case-insensitive, trimmed), whose phone
number is the same once spaces, dashes, brackets, the `00` and `+46`
prefixes and the trunk zero are removed, or whose name is the same
(case-insensitive). Each match carries its reasons, strongest first. Any
member may read it; it writes nothing.

The registration form on `/intake` calls the read before it registers. When
there are matches, the form shows them with a link to each seller and the
reasons, and the button changes to "Register anyway". Only that second
click registers. The page cannot be bypassed by a fast double click: the
first submit never reaches the engine while matches are unread. Editing a
field clears the warning and the next submit checks again. Agents that
propose a registration (none today) would call the same read and stop on a
match.

What the check does not do:

- It does not block. Two people can share a phone or a household e-mail;
  the counter knows which is which.
- It does not merge. A merge is a future engine operation with its own
  decision: it would have to re-point items, bags, agreements, ledger
  entries and communications from one seller to another as new rows with
  provenance, and be refused while either seller has a payout in flight.
  Until that operation exists, the way to correct a duplicate is to keep
  using the older record and leave the newer one empty; the sellers list
  shows which records hold nothing.
- It does not record dismissals. The registration itself is the record: a
  new seller created after the warning has a later `created_at` than the
  match, and the audit event `seller.registered` names the actor.

## Photos and items

The earlier system indexed image embeddings and showed nearest neighbours
with a score. Komisio keeps the same outcome with a two-step design:

1. **Exact repeat, no model (delivered).** The upload route records a
   content digest (SHA-256 of the stored bytes) per photo in
   `reception_photo_digests` through `record_photo_digest`; rows are
   immutable and a different digest for the same photo id is a conflict.
   `photo_duplicates(tenant, session)` lists, per photo of a reception, up
   to five earlier receptions of the store with the same bytes, and the
   reception page shows them with a link and the seller. No provider, no
   cost; it catches the common case: the same file uploaded twice, or a
   seller's photo set resubmitted. Agents read the same facts through
   `komisio_read_photo_duplicates` under `reception:read`, without names.
   Photos uploaded before the migration
   have no digest and are not compared.
2. **Similar garment, with a model.** Perceptual similarity needs an
   embedding per photo from an image model, stored as a vector, and a
   nearest-neighbour read scoped to the store's items received in the last
   N days (a policy value; default 90). This is an assistance feature under
   the existing assistance port: the provider is optional, the attempt is
   metered as usage, and the read returns candidates with a score and the
   photo pair so a person can compare. Candidates are shown, never acted
   on: the person either opens the candidate item (it is the same garment,
   received before) or continues (it is not). A dismissal is recorded as an
   item event `duplicate_dismissed` with the candidate id, so the same
   candidate is not shown again for that item and the decision is
   auditable.

Step 2 waits for the assistance provider decision that
also gates the AI-first inspection; it adds a dependency (`pgvector` is
available on Supabase; a `DECISIONS.md` line is required before use) and
a cost per photo. Cross-store similarity is out of scope: photos are
store data and never leave the tenant.
