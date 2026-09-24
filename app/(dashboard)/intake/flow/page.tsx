import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { readStoreFlow } from '@/lib/engine/store-flow'
import { readStorePolicy } from '@/lib/engine/store-policy'
import { StoreFlow } from '@/components/intake/store-flow'

export default async function FlowPage() {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform()
  const active = ctx.active!
  const [current, policy] = await Promise.all([
    readStoreFlow(ctx.client, active.id),
    readStorePolicy(ctx.client, active.id),
  ])
  return (
    <StoreFlow
      key={active.id}
      tenantId={active.id}
      current={current}
      editable={['owner', 'admin'].includes(active.role)}
      perItem={policy.policy.sellerReviewMode === 'per_item'}
      d={dictionary(ctx.locale).storeFlow}
    />
  )
}
