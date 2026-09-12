# Find older staged operations

The original operation_queue(uuid) returns only the newest 50 proposals. Keep
that RPC unchanged for existing callers and add an authenticated, RLS-enforced
operation_queue_page read for the staff queue. It returns at most 21 rows: the
engine displays 20 and uses the extra row only to indicate another page.

Filter by all/open/expired/executed/failed/rejected, using the same derived status
as the original queue. Default all preserves the existing view. Order by creation
time descending and UUID descending. The exclusive older cursor contains both
values from the last displayed row. Preserve the timestamp string's full database
precision; never round through JavaScript Date. Both cursor parts are required,
infinite timestamps and unknown filters are rejected. First-page/filter links
clear the cursor; older links retain the selected status.

This is a live list, not a transaction spanning pages. New proposals and decisions
can change visible results; reload the first page for current work. Every page
rechecks tenant membership and MFA via the existing role/RLS boundary. Status is
guidance only; the existing decision command is still authoritative. No write,
new table, permission, financial rule or MCP scope is introduced.

Test more than 50 proposals, tied timestamps and microseconds, multiple pages,
status filters, invalid paired cursors, outsider/anonymous/MFA denial, readonly
access and no mutation. The UI exposes no decision outside the existing exact
operation detail page. Apply the additive read function before deploying its
caller; rollback can use the old RPC without changing data or dropping history.


Scoped MCP discovery adds a kind-filtered shared read in migration20260912173000.
The four-argument page RPC delegates to it with all kinds; the legacy newest50
RPC stays unchanged. Kind is filtered before limiting. See
[MCP-OPERATION-DISCOVERY.md](MCP-OPERATION-DISCOVERY.md).
