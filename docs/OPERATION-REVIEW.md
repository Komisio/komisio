# Review a staged reception operation

Staff inspect a specific immutable pending operation before approving. The list
is an overview; decisions belong on a detail page showing the exact proposed
metadata/price, cited source snapshot and agreement version. A link to the current
reception alone is not the proposal's evidence.

The shared read uses existing tables and staff RLS/MFA, with one operation ID and
bounded exact-key queries. UI and MCP use the same result. Text is untrusted data;
source URLs are rendered as text and photo storage paths are excluded. This slice
shows photo references, not image bytes; the protected reception remains the
image viewing surface. No seller contact or capability lookup is added.

Compare the current source revision, agreement ID and previous review ID with the
proposal to show a stale warning. This non-atomic read is guidance, not a lock or
authorization; decide_operation still rechecks everything transactionally.
Expired or stale proposals may be rejected but not approved in this UI. The
existing SQL transition rules remain unchanged. Already-decided operations are
read-only. No new core table, migration or commercial acceptance is introduced.

Verify through real MCP and browser: exact terms/sources visible, proposals
publish nothing until explicit approval, stale context disables approval while
rejection remains possible, wrong tenant/identity/MFA denial and no image paths.
