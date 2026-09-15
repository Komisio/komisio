import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { readSellersOverview } from '@/lib/engine/sellers'
import { readPrinters } from '@/lib/engine/printing'
import { resolveReceptionAssistance } from '@/lib/assistance/reception-config'
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
  const [sellers, printers, assistance] = await Promise.all([
    readSellersOverview(ctx.client, a.id, '', 100),
    readPrinters(ctx.client, a.id),
    resolveReceptionAssistance(ctx.client, a.id),
  ])
  return (
    <main className="intake">
      <div className="intake-header">
        <h1>{d.title}</h1>
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
          sellers={(sellers?.sellers ?? []).map((s) => ({
            id: s.id,
            name: s.name,
            contact: s.contact,
          }))}
          printers={printers
            .filter((p) => p.active)
            .map((p) => ({ id: p.id, name: p.name }))}
          assistance={assistance !== null}
          d={d}
        />
      )}
    </main>
  )
}
