# Contributor guidance

Follow [CONTRIBUTING.md](CONTRIBUTING.md). Read [ARCHITECTURE.md](ARCHITECTURE.md)
for layer boundaries and [DECISIONS.md](DECISIONS.md) for technical invariants.

- Route financial writes through `lib/engine/` and database commands.
- Preserve tenant isolation, authorization, MFA and immutable financial evidence.
- Use additive migrations; do not edit migrations already applied to a database.
- Document proposed behavior in the issue or PR and verify it with relevant tests.
- Keep secrets, personal data and installation-specific working notes out of Git.
- Do not infer unresolved legal, tax, commission or payout rules; ask for clarification.
- Keep changes scoped and explain verification and limitations in the PR.

Use [self-hosting](docs/SELF-HOSTING.md) for setup and checks. Consult the installed
Next.js documentation before changing framework APIs. See [AGENTS.md](AGENTS.md)
for optional local guidance. No private repository is needed to build or test.
