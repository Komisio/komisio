# Explicit staff review of reception facts

Roadmap P1 calls for per-fact confirmation. The built-in assistance UI previously
promoted every candidate field to observed before a single shared confirmation.
Require an explicit checkbox for each included descriptive field and for the
price/evidence before the existing final publication confirmation. Model-supplied
observed certainty is never treated as staff review. Missing description/price or
unresolved questions still block publication under the existing engine contract.

A pure shared helper validates candidate and selection, keeps unconfirmed fields
tentative and derives whether all required confirmations are present. It does not
authenticate, persist, prove attention or grant write access. SQL still validates
identity, role/MFA, exact revision, sources, price evidence and terms at publication.
Reviewed fields are saved in the existing immutable review, with its staff actor;
no separate per-field audit event or legally stronger attestation is claimed.

The staged reception review UI requires the same included-field and price checks
before its final decision. Rejection needs no confirmations. A staged payload is
immutable: reject and re-propose if a field or price is wrong. The built-in AI
candidate can instead be abandoned in favour of the existing manual path; there
is no automatic resolution of model questions or fabricated replacement evidence.

Selections are local to the rendered review context. Changing a field selection
clears final confirmation. Source/review/terms changes remount the publication UI;
the built-in publication form locks selections during a pending or uncertain
write to preserve exact-request retries. Staged proposal payloads remain immutable.
Do not add MCP approval tools, new SQL authority flags or financial policy.
No migration or live provider activation is required. Test partial confirmation,
model-observed inputs, unsupported/duplicate selections, immutable candidates,
lost-response retries and the real HTTP-provider fixture through staff publication.
