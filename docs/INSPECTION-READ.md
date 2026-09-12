# Shared inspection read

The bag inspection page and opt-in `komisio_read_inspection` MCP tool use one
engine read for saved descriptive drafts. The input fixes one bag, an optional
selected draft/version, archive filter and independent list/history cursors.
Each page returns at most20 entries plus explicit continuation information.
All reads require an existing staff membership and database RLS/MFA. The MCP
host fixes the tenant; a model cannot supply one in tool arguments.

This preserves the current UI behavior. Draft list, current selected draft,
historical fields and version summary are separate reads, not an atomic snapshot.
Writes still validate their expected revision. Historical versions are read-only
and never replace the selected current draft.

The MCP adapter requires explicit `inspection:read`, a confirmed authenticated
user and the same engine authorization. It omits bag notes and seller contacts;
draft text and change reasons remain untrusted data and can contain personal
information entered by staff. No image, price, consent, custody transition or
commercial acceptance is inferred. Local user credentials retain their underlying
permissions; this tool scope is not a delegated credential boundary.

This is a prerequisite for future AI assistance. It does not convert descriptive
drafts into observed reception evidence, fabricate source IDs, call a model or
persist any proposal. Existing pure inspection preview/selection contracts remain
unchanged. No migration or new domain rule is needed.

Verify real MCP pagination, selected history, archive filtering, unknown input,
wrong bag/draft/tenant, invalid identity and MFA denial; run the existing browser
inspection journey to verify that the extracted shared read preserves navigation.
