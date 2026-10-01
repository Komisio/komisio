'use client'
import { usePathname, useSearchParams } from 'next/navigation'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import type { Dictionary } from '@/lib/i18n'
import { ContextHelp } from './context-help'
import { helpTopicForPage } from '@/lib/help/topics'

export function HeaderHelp({
  tenantId,
  d,
}: {
  tenantId: string
  d: Dictionary['helpCenter']
}) {
  const path = usePathname()
  const query = useSearchParams()
  const topic = helpTopicForPage(path, query.get('view'), query.get('tab'))
  if (!topic) {
    return (
      <Link className="text-link" href="/help">
        {d.title}
      </Link>
    )
  }
  return (
    <ContextHelp
      key={`${tenantId}-${path}-${topic}`}
      topic={topic}
      d={d}
      label={d.title}
    />
  )
}
