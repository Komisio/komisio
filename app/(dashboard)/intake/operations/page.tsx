import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import {
  readOperationPage,
  operationPageInput,
  operationFilter,
} from '@/lib/engine/operation-page'
import { operationQueueHref } from '@/lib/intake/operation-navigation'
import { OperationQueue } from '@/components/intake/operation-queue'
import { readStoreCurrency } from '@/lib/engine/money'

export default async function Operations({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    currency = await readStoreCurrency(ctx.client, ctx.active!.id),
    all = dictionary(ctx.locale),
    d = all.operations
  const parsed = operationPageInput.safeParse(await searchParams)
  if (!parsed.success) notFound()
  const { items: operations, nextBefore } = await readOperationPage(
    ctx.client,
    active.id,
    parsed.data,
  )
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">{active.name}</div>
        <h1>{d.title}</h1>
        <p>{d.intro}</p>
        <Link className="text-link" href="/intake/reception">
          {all.reception.ongoing}
        </Link>
      </div>
      <p className="intake-notice">{d.notice}</p>
      <nav className="row operation-navigation" aria-label={d.queueFilter}>
        {operationFilter.options.map((status) => (
          <Link
            className="text-link"
            key={status}
            aria-current={parsed.data.status === status ? 'page' : undefined}
            href={operationQueueHref({ status })}
          >
            {status === 'all' ? d.filterAll : d.status[status]}
          </Link>
        ))}
      </nav>
      <p>{d.liveQueue}</p>
      {operations.length ? (
        <OperationQueue
          key={active.id}
          tenantId={active.id}
          operations={operations}
          canDecide={active.role !== 'readonly'}
          locale={ctx.locale}
          currency={currency}
          d={d}
        />
      ) : (
        <p>{d.emptyFiltered}</p>
      )}
      <nav className="row operation-navigation" aria-label={d.queuePages}>
        {nextBefore && (
          <Link
            className="text-link"
            href={operationQueueHref({
              status: parsed.data.status,
              ...nextBefore,
            })}
          >
            {d.older}
          </Link>
        )}
        {parsed.data.beforeCreated && (
          <Link
            className="text-link"
            href={operationQueueHref({ status: parsed.data.status })}
          >
            {d.firstPage}
          </Link>
        )}
      </nav>
    </>
  )
}
