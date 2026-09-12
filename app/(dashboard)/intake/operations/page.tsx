import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { readOperationQueue } from '@/lib/engine/operations'
import { OperationQueue } from '@/components/intake/operation-queue'

export default async function Operations() {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    all = dictionary(ctx.locale),
    d = all.operations
  const operations = await readOperationQueue(ctx.client, active.id)
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">{active.name}</div>
        <h1>{d.title}</h1>
        <p>{d.intro}</p>
        <Link className="text-link" href="/intake/reception">
          {all.reception.title}
        </Link>
      </div>
      <p className="intake-notice">{d.notice}</p>
      {operations.length ? (
        <OperationQueue
          key={active.id}
          tenantId={active.id}
          operations={operations}
          canDecide={active.role !== 'readonly'}
          locale={ctx.locale}
          d={d}
        />
      ) : (
        <p>{d.empty}</p>
      )}
    </>
  )
}
