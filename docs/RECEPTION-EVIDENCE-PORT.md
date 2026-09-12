# Provider-independent reception evidence

Functional roadmap P1 calls for one assistance boundary. Keep the existing
suggestReception port and narrow its input rather than adding a competing engine.
A provider receives only sources: citation ID, kind, observation and the supplied
reference for non-photo evidence. Photo references (Storage paths), tenant,
session, seller and revision stay with the authenticated orchestrator. Reduced
photo bytes are still loaded under the existing identity/revision checks.

No runtime prompt, OpenAI wire payload, model setting, spend guard or database
contract changes. Providers still return the existing strict suggestion schema.
Validate identity/provenance using the original isolated session, never a mutated
provider input; reject unknown source IDs and price without supplied price
sources. Normalize all descriptive facts to tentative after validation, even for
future adapters that return observed. Explicit staff field review remains the
path to review preparation; AI cannot attest that the human reviewed a fact.

The port is an application convention, not a process sandbox. Third-party code
running in the server could access process resources independently; untrusted
plugins must not be loaded. Observations, references and image pixels may contain
personal information and are not automatically redacted. Tenant-pinned local MCP
still uses its scoped reads and staged commands; this change does not add an MCP
provider call, hosted agent or new permission.

Tests capture a non-OpenAI adapter input, assert internal identities and photo
paths are absent while citation evidence survives, reject authority injection and
mutated provenance, and require explicit review even when an adapter claims
observed certainty. Existing HTTP fixtures must retain their outgoing payload and
publication/retry behavior. No live model activation or quality claim.
