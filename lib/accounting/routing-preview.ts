// Explanatory planning only. Never consume this result as an export or permission.
export const routingModes = ['komisio', 'pos', 'manual'] as const
export type RoutingMode = (typeof routingModes)[number]
export type ExternalSales = 'unknown' | 'enabled' | 'disabled'
type Owner = 'komisio' | 'pos' | 'accountant' | 'review'
export type RoutingIssue =
  | 'duplicateSales'
  | 'missingSales'
  | 'externalUnknown'
  | 'complementUnavailable'
  | 'coverage'
  | 'cutover'
  | 'review'
  | 'noClose'
  | 'emptyVoucher'
  | 'unbalanced'
  | 'unmapped'
  | 'manualReview'

type CurrentVoucherFacts = {
  balanced: boolean
  unmapped: readonly string[]
  lines: readonly unknown[]
}

/** Local choices are assumptions, not verified external configuration. */
export function previewAccountingRouting(
  mode: RoutingMode,
  externalSales: ExternalSales,
  voucher: CurrentVoucherFacts | null,
) {
  const manual = mode === 'manual'
  const owners: Record<
    | 'sales'
    | 'sellerCredit'
    | 'commission'
    | 'fees'
    | 'settlements'
    | 'payouts',
    Owner
  > = {
    sales: manual ? 'accountant' : mode === 'pos' ? 'pos' : 'komisio',
    sellerCredit: manual ? 'accountant' : 'komisio',
    commission: manual ? 'accountant' : mode === 'pos' ? 'review' : 'komisio',
    fees: manual ? 'accountant' : 'review',
    settlements: manual ? 'accountant' : 'review',
    payouts: manual ? 'accountant' : 'review',
  }
  const issues: RoutingIssue[] = []
  if (manual) issues.push('manualReview')
  else {
    if (externalSales === 'unknown') issues.push('externalUnknown')
    if (mode === 'komisio' && externalSales === 'enabled')
      issues.push('duplicateSales')
    if (mode === 'pos' && externalSales === 'disabled')
      issues.push('missingSales')
    if (mode === 'pos') issues.push('complementUnavailable')
    if (mode === 'komisio') issues.push('coverage')
  }
  if (!voucher) issues.push('noClose')
  else {
    if (!voucher.lines.length) issues.push('emptyVoucher')
    else if (!voucher.balanced) issues.push('unbalanced')
    if (voucher.unmapped.length) issues.push('unmapped')
  }
  issues.push('review', 'cutover')
  return { owners, issues, executable: false as const }
}
