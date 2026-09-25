import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { readHandover, readHandoverQueue } from '@/lib/engine/handovers'
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
  const rawFocus = (await searchParams).focus
  const focus = z.uuid().safeParse(rawFocus)
  if (rawFocus !== undefined && !focus.success) notFound()
  const [rows, policy] = await Promise.all([
    focus.success
      ? readHandover(ctx.client, active.id, focus.data).then((row) =>
          row ? [row] : [],
        )
      : readHandoverQueue(ctx.client, active.id),
    readStorePolicy(ctx.client, active.id),
  ])
  if (focus.success && rows.length === 0) notFound()
  const enabled = policy.policy.custodySources.includes('seller_dropoff')
  return (
    <>
      <div className="page-heading">
        <h1>{d.title}</h1>
        <p>{d.intro}</p>
        {focus.success && (
          <p>
            <Link className="btn btn-secondary" href="/intake/handovers">
              {d.title}
            </Link>
          </p>
        )}
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
