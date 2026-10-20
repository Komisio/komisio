---
title: How automatic sending works
summary: Automation sends prepared exports to the connected Fortnox company. It
  does not create day closes or choose accounts.
routes: []
taskLinks:
  - href: /intake/accounting?view=settings#fortnox-automation
    label: Accounts and integrations
  - href: /intake/accounting
    label: Day closes and exports
  - href: /intake/accounting?view=reconciliation
    label: Reconciliation
  - href: /help/fortnox-recovery
    label: Check a sending issue
externalLinks: []
lastReviewed: 2026-10-20
machineTranslated: false
---

Automation sends prepared exports to the connected Fortnox company\. It does not create day closes or choose accounts\.

1. Check the company and account mapping\. Review existing exports before enabling: older eligible exports may also be included\. Avoid importing a SIE file and sending the same export directly\.
2. The store owner enables automatic sending under Accounts and integrations\. Waiting means the background service has not accepted activation yet\. If the feature is not configured, contact the person responsible for the Komisio installation\.
3. Continue creating and reviewing day closes and preparing exports manually\. Read Last run for the time, outcome and number sent\. Enabled does not mean anything has been sent, and a completed run does not mean every day is reconciled\.
4. After a partial or failed run, open Reconciliation and review the affected exports\. For a pending or uncertain send, follow the sending\-problem guidance and ask the owner to check the outcome\. Switching automation off and on does not resolve a held send\.

> Reading help enables or sends nothing\. Automatic runs do not resend exports with confirmed, pending or uncertain outcomes\. Disabling automation does not withdraw vouchers already created\.
