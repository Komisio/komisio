# e-conomic adapter

Checked against official documentation on **2026-10-20**:

- [Connecting an app](https://www.e-conomic.com/developer/connect)
- [Installation redirect parameters](https://techtalk.e-conomic.com/we-have-revamped-our-app-grant-access-page/)
- [REST API](https://restdocs.e-conomic.com/): `/self`, `/accounts`, `/vat-accounts`
- [Journals OpenAPI v16.0.1](https://apis.e-conomic.com/journalsapi/redoc.html):
  `/journals`, `/draft-entries/bulk`, `/draft-entries/{entryNumber}`
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

A successful bulk response supplies entry IDs, not a guaranteed shared voucher.
Read-back must establish a complete matching set under one voucher number.
Unverified or multiple voucher results are held by the engine. API grouping
guarantees remain an investigation, not an implemented assumption.

No code from another project was copied. The adapter has no database privileges;
`lib/engine/economic.ts` coordinates the authenticated engine operations and
sealed credentials. See [operator and store guide](../../docs/ECONOMIC-CONNECTION.md).
