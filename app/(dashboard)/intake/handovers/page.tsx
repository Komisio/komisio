import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { readHandoverQueue } from '@/lib/engine/handovers'
import { readStorePolicy } from '@/lib/engine/store-policy'
import { HandoverQueue } from '@/components/intake/handover-queue'

/** Announced handovers: receive at the counter, which records the bag receipt. */
export default async function Handovers({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    all = dictionary(ctx.locale),
    d = all.handovers
  const focus = z.uuid().safeParse((await searchParams).focus)
  const [rows, policy] = await Promise.all([
    readHandoverQueue(ctx.client, active.id),
    readStorePolicy(ctx.client, active.id),
  ])
  const enabled = policy.policy.custodySources.includes('seller_dropoff')
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">{active.name}</div>
        <h1>{d.title}</h1>
        <p>{d.intro}</p>
        <Link className="text-link" href="/intake">
          {all.intake.back}
        </Link>
      </div>
      {!enabled && <p className="intake-notice">{d.disabled}</p>}
      <section className="card intake-form">
        <HandoverQueue
          key={`${active.id}-${rows.map((r) => `${r.id}:${r.status}`).join(',')}`}
          tenantId={active.id}
          rows={rows}
          write={active.role !== 'readonly'}
          focus={focus.success ? focus.data : null}
          locale={ctx.locale}
          d={d}
          intake={all.intake}
        />
      </section>
    </>
  )
}
