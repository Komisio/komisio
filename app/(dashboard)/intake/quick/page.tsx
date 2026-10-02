import { platformPageMetadata } from '@/lib/platform/page-metadata'
import { FormHelpHeading } from '@/components/help/form-help-heading'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { readSellersOverview } from '@/lib/engine/sellers'
import { readPrinters } from '@/lib/engine/printing'
import { resolveReceptionAssistance } from '@/lib/assistance/reception-config'
import { readAttributeVocabulary } from '@/lib/engine/attributes'
import { QuickReception } from '@/components/intake/quick-reception'

/** Quick reception: seller, photo, facts, price, label; one screen per garment. */
export default async function QuickIntake() {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform()
  const a = ctx.active
  if (!a || !['owner', 'admin', 'staff'].includes(a.role)) notFound()
  const all = dictionary(ctx.locale)
  const d = all.quickIntake
  const policy = await ctx.client.rpc('current_store_policy', {
    p_tenant: a.id,
  })
  const profile =
    (policy.data?.policy?.intakeProfile as string | undefined) ?? 'quick'
  const [sellers, printers, assistance, vocabulary] = await Promise.all([
    readSellersOverview(ctx.client, a.id, '', 12),
    readPrinters(ctx.client, a.id),
    resolveReceptionAssistance(ctx.client, a.id),
    readAttributeVocabulary(ctx.client, a.id),
  ])
  return (
    <div className="intake quick-page">
      <div className="intake-header">
        <FormHelpHeading title={d.title} level={1} help={d.formHelp} />
        <Link className="text-link" href="/intake">
          {all.intake.back}
        </Link>
      </div>
      <p>{d.intro}</p>
      {profile === 'full' ? (
        <p className="intake-notice">
          {d.profileFull}{' '}
          <Link className="text-link" href="/settings?tab=policy">
            {d.openPolicy}
          </Link>
        </p>
      ) : (
        <QuickReception
          key={a.id}
          tenantId={a.id}
          sellersTotal={sellers?.total ?? 0}
          sellers={(sellers?.sellers ?? []).map((s) => ({
            id: s.id,
            name: s.name,
            contact: s.contact,
          }))}
          printers={printers
            .filter((p) => p.active)
            .map((p) => ({ id: p.id, name: p.name }))}
          vocabulary={vocabulary}
          canManageTypes={['owner', 'admin'].includes(a.role)}
          lang={ctx.locale}
          assistance={assistance !== null}
          d={d}
        />
      )}
    </div>
  )
}

export const generateMetadata = () =>
  platformPageMetadata((d) => d.quickIntake.title)
