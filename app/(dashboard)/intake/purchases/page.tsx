import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { PurchaseForm } from '@/components/intake/purchase-form'

const row = z.object({
  id: z.uuid(),
  reference: z.union([z.number().int(), z.string()]),
  supplier_note: z.string(),
  purchase_price_ore: z.union([z.number().int(), z.string()]),
  evidence_reference: z.string(),
  margin_eligible: z.boolean(),
  purchased_at: z.iso.datetime({ offset: true }),
})
function formatOre(value: number | string) {
  const ore = BigInt(value)
  const kronor = ore / 100n,
    rest = ore % 100n
  return `${kronor}.${rest.toString().padStart(2, '0')}`
}

export default async function Purchases() {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!,
    all = dictionary(ctx.locale),
    d = all.purchases
  const { data, error } = await ctx.client
    .from('purchase_receipts')
    .select(
      'id,reference,supplier_note,purchase_price_ore,evidence_reference,margin_eligible,purchased_at',
    )
    .eq('tenant_id', active.id)
    .order('purchased_at', { ascending: false })
    .order('id')
    .limit(20)
  if (error) throw new Error('Unable to load purchases')
  const purchases = z
    .array(row)
    .max(20)
    .parse(data ?? [])
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
      <p className="intake-notice">{d.notice}</p>
      <div className="intake-grid">
        {active.role !== 'readonly' ? (
          <PurchaseForm
            key={active.id}
            tenantId={active.id}
            d={d}
            intake={all.intake}
          />
        ) : (
          <p>{all.intake.readOnly}</p>
        )}
        <section className="card intake-form">
          <h2>{d.recent}</h2>
          <p>{d.recentHint}</p>
          <ul className="intake-list">
            {purchases.map((p) => (
              <li key={p.id} className="intake-bag">
                <div>
                  <strong>
                    {d.reference} P-{p.reference}
                  </strong>
                  <br />
                  {formatOre(p.purchase_price_ore)} SEK ·{' '}
                  {p.margin_eligible ? d.marginYes : d.marginNo}
                  <br />
                  <small>
                    {new Date(p.purchased_at).toLocaleString(
                      ctx.locale === 'sv' ? 'sv-SE' : 'en-GB',
                      { timeZone: 'Europe/Stockholm' },
                    )}{' '}
                    · {p.evidence_reference}
                    {p.supplier_note ? ` · ${p.supplier_note}` : ''}
                  </small>
                </div>
              </li>
            ))}
          </ul>
          {!purchases.length && <p>{d.empty}</p>}
        </section>
      </div>
    </>
  )
}
