# Contributing

## Scope and language

Discuss substantial behavior changes in a GitHub issue before implementation.
Use fictional examples and omit personal data and credentials. Code, comments,
documentation and GitHub communication are in English; UI translations belong
in the locale message files. Preserve precise domain terminology where needed.

## Architecture and data safety

- Document the intended rule before coding and cover it with a regression test.
- Financial writes go through the engine and its database commands, never direct
  client writes. See [ARCHITECTURE.md](ARCHITECTURE.md).
- Preserve RLS, grants, tenant checks and MFA. Do not weaken them to make tests pass.
- Use decimal database arithmetic rounded to currency minor units for money.
- Financial and legal corrections are new facts, not edits to existing evidence.
- Add new migrations instead of rewriting applied migrations. Never reset a
  hosted database or run fixture suites against real accounts.
- Explain new dependencies, changed contracts and unresolved domain assumptions
  in the PR. See [technical decisions](DECISIONS.md).

## Development and verification

Follow [SELF-HOSTING.md](docs/SELF-HOSTING.md) for local setup. Keep one coherent
change per branch and PR. For a complete application check:

```sh
npm run lint
npm run typecheck
npm run format:check
npm test
npm run build
```

Run `npm run test:db` for database changes, the relevant concurrency checks for
locking/idempotency, and `npm run test:e2e` for changed browser journeys. Focused
unit files and browser specs can be run during development. Use synthetic local
accounts and provider fixtures. Report exactly which checks passed and which
remain; a build does not prove a live integration works.

## Pull requests and review

Sign off each commit with `git commit -s` under the [DCO](DCO). Explain the problem,
resulting behavior, relevant tradeoffs and verification in the PR. Link the issue
and its acceptance criteria; mark a criterion complete only when verified.

Contributing does not grant write or merge access. Maintainers review the current
PR revision and resolve review conversations before merging. External contributions
require explicit maintainer approval of that revision. Do not bypass repository
protections, force-push shared branches or treat tests as a replacement for review.
Follow the PR's specified target branch; integration does not itself authorize a
deployment. Automated checks and deployment status are visible in GitHub Actions.

## Documentation

Public documents explain the product, supported contracts, reproducible setup and
contribution requirements. Keep short technical decisions in [DECISIONS.md](DECISIONS.md)
and implementation reasoning beside the PR diff. Do not add handoffs, internal
planning, account inventories or deployment evidence to public documentation.

Contributors using AI tools remain responsible for the resulting changes and
sign-off. Tool guidance starts at [AGENTS.md](AGENTS.md); it does not replace review.
