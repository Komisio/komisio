# Platform pilot acceptance

Updated 11 September 2026. Use this checklist to distinguish a working preview
from a platform ready for more pilot users. Record real identities, deployment
IDs and operational evidence privately; use fictional examples in public issues.

## Current position

- Hosted registration and invitation-email receipt have been observed.
- Callback return-path recovery is fixed and verified on staging.
- Local tests cover invitation replacement/replay and permissions for three
  identities across two stores. These do not replace a hosted walkthrough.
- The reported hosted invitation-acceptance failure remains unconfirmed.
- Lost-device MFA recovery and a complete backup/restore exercise remain open.

## Owner walkthrough: invitation and recovery

Use only designated pilot identities and the fixed staging origin.

1. As the store owner, open People and issue one invitation to the intended
   pilot mailbox. Note the issue time privately. If an invitation is deliberately
   replaced, use only the newest message for the successful path.
2. Open the invitation. If the displayed account is wrong, use Sign out on the
   invitation page, then sign in with the invited address. Confirm the invitation
   path is preserved.
3. If the address has no account, choose Create account. Confirm the text explains
   joining an existing store. Open the verification email in the same browser.
4. Accept once. The expected result is the existing store's overview, not a new
   store form. The owner should see an active member rather than a pending invite.
5. Sign out and in again. Confirm the membership still exists and the assigned
   role is correct. Do not interpret a replayed-link error as proof the first
   acceptance failed; check the overview and member list.
6. With a separate intentionally replaced test invitation, confirm the old link
   fails safely and offers recovery guidance. Do not weaken token validation.
7. Exercise password recovery for the pilot identity, including an invalid or
   reused confirmation link. Record success separately from ordinary signup.

If acceptance fails, record the time, requested action, displayed account and
whether the message was replaced. Keep invitation URLs and tokens out of issues,
screenshots and normal logs. Compare the invitation's status, expiry, recipient
match and inviter authority privately before attributing the failure to a cause.

## Permission walkthrough

- Owner: create/switch stores and administer permitted roles.
- Admin: manage staff/readonly members and store details; cannot create another
  admin or owner through either the UI or a direct request.
- Readonly: view permitted pages; cannot administer the store or invite users.
- Cross-store identity: owning store B must not elevate readonly access in A.
- Removal: removing membership in A must retain the account and any membership in B.
- Stale tab: a form opened for A must not silently write to B after a store switch.
- MFA: incomplete second-factor verification must not grant store access.

Use the automated suite as regression evidence and record the hosted outcomes
independently. Never point the local data-creating browser suite at staging.

## Operational decisions and drills

| Item | Next concrete action | Evidence needed before closing |
| --- | --- | --- |
| Lost MFA device | Agree who may verify identity, what evidence is acceptable and how recovery is audited; verify the procedure with a synthetic account | Documented policy and successful rehearsal; no informal factor bypass |
| Backups | Inventory database/Auth data, configuration and any stored objects; define recovery-point and recovery-time targets | Approved scope and retention, with access restricted to designated operators |
| Restore | Rehearse restoration into a separate disposable target, with outbound email disabled | Measured restore time, data checks and successful identity/role journeys on the restored target |
| Application rollback | Identify the previous verified deployment and check compatibility with applied migrations | Successful rollback rehearsal or explicit pending status; application rollback is not database restoration |
| Monitoring | Choose recipients for availability, auth/delivery failures and provider spending alerts | Test alert receipt and document who acts on it |
| Invitation delivery | Keep the pilot allowlist while durable send limits and bounce/complaint handling are absent | Verified controls before widening delivery |
| Account lifecycle | Agree retention and deletion behavior, including sole ownership and audit attribution | Recorded decisions and tests before implementing destructive lifecycle operations |

Do not restore over the live staging database during a drill. Avoid sending mail
from restored data. If the isolated target would require a purchase or new
provider configuration, record that dependency before provisioning it.

## Release evidence template

For each accepted revision, record:

- Commit and merged PRs; CI outcome for the relevant revision.
- Deployment result and public reachability checks.
- Which authenticated journeys were exercised, in which environment.
- Known limitations and unresolved failures.
- Rollback target and compatibility notes.

Keep secrets, real email addresses and account identifiers in private operational
records. A green CI badge plus a working login page is not sufficient to close
the multi-user, recovery or restore gates.

## Next gate

Once these platform questions have an accepted outcome, review the minimal
consignor/intake workflow before implementation. Financial rules, AI write tools
and subscription billing remain separate milestones.
