# Platform work results — 11 September 2026

The autonomous work session concentrated on making the existing platform easier
to join and verifying its access boundaries. Intake remains a workflow proposal,
not a new schema or implemented store operation.

## Delivered through reviewed, tested pull requests

| Area | Outcome | Pull requests |
| --- | --- | --- |
| Confirmation recovery | Failed callbacks retain safe invitation destinations | [#1](https://github.com/Komisio/komisio/pull/1) |
| Invitation validity | Browser/API coverage for replaced links, wrong identities and replay | [#2](https://github.com/Komisio/komisio/pull/2) |
| Recovery guidance | Latest-link help, overview navigation and account switching that preserves the invitation | [#3](https://github.com/Komisio/komisio/pull/3) |
| Project status | Roadmap and deployment evidence reconciled with staging | [#4](https://github.com/Komisio/komisio/pull/4) |
| Role isolation | Three identities across two stores, admin and readonly boundaries | [#5](https://github.com/Komisio/komisio/pull/5) |
| Invited registration | Explain the personal account, existing store and confirmation-link requirements | [#6](https://github.com/Komisio/komisio/pull/6) |
| Intake planning | Review earlier prototypes, simplify the workflow and surface unresolved decisions | [#7](https://github.com/Komisio/komisio/pull/7) |
| Pilot readiness | Concrete owner walkthrough and pending operational recovery checks | [#8](https://github.com/Komisio/komisio/pull/8) |
| Anonymous language | Invitation pages respect the chosen browser language | [#9](https://github.com/Komisio/komisio/pull/9) |
| Keyboard onboarding | Identifier hint exposed to assistive technology; Tab/Enter journey verified | [#10](https://github.com/Komisio/komisio/pull/10) |
| Language continuity | English survives confirmation and store creation; account language changes persist | [#11](https://github.com/Komisio/komisio/pull/11) |

## Verification

- Seven complete local browser journeys pass against the standalone application.
- 28 unit tests pass; lint, formatting, TypeScript and production build checks pass.
- GitHub's platform checks also run the database assertions and concurrent-owner
  test. Each listed PR passed its required checks before merge.
- Staging read-only checks verified login/registration forms, anonymous write
  denial, safe callback recovery, invited signup guidance and the anonymous
  English invitation page as the relevant changes were deployed.
- Full authenticated hosted journeys are distinct from local test evidence.
  No new email was sent to real recipients during unattended work.

## Still open

**The original hosted invitation-acceptance incident is not conclusively solved.**
Recovery defects were reproduced and fixed, and validity rules were tested. The
exact failed link from the walkthrough was not established. Use the latest-link
scenario in [pilot acceptance](PILOT-ACCEPTANCE.md) to close that incident.

Before broadening the pilot, agree and rehearse lost-device MFA recovery,
identity verification, backup restoration and operational alerts. These have
an actionable checklist; they are not completed drills.

The [intake proposal](INTAKE-WORKFLOW-PROPOSAL.md) needs decisions on physical
receipt versus acceptance, minimum consignor identity, price timing, batch
outcomes and draft ownership/retention. No financial rules, tables, payment
integration or AI write runtime were introduced during this session.

## Suggested next owner session

1. Complete the hosted invitation acceptance and password-recovery walkthrough.
2. Review the short three-step staff intake proposal against one real shop scenario.
3. Decide whether goods can be received before pricing, and what confirmation
   the consignor receives at that moment.
4. Choose the operational recovery policy before opening access more widely.

Source and working-tree state, exact deployments and private test evidence are
recorded in the private work log. The public source repository is not a claim
that Komisio is ready to process real sales or consignor payouts.
