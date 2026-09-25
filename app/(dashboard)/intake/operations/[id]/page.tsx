import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { readOperationReview } from '@/lib/engine/operation-review'
import { OperationQueue } from '@/components/intake/operation-queue'
import { readStoreCurrency } from '@/lib/engine/money'

export default async function OperationDetail({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const { id } = await params
  if (!z.uuid().safeParse(id).success) notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    currency = await readStoreCurrency(ctx.client, ctx.active!.id),
    d = dictionary(ctx.locale).operations
  const detail = await readOperationReview(ctx.client, active.id, {
    operationId: id,
  }).catch((error: unknown) => {
    if (
      error instanceof Error &&
      ['OPERATION_NOT_FOUND', 'FORBIDDEN'].includes(error.message)
    )
      notFound()
    throw error
  })
  return (
    <>
      <div className="page-heading">
        <h1>{d.reviewProposal}</h1>
        <Link className="text-link" href="/intake/operations">
          {d.title}
        </Link>
      </div>
      <p className="intake-notice">{d.notice}</p>
      <OperationQueue
        key={`${active.id}:${id}`}
        tenantId={active.id}
        operations={[detail.operation]}
        reviewContext={detail.context}
        canDecide={active.role !== 'readonly'}
        locale={ctx.locale}
        currency={currency}
        d={d}
      />
    </>
  )
}
