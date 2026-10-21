import { z } from 'zod'
import { accountingKeys } from '../engine/accounting'

// Candidate identities checked against BAS 2026 v1.1, 2026-10-14. English
// descriptions below are our summaries, not an endorsement of a posting profile.
export const basSource =
  'https://www.bas.se/wp-content/uploads/2026/04/BAS_kontoplan_2026_v2.pdf'
export const basAccounts = {
  '1686': 'Card and voucher receivables',
  '1910': 'Cash on hand',
  '1930': 'Business bank account',
  '1940': 'Other bank accounts',
  '1990': 'Funds held for others',
  '2890': 'Other short-term liabilities',
  '2899': 'Other short-term liabilities, subaccount',
  '2611': 'Domestic output VAT at 25 percent',
  '2616': 'Margin-scheme output VAT at 25 percent',
  '2621': 'Domestic output VAT at 12 percent',
  '2626': 'Margin-scheme output VAT at 12 percent',
  '2631': 'Domestic output VAT at 6 percent',
  '2636': 'Margin-scheme output VAT at 6 percent',
  '3001': 'Domestic sales at 25 percent VAT',
  '3002': 'Domestic sales at 12 percent VAT',
  '3003': 'Domestic sales at 6 percent VAT',
  '3004': 'Domestic VAT-exempt sales',
  '3211': 'Positive-margin sales at 25 percent',
  '3212': 'Negative-margin sales at 25 percent',
  '3921': 'Commission income',
  '3999': 'Other operating income',
} as const

export const accountSuggestionShape = z.strictObject({
  rows: z
    .array(
      z.strictObject({
        key: z.enum(accountingKeys),
        account: z.enum(
          Object.keys(basAccounts) as [
            keyof typeof basAccounts,
            ...(keyof typeof basAccounts)[],
          ],
        ),
        side: z.enum(['debit', 'credit']),
        reason: z.string().trim().min(1).max(350),
      }),
    )
    .max(accountingKeys.length),
  warnings: z.array(z.string().trim().min(1).max(500)).max(8),
})
export const accountSuggestion = accountSuggestionShape.refine(
  (value) =>
    new Set(value.rows.map((row) => row.key)).size === value.rows.length,
  'Each amount may appear only once',
)
// Shared editor shape; each destination validates accounts with its own schema.
type SuggestedRow = z.infer<typeof accountSuggestionShape>['rows'][number]
export type AccountSuggestion = {
  rows: (Omit<SuggestedRow, 'account'> & { account: string })[]
  warnings: string[]
}
