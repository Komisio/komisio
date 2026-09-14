# Lost MFA device: operator recovery

Owner decision B2, 2026-09-14: no self-service recovery. The store owner verifies
the person, an authorized operator removes the lost factor in Supabase, logs the
action, and the person re-enrols. This is a procedure, not a new application
permission or an authorization to reset any real account during development.

## Before changing anything

1. Open a restricted support record, not a public GitHub issue. Record the case
   ID, UTC time, environment/project, affected Auth user UUID, relevant store
   UUIDs, requesting person, verifying owner and acting operator. Minimize personal
   data; never attach passwords, tokens, TOTP seeds, QR codes or identity documents.
2. The store owner verifies the person through an established independent channel:
   in person where possible, or by contacting the person through previously known
   details. A new email address, caller ID, knowledge of a store name or a claimed
   urgent deadline is not sufficient. Record the method and the owner's explicit
   approval, not the secret or document used to verify it.
3. The operator independently confirms the approving owner's authority and matches
   the exact Auth UUID to the account. MFA belongs to the person's account across
   stores, not to one membership. Record that scope before approval; do not assume
   removing a factor affects only the requesting store.
4. Arrange a short attended recovery window with the person ready to re-enrol on
   a trusted device. If identity, authority or account matching is uncertain, stop.
   If the requester is the only owner, obtain an independently verified approval
   from the platform owner; do not let the requester approve their own reset.
   If no independent verifier is available, escalate without changing access.

Suspected theft, compromised email/password or an unexpected MFA reset request is
a security incident, not routine lost-device recovery. Escalate to the platform
owner for containment and session-revocation decisions before removing a factor.
Factor removal alone is not proof that existing sessions are invalidated; access
tokens can remain usable until expiry. See [Supabase sessions](https://supabase.com/docs/guides/auth/sessions).

## Operator: remove only the approved factor

1. Use your own MFA-protected Supabase operator account and select the recorded
   project/environment. This concerns a **project Auth user**, not the operator's
   Supabase platform account.
2. In **Authentication → Users**, open the user and compare the UUID with the
   approved case. Inspect the factor list and identify the approved lost factor.
3. Use the dashboard's MFA removal action and inspect its confirmation scope.
   Dashboard labels may change. If it would remove other factors, or the expected
   control is absent, stop and obtain a reviewed procedure/approval for that scope.
   Never delete the user, edit Auth tables with SQL, change membership or disable
   MFA enforcement to work around the dashboard.
4. Perform the confirmed removal once. Verify the approved factor is absent and
   record the factor ID, operator, UTC time and observed result in the case. If
   the response is ambiguous, inspect the factor list before repeating anything.
5. Preserve the available Supabase Auth audit reference alongside the support
   record. [Auth audit logs](https://supabase.com/docs/guides/auth/audit-logs) record
   authentication activity; check the actual event rather than assuming a custom
   Komisio access event exists. No app RPC currently logs dashboard resets.

Do not introduce a service-role key, admin endpoint, borrowed owner session or
automatic reset script. Routine factor removal is not account deletion.

## Person: re-enrol and verify

1. Sign in through the usual Komisio login on a trusted device. Retain the normal
   first-factor checks; an operator does not need the person's password.
2. Open `/account`, enable two-factor authentication, scan the QR code privately
   with the new authenticator and verify its current code. Never send the QR or
   code to support. If another verified factor still requires a challenge, use
   that factor; do not remove it merely to skip the challenge.
3. Sign out, then sign in again. Confirm a fresh session requires and accepts the
   new second factor before accessing store data. The operator records successful
   re-enrolment and the fresh-login result, without recording a code or token.
4. Confirm the original roles/stores are unchanged and notify the person through
   the established channel that recovery is complete. Close the case only after
   re-enrolment and fresh-login verification succeed.

Komisio currently enforces MFA once enrolled; it does not give this manual
recovery window a special restricted session. Do not resume normal store work
before re-enrolment. If it fails, keep the case open and escalate; never restore
the lost secret or weaken enforcement. See [Supabase TOTP enrolment](https://supabase.com/docs/guides/auth/auth-mfa/totp).

## Pilot evidence and stop conditions

Before external users, the owner/operator must exercise this procedure on a
dedicated synthetic staging user: verified old factor, approved removal, new
enrolment, fresh-login challenge, unchanged memberships and correlated support/
Auth logs. Also dry-run the refusal of an unverified requester and a wrong-project
selection without removing any factor. Record date, environment, case reference,
participants and results; keep personal or security details out of this repository.

Status on 2026-09-14: application enrolment path and provider documentation reviewed;
no dashboard removal or end-to-end recovery exercise performed for this procedure.
The pilot gate remains open until the exercise is recorded. There is no rollback
to a deleted factor: failures require verified re-enrolment or escalation.
