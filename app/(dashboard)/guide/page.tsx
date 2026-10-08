import { requirePlatform } from '@/lib/platform/context'
import { readStoreGuide } from '@/lib/engine/store-guide'
import { guideOptionHelp } from '@/lib/guide-option-help'
import { guideCopy } from '@/lib/guide-copy'
import { StoreGuide } from '@/components/platform/store-guide'
import { dictionary } from '@/lib/i18n'
export async function generateMetadata() {
  const ctx = await requirePlatform(false)
  return { title: guideCopy(ctx.locale).start }
}

export default async function GuidePage() {
  const ctx = await requirePlatform()
  const tenant = ctx.active!
  const initial = await readStoreGuide(ctx.client, tenant.id)
  return (
    <StoreGuide
      key={`${tenant.id}:${ctx.locale}`}
      tenantId={tenant.id}
      tenantName={tenant.name}
      initial={initial}
      editable={['owner', 'admin'].includes(tenant.role)}
      c={guideCopy(ctx.locale)}
      help={guideOptionHelp(ctx.locale)}
      recovery={dictionary(ctx.locale).intake}
      leaveWarning={dictionary(ctx.locale).leaveUnsaved}
    />
  )
}
