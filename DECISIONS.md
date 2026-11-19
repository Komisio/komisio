# Technical decisions

This log records public engineering constraints. Product contracts are documented
in [ARCHITECTURE.md](ARCHITECTURE.md) and the relevant integration guides; database
tests specify their executable boundaries.

Describe proposed behavior and tradeoffs in the issue or PR before changing code.
Do not infer legal or financial rules from a prompt or an implementation detail.
Use a focused regression test for a changed invariant.

Each entry is one dated line of at most 300 characters. Deployment records,
business planning and installation-specific procedures do not belong here.

<!-- technical-decisions -->

- 2026-11-19: Financial writes pass through the engine and database commands; UI, MCP and integrations share the same tenant and permission boundaries.
- 2026-11-19: Financial and legal facts remain immutable. Corrections append evidence; additive migrations preserve already-applied database history.
- 2026-11-19: Runtime authorization is enforced by RLS, grants, identity and tenant checks. Documentation and model prompts confer no access.
- 2026-11-19: Money uses decimal database arithmetic rounded to currency minor units; client floats are not authoritative financial calculations.
- 2026-11-19: Product code, tests and public documentation build independently of private working material. Optional local contributor guidance is ignored by Git.
