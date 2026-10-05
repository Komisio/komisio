import { ClipboardCheck } from 'lucide-react'
import { FormHelpHeading } from '@/components/help/form-help-heading'
import { platformPageMetadata } from '@/lib/platform/page-metadata'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import {
  readOperationPage,
  operationPageInput,
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
  const parsed = operationPageInput.safeParse({
    status: 'open',
    ...(await searchParams),
  })
  if (!parsed.success) notFound()
  const { items: operations, nextBefore } = await readOperationPage(
    ctx.client,
    active.id,
    parsed.data,
  )
  return (
    <div className="operations-page">
      <div className="page-heading">
        <FormHelpHeading title={d.title} level={1} help={d.queueHelp} />
        <p>{d.intro}</p>
      </div>
      <nav
        className="row operation-navigation operation-filters"
        aria-label={d.queueFilter}
      >
        {(
          ['open', 'failed', 'executed', 'rejected', 'expired', 'all'] as const
        ).map((status) => (
          <Link
            className="text-link"
            key={status}
            aria-current={parsed.data.status === status ? 'page' : undefined}
            href={operationQueueHref({ status })}
          >
            {d.queueLabels[status]}
          </Link>
        ))}
      </nav>
      {operations.length ? (
        <OperationQueue
          key={active.id}
          tenantId={active.id}
          operations={operations}
          canDecide={active.role !== 'readonly'}
          locale={ctx.locale}
          currency={currency}
          sourceKinds={all.reception.history.kinds}
          d={d}
        />
      ) : (
        <section
          className="operations-empty card"
          aria-labelledby="operations-empty-title"
        >
          <span className="operations-empty-icon">
            <ClipboardCheck size={28} aria-hidden="true" />
          </span>
          <h2 id="operations-empty-title">
            {parsed.data.status === 'open' && !parsed.data.beforeCreated
              ? d.emptyOpenTitle
              : d.emptyFiltered}
          </h2>
          <p>
            {parsed.data.status === 'open' && !parsed.data.beforeCreated
              ? d.emptyOpenHint
              : d.emptyFilterHint}
          </p>
          {parsed.data.status !== 'all' && (
            <Link
              className="text-link"
              href={operationQueueHref({ status: 'all' })}
            >
              {d.filterAll}
            </Link>
          )}
        </section>
      )}
      {(nextBefore || parsed.data.beforeCreated) && (
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
      )}
    </div>
  )
}

export const generateMetadata = () =>
  platformPageMetadata((d) => d.operations.title)
