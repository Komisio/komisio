---
title: Check a sending issue
summary: Distinguish a stopped send from a missing response. A missing response
  may mean the voucher already exists.
routes:
  - path: /intake/accounting
    view: reconciliation
taskLinks:
  - href: /intake/accounting?view=settings
    label: Accounts and integrations
  - href: /intake/accounting
    label: Day closes and exports
  - href: /intake/accounting?view=reconciliation
    label: Reconciliation
externalLinks: []
lastReviewed: 2026-10-20
machineTranslated: false
---

Distinguish a stopped send from a missing response\. A missing response may mean the voucher already exists\.

1. If Komisio explicitly says the send stopped before registration, fix the cause and use the retry action offered\.
2. If the send is pending or uncertain, do not send again\. Ask the store owner to compare the export with vouchers in the Fortnox company database bound to that send\.
3. Compare the date, amounts and every line\. If a matching voucher exists, the owner can record its series, number, financial year and evidence using the confirmation form on the export row\.
4. If no matching voucher can be found, ask the installation operator to help investigate\. Absence does not unlock another send\. Do not delete or recreate exports to bypass the hold\.

> Reconciliation records the owner’s check, not automatic verification by Fortnox\. Staff and administrators may read the help; only the owner may record this confirmation\.
