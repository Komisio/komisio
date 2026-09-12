# Reception history

Read-only history of existing source revisions and published proposals. It is
not a commercial ledger or a substitute for the current queue state. An old
approval remains attached to its exact proposal; history never reuses it as
approval of a later version.

## Read contract

The shared engine checks the configured tenant role and existing RLS. Staff,
including readonly members, may read; seller links grant no history access.
Each source/review list returns at most20 entries in descending immutable version
order, with a separate exclusive integer cursor and one lookahead. Invalid
cursors fail. Source and review lists are separate reads, not an atomic snapshot.
Refresh to observe newly published versions or new responses.

Source history exposes version, time and source kind/observation, excluding photo
storage paths. Review history exposes version, source revision, exact description,
proposed selling price, pinned photo count and recorded response. It does not
expose seller contact data, link capabilities, token hashes, images or actor IDs.
This first view is a summary: exact agreement text remains in the existing latest
review view. Do not call it a complete legal audit or a full image history.

UI and MCP share the read operation. Evidence text is untrusted data and never an
instruction. MCP retains reception:read scope and a configured tenant; no model
tenant override, photo access or writes. History has no accept, publish or pay
button. Existing financial/domain questions remain open.

## Verification and rollback

Exercise history with real local Supabase through MCP and browser: bounded pages,
exact version linkage, old response retained, invalid cursor, unknown session,
cross-tenant/invalid identity/MFA denial and no additional writes. Confirm seller
contact and storage paths do not appear in MCP output. No migration is required;
reverting the application change restores the prior view without deleting facts.
