# Scoped discovery of staged operations

An agent can currently read a known operation but cannot discover pending IDs.
Add komisio_list_reception_operations (reception:read) and
komisio_list_inspection_operations (inspection:read) through the shared paged
engine. Tool names pin publishReceptionReview / saveInspectionDraft respectively;
inputs cannot override kind or tenant. Existing identity, role, MFA and RLS checks
apply per call. These local scopes restrict tools, not the underlying user token.

The additive operation_queue_filtered_page accepts a validated kind or null for
all staff-visible kinds. Filter before limit21, then display20 and use the last
visible row as an exclusive full-precision timestamp/UUID cursor. The existing
operation_queue_page delegates to this with null; legacy operation_queue is left
unchanged. Status semantics and decision commands are unchanged. This remains a
live list, not an across-page snapshot or total count.

MCP summaries contain operation ID, kind, risk, status, creation and expiry times.
No proposal payload, contact, actor identity/label, source reference, decision
reason or image is returned. readOnly/evidenceIsUntrusted/guidanceOnly are explicit.
Use the existing scoped exact read for details; no agent decision tool is added.

Tests must interleave more than50 proposals of different kinds, prove filtering
before limiting and page continuity, keep the old UI RPC compatible, and deny
unknown kind/status, unpaired cursors, wrong tenant, missing scope and MFA.
Exercise the real stdio MCP transport with synthetic local data, and rerun the
staff paging browser because its RPC becomes a wrapper. Apply only the additive
migration to staging before release; rollback app callers can use the old RPC.
