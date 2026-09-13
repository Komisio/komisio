# Store profile

The store's public-facing text as one versioned document: address, contact,
opening hours, what the store accepts and its concept. It replaces the earlier
info-page CMS and its translations register (roadmap 3.1): one profile, kept
current by the owner or by an agent proposal the owner approves, rendered by
the seller app and later the public page.

## Shape

| Record                   | Meaning                                                                            | Mutability  |
| ------------------------ | ---------------------------------------------------------------------------------- | ----------- |
| `store_profile_versions` | One published version: the profile document, its number, the version it replaced | Append-only |

The document is validated in SQL and at the boundary: address (street,
postal code, city), contact (e-mail, phone, https website), opening hours as
at most seven rows of weekday, opens and closes (`HH:MM`, opens before
closes, each day once; a missing day is closed), `accepts` and `concept`
texts of at most 2000 characters, and the language of the text (`sv` or
`en`). No other keys.

## Rules enforced in SQL

- `current_store_profile(tenant)`: members of any role; the current version
  with its id, or version 0 with a null profile.
- `public_store_profile(slug)`: anyone, anonymous included; the store name,
  slug, version and profile, or null when the store has no profile. Nothing
  about members, sellers or earlier versions. The profile is public by
  definition; publishing it is the act of making it public.
- `publish_store_profile(tenant, id, expected_current, profile)`: owner or
  admin; the expected current version must be the current one
  (`PROFILE_CHANGED`), replay by id returns the version, the same id with
  another document is `REQUEST_CONFLICT`. Every version stays; rows are
  immutable.

## Staged kind

`updateStoreProfile` (`low`) stages the next version with the current
version id. Preflight refuses a stale id. The proposing person may approve,
but execution is the ordinary publish, so only an owner or admin approver
publishes; a staff approval records `failed|FORBIDDEN` and changes nothing.
The queue shows the proposed concept and accepts texts; the review page marks
the proposal stale once another version was published.

MCP: `komisio_read_store_profile` (`store:read`) and
`komisio_propose_store_profile` (`store:propose`).

## Surface

The settings page carries the profile form under the store policy: owners
and admins publish, everyone else sees the current text. Translation on read
by a model, the seller app rendering and the public page are later slices;
the read model is ready for them.

## Verification

`supabase/tests/0055_store_profile.test.sql`: validation, publish, replay,
conflict, stale expected version, member and anonymous reads, staff refusal,
the staged kind with a failed staff approval and an owner approval, queue
filter and immutability. `tests/unit/staged-kinds.test.ts` covers the payload
shape; `scripts/test-proposals-mcp.mjs` reads, stages, approves and re-reads
through the MCP boundary.
