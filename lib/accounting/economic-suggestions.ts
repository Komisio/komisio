import { z } from 'zod'
import { accountNumber, type Catalogue } from '@/extensions/economic/api'
import { accountSuggestionShape } from './account-suggestions'
import { accountingKeys } from '@/lib/engine/accounting'

export const economicCandidates = z
  .array(
    z.strictObject({
      account: accountNumber,
      name: z.string().max(200),
      type: z.enum(['profitAndLoss', 'status']),
    }),
  )
  .min(1)
  .max(1000)
  .refine(
    (rows) => new Set(rows.map((row) => row.account)).size === rows.length,
  )

export function eligibleEconomicAccounts(catalogue: Catalogue) {
  return economicCandidates.parse(
    catalogue.accounts
      .filter(
        (row) =>
          !row.barred &&
          !row.blockDirectEntries &&
          !row.contraAccount &&
          ['profitAndLoss', 'status'].includes(row.accountType),
      )
      .map((row) => ({
        account: String(row.accountNumber),
        name: row.name,
        type: row.accountType,
      })),
  )
}

export const economicSuggestionShape = accountSuggestionShape.extend({
  rows: z
    .array(
      accountSuggestionShape.shape.rows.element.extend({
        account: accountNumber,
      }),
    )
    .max(accountingKeys.length),
})
export const economicSuggestion = economicSuggestionShape.refine(
  (value) =>
    new Set(value.rows.map((row) => row.key)).size === value.rows.length,
)
