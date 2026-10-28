/** Opt in lists/reports and the drop-off review workspace; other details stay narrow. */
const widePages = new Set([
  '/intake',
  '/intake/items',
  '/intake/stock',
  '/intake/sellers',
  '/intake/sellers/registrations',
  '/intake/payouts',
  '/intake/payouts/payment-sheet',
  '/intake/sales',
  '/intake/lifecycle',
  '/intake/submissions',
  '/intake/handovers',

  '/intake/operations',
  '/intake/economy',
  '/intake/pricing',
  '/intake/purchases',
  '/intake/agreements',
  '/intake/stocktake',
  '/members',
  '/settings/activity',
])

export function pageWidth(pathname: string): 'wide' | 'reading' {
  return widePages.has(pathname) ||
    /^\/intake\/bags\/[^/]+\/inspect$/.test(pathname)
    ? 'wide'
    : 'reading'
}
