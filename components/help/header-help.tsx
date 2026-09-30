'use client'
import { usePathname, useSearchParams } from 'next/navigation'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import type { Dictionary } from '@/lib/i18n'
import { ContextHelp } from './context-help'

export function HeaderHelp({
  tenantId,
  d,
}: {
  tenantId: string
  d: Dictionary['helpCenter']
}) {
  const path = usePathname()
  const view = useSearchParams().get('view')
  if (
    !path.startsWith('/intake/accounting') &&
    path !== '/intake/integrations'
  ) {
    return (
      <Link className="text-link" href="/help">
        {d.title}
      </Link>
    )
  }
  const topic =
    path === '/intake/integrations' || view === 'settings'
      ? 'fortnox-connect'
      : view === 'reconciliation'
        ? 'fortnox-recovery'
        : 'fortnox-first-export'
  return (
    <ContextHelp
      key={`${tenantId}-${path}-${topic}`}
      topic={topic}
      d={d}
      label={d.title}
    />
  )
}
