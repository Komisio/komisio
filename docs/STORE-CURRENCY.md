# Store currency

Owner decision 2026-09-13: one currency per store. The earlier product let a
store pick a currency; the new Komisio had SEK fixed everywhere until this
slice.

## Rule

- The store policy names the currency (`currency`: `SEK`, `NOK`, `DKK`,
  `EUR`); absent means SEK, so every existing store stays in SEK.
- `publish_store_policy` refuses a different currency once the store has a
  sale, a purchase receipt or a payout (`CURRENCY_FROZEN`); every other
  policy change still publishes. Choose the currency at onboarding.
- Every money fact records the store's currency: `record_sale` refuses any
  other (`CURRENCY_MISMATCH`), `request_payout` and `register_purchase` take
  it from the store, a reception review's price must name it, a Zettle
  receipt in another currency is held and never recorded, and the Zettle
  catalog export sends the store's code as `currencyId`.
- Amounts stay integers in the currency's minor unit; nothing converts, and
  a store holds no second currency in version 1. The economy summary and the
  agent tools return the code with the amounts.

## Surfaces

The store policy form has a currency select. Pages, the seller portal,
e-mail templates, labels and the operations queue read the store's code
through `store_currency(tenant)`, which any signed-in person may call, and
show it instead of a fixed "SEK". Hints no longer name a currency.

## Verification

`supabase/tests/0061_store_currency.test.sql`: validation, choice before any
money fact, sale, purchase, payout and review in the chosen currency, refusal
of another, the freeze after the first sale, other policy changes still
publishing, Zettle structural validity, the seller read and the anonymous
refusal. `0031_sales` asserts the store-currency rule instead of "only SEK".
