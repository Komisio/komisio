# e-conomic adapter

Checked against official documentation on **2026-10-21**:

- [Connecting an app](https://www.e-conomic.com/developer/connect)
- [Installation redirect parameters](https://techtalk.e-conomic.com/we-have-revamped-our-app-grant-access-page/)
- [REST API](https://restdocs.e-conomic.com/): `/self`, `/accounts`, `/vat-accounts`,
  `/accounting-years`, `POST /journals/{journalNumber}/vouchers` and
  `GET /journals/{journalNumber}/vouchers/{accountingYear-voucherNumber}`
- [Voucher creation schema](https://restapi.e-conomic.com/schema/journals.journalNumber.vouchers.post.schema.json)
- [Journals OpenAPI v16.0.1](https://apis.e-conomic.com/journalsapi/redoc.html):
  `/journals` for catalogue reads
- [API packages](https://www.e-conomic.dk/support/artikler/om-e-conomic-api)
- [Rate limiting](https://www.e-conomic.dk/support/artikler/rate-limiting-on-the-e-conomic-public-api)
- [Developer terms](https://www.e-conomic.com/developer/api-terms-of-service)

REST calls use `https://restapi.e-conomic.com`; journal calls use
`https://apis.e-conomic.com/journalsapi/v16.0.1`. Requests are sequential, time
bounded, refuse redirects and cap response size and pagination. Tokens appear
only in `X-AppSecretToken` and `X-AgreementGrantToken` headers.

The adapter validates agreement identity, DKK, existing directly postable
accounts, regular finance journals and explicit zero-rate VAT codes. It formats
frozen integer øre as JSON decimal amounts without recalculating tax. It creates
only draft Finance Voucher entries; it has no booking operation.

The Journals draft-entry bulk endpoint allocates a voucher number per entry when
omitted; it is not a grouped-voucher endpoint. The adapter instead posts one REST
voucher with all `entries.financeVouchers`, omitting voucher numbers so the provider
allocates the number. The date must match exactly one open provider accounting
year, including non-calendar years. No local next-number reservation is used.
Read-back from the pinned voucher URL checks its identity and complete row set,
rejecting foreign, missing or extra entries and unexpected automatic VAT/contra
accounts. Unverified results remain held without another POST. Earlier split
exports are not edited, resent or marked sent by this change.

No code from another project was copied. The adapter has no database privileges;
`lib/engine/economic.ts` coordinates the authenticated engine operations and
sealed credentials. See [operator and store guide](../../docs/ECONOMIC-CONNECTION.md).
