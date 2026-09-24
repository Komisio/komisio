import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary, intlLocale } from '@/lib/i18n'
import { readStoreFlow } from '@/lib/engine/store-flow'
import { readStorePolicy } from '@/lib/engine/store-policy'
import { readFlowSnapshot } from '@/lib/engine/store-flow-snapshot'
import { StoreFlowNow } from '@/components/intake/store-flow-now'
import { StoreFlow } from '@/components/intake/store-flow'

export default async function FlowPage() {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform()
  const active = ctx.active!
  const d = dictionary(ctx.locale)
  const [current, policy, snapshot] = await Promise.all([
    readStoreFlow(ctx.client, active.id),
    readStorePolicy(ctx.client, active.id),
    readFlowSnapshot(ctx.client, active.id).catch(() => null),
  ])
  return (
    <StoreFlow
      key={active.id}
      live={
        <StoreFlowNow
          snapshot={snapshot}
          d={d.storeFlow.live}
          stages={d.reception.queueStages}
          inventoryStages={d.lifecycle.stages}
          locale={intlLocale(ctx.locale)}
        />
      }
      tenantId={active.id}
      current={current}
      editable={['owner', 'admin'].includes(active.role)}
      perItem={policy.policy.sellerReviewMode === 'per_item'}
      d={dictionary(ctx.locale).storeFlow}
    />
  )
}
