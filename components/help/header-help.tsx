'use client'
import { usePathname, useSearchParams } from 'next/navigation'
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
  return (
    <ContextHelp
      key={`${tenantId}-${path}-${topic}-${query.toString()}`}
      topic={topic}
      d={d}
      label={d.title}
    />
  )
}
