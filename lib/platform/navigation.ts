import type { Dictionary } from '@/lib/i18n'

// One source for the store navigation: the sidebar groups, the mobile bar
// and the "more" page read the same list, so a page is never reachable from
// one and missing from another. Labels are the pages' own titles.
export type NavLink = { path: string; label: string; icon: string }
export type NavGroup = { label: string; links: NavLink[] }

export function buildNavigation(
  d: Dictionary,
  options: { intakeEnabled: boolean; host: boolean },
): NavGroup[] {
  const n = d.nav
  const groups: NavGroup[] = [
    { label: '', links: [{ path: '/', label: d.home, icon: 'House' }] },
  ]
  if (options.intakeEnabled)
    groups.push(
      {
        label: n.receiving,
        links: [
          // The one-screen reception first: it is the default intake profile.
          { path: '/intake/quick', label: d.quickIntake.title, icon: 'Zap' },
          { path: '/intake', label: n.receiveBag, icon: 'Inbox' },
          {
            path: '/intake/reception',
            label: d.reception.title,
            icon: 'Camera',
          },
          {
            path: '/intake/handovers',
            label: n.selfDropOff,
            icon: 'Handshake',
          },
          {
            path: '/intake/purchases',
            label: d.purchases.title,
            icon: 'ShoppingBag',
          },
        ],
      },
      {
        label: n.goods,
        links: [
          { path: '/intake/items', label: d.items.title, icon: 'Package' },
          {
            path: '/intake/lifecycle',
            label: d.lifecycle.title,
            icon: 'Clock',
          },
          {
            path: '/intake/open',
            label: d.openByReference.title,
            icon: 'ScanLine',
          },
        ],
      },
      {
        label: n.sellers,
        links: [
          { path: '/intake/sellers', label: n.sellersList, icon: 'Users' },
          {
            path: '/intake/agreements',
            label: d.agreements.title,
            icon: 'FileText',
          },
          { path: '/intake/payouts', label: d.payouts.title, icon: 'Wallet' },
          { path: '/intake/import', label: d.importer.title, icon: 'Upload' },
        ],
      },
      {
        label: n.money,
        links: [
          { path: '/intake/sales', label: d.sales.title, icon: 'Receipt' },
          { path: '/intake/economy', label: d.economy.title, icon: 'ChartPie' },
          { path: '/intake/stock', label: d.stock.title, icon: 'Boxes' },
          {
            path: '/intake/accounting',
            label: d.accounting.title,
            icon: 'BookOpen',
          },
        ],
      },
      {
        label: n.work,
        links: [
          {
            path: '/intake/operations',
            label: d.operations.title,
            icon: 'ListChecks',
          },
          { path: '/intake/integrations', label: n.integrations, icon: 'Plug' },
        ],
      },
    )
  groups.push({
    label: n.store,
    links: [
      { path: '/settings', label: d.tenant, icon: 'Settings2' },
      { path: '/members', label: d.members, icon: 'Users' },
      ...(options.host
        ? [{ path: '/host', label: d.hostLink, icon: 'Building2' }]
        : []),
    ],
  })
  return groups
}

/** The five entries of the mobile bar; the last opens the full list. */
export function mobileNavigation(
  d: Dictionary,
  intakeEnabled: boolean,
): NavLink[] {
  const n = d.nav
  return intakeEnabled
    ? [
        { path: '/', label: d.home, icon: 'House' },
        { path: '/intake/quick', label: n.quickShort, icon: 'Zap' },
        { path: '/intake/items', label: d.items.title, icon: 'Package' },
        { path: '/intake/operations', label: n.workShort, icon: 'ListChecks' },
        { path: '/menu', label: n.more, icon: 'Menu' },
      ]
    : [
        { path: '/', label: d.home, icon: 'House' },
        { path: '/members', label: d.members, icon: 'Users' },
        { path: '/settings', label: d.tenant, icon: 'Settings2' },
        { path: '/account', label: d.account, icon: 'UserRound' },
      ]
}

export function isActivePath(pathname: string, path: string) {
  if (path === '/') return pathname === '/'
  if (path === '/intake')
    return pathname === '/intake' || pathname.startsWith('/intake/bags')
  return pathname === path || pathname.startsWith(`${path}/`)
}

/** The link that best describes the current page, for the breadcrumb. */
export function currentLink(groups: NavGroup[], pathname: string) {
  const links = groups.flatMap((g) => g.links)
  return (
    links
      .filter((l) => isActivePath(pathname, l.path))
      .sort((a, b) => b.path.length - a.path.length)[0] ?? null
  )
}
