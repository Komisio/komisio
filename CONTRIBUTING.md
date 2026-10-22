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

## Review and merge access

Anyone may fork the public repository and submit a pull request. Contributing
does not grant write access or permission to merge. ChrilleInority currently
maintains merge access; additional maintainers require an explicit owner decision.

External contributions require the owner's explicit approval of the reviewed
version before an agent merges them. Changes after approval require renewed
approval. Owner-directed internal agent work has separate standing authorization.

GitHub enforces pull requests and resolution of review conversations. Maintainers
review against current main and run relevant checks locally before merging.
The full `platform` CI runs after merge on main, not on PR updates. Staging
publication requires successful `platform` and `staging-migrations` checks for
that commit; a failed run leaves the previous staging application in place.
Main can temporarily be red and must be fixed or reverted through a PR.
Force-push and deletion of main remain blocked; the ruleset has no bypass actors.
These controls also apply when the owner merges. No automatic external-contributor
merge is set up. Tests do not replace review of design and intent.

There is no global second-reviewer requirement while there is only one
maintainer. External approval is the owner's review/merge policy, not a separate
GitHub rule that distinguishes internal from external authors. Revisit required
reviews and CODEOWNERS before granting additional write permissions.

## Local development batches

Owner-directed feature work is collected in a `batch/*` integration branch,
normally 4–5 PRs per staging release. Start each feature from the current batch,
target its PR at that branch, and review it with the relevant local checks before
merging. Report the commands and outcomes in each PR. Database and concurrency
changes still need their corresponding regression tests; local test data must
not target hosted databases or live providers. See the checks in
[`docs/SELF-HOSTING.md`](docs/SELF-HOSTING.md#checks).

For a focused feedback loop, run the relevant unit files with
`npm test -- tests/unit/<name>.test.ts` and browser journeys with
`npm run test:e2e -- tests/e2e/<name>.spec.ts`. Use the appropriate fixture config
for provider journeys. Run lint, typecheck and build for application changes;
run database and concurrency suites when their invariants change. Validate the
combined batch and shared regression paths before preparing its release PR.

Automatic Vercel Git builds are enabled only for `main` and deliberate
`preview/*` branches. Working branches must contain the current `vercel.json`
before pushing to inherit this behavior; existing previews are not deleted.
Do not create preview branches just to run tests.

When the owner requests staging, open or complete one reviewed batch-to-main PR.
Reconcile any intervening main changes and rerun affected checks before merging.
The complete platform CI and staging migration checks run for the resulting main
commit. Until those pass, the previous staging release remains published.
Production uses the existing separate protected release process. A locally
verified feature or merged batch PR is not evidence of a deployed release.

## Decisions

`DECISIONS.md` is append-only: one line, `- YYYY-MM-DD: <decision>: <why>`, at
most 300 characters, which a unit test checks. Read the log before re-opening a
past decision.

Put the reasoning in the pull request body, not in a new file. Why this
approach, what you rejected, what you verified: that belongs next to the diff
it explains. `docs/` is for what a reader needs later, such as a contract, an
integration, or how to run the thing yourself.

## Working with AI agents

Agents follow `CLAUDE.md`. Contributors using agents are responsible for what
the agent produces, including the sign-off.
