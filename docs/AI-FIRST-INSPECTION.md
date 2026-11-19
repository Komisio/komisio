# Retired inspection draft workflow

Retired in #458. The inspection draft UI,
storage, APIs and MCP tools described by this former document are removed.
Bag inspection now registers items through reception. See
[the current architecture](../ARCHITECTURE.md#direct-drop-off-registration).

Existing items retain IDs, prices, terms and later corrections. Source draft
text is deleted without a snapshot; label and list reads fall back to the item
reference when no later description exists. Financial records are retained.
