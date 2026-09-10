# Contributing

## Language

- English for all code, identifiers, comments, commit messages and documentation.
- The user interface is Swedish and English through message files.
- Swedish legal and domain terms are kept where precision requires it
  (avräkningsnota, vinstmarginalbeskattning, kassaregister), with an English
  explanation the first time they appear in a file.

## Rules that are not style

- Business rules are written down in `DECISIONS.md` **before** they are
  implemented, and every rule is proven by a test. A trigger is code and can
  be wrong; the test is what shows the rule holds.
- All writes with financial consequence go through the engine (see
  `ARCHITECTURE.md`). Never through direct table access, never through an
  extension.
- Money is `numeric`, rounded to öre in the database. Never float.
- Corrections are new rows. Nothing that has legal or financial weight is
  edited or deleted in place.

## Commits and pull requests

- Small, scoped changes. A PR does one thing.
- Sign off every commit (`git commit -s`) to certify the Developer
  Certificate of Origin (`DCO`). No CLA.
- A PR that adds or changes a rule links the `DECISIONS.md` line and the test.
- A PR that touches the schema includes the migration and the pgTAP test that
  exercises it. CI runs the tests against a real PostgreSQL.

## Decisions

`DECISIONS.md` is append-only: `[YYYY-MM-DD] <decision>: <why>`. Read the log
before re-opening a past decision.

## Working with AI agents

Agents follow `CLAUDE.md`. Contributors using agents are responsible for what
the agent produces, including the sign-off.
