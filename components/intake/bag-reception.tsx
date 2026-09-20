import Link from 'next/link'
import Image from 'next/image'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { dictionary, intlLocale, type Locale } from '@/lib/i18n'
import { QuickReception } from './quick-reception'
import { readPrinters } from '@/lib/engine/printing'
import { readAttributeVocabulary } from '@/lib/engine/attributes'
import { resolveReceptionAssistance } from '@/lib/assistance/reception-config'

const row = z.object({
  id: z.guid(),
  session_id: z.guid(),
  title: z.string().nullable(),
  price_ore: z.string().nullable(),
  photo_id: z.uuid().nullable(),
})
export async function BagReception({
  client,
  tenantId,
  bagId,
  reference,
  note,
  locale,
  currency,
  readonly,
}: {
  client: SupabaseClient
  tenantId: string
  bagId: string
  reference: string | number
  note: string
  locale: Locale
  currency: string
  readonly: boolean
}) {
  const d = dictionary(locale),
    b = d.bagIntake
  const bag = await client
    .from('bag_receipts')
    .select('seller_id')
    .eq('tenant_id', tenantId)
    .eq('id', bagId)
    .single()
  if (bag.error) throw new Error('Unable to read bag')
  const [seller, printers, vocabulary, assistance, received] =
    await Promise.all([
      client
        .from('sellers')
        .select('id,name,email,phone')
        .eq('tenant_id', tenantId)
        .eq('id', bag.data.seller_id)
        .single(),
      readPrinters(client, tenantId),
      readAttributeVocabulary(client, tenantId),
      readonly
        ? Promise.resolve(null)
        : resolveReceptionAssistance(client, tenantId),
      client.rpc('bag_received_items', { p_tenant: tenantId, p_bag: bagId }),
    ])
  if (seller.error || received.error)
    throw new Error('Unable to read bag reception')
  const items = z.array(row).max(50).parse(received.data)
  return (
    <main className="bag-reception-page">
      <Link className="text-link" href="/intake">
        {d.intake.back}
      </Link>
      <header className="page-heading">
        <p className="eyebrow">
          {d.intake.bag} K-{reference} · {seller.data.name}
        </p>
        <h1>{d.inspection.title}</h1>
        <p>{b.intro}</p>
        {note && <p className="bag-note">{note}</p>}
      </header>
      {!readonly && (
        <QuickReception
          key={bagId}
          tenantId={tenantId}
          bagId={bagId}
          sellers={[
            {
              id: seller.data.id,
              name: seller.data.name,
              contact: seller.data.email || seller.data.phone,
            },
          ]}
          printers={printers
            .filter((p) => p.active)
            .map((p) => ({ id: p.id, name: p.name }))}
          vocabulary={vocabulary}
          lang={locale}
          assistance={assistance !== null}
          d={{
            ...d.quickIntake,
            garment: b.item,
            submit: b.save,
            next: b.next,
          }}
        />
      )}
      <section className="card bag-received-items">
        <h2>{b.registered}</h2>
        {!items.length ? (
          <p>{b.empty}</p>
        ) : (
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                <Link href={`/intake/items/${item.id}`}>
                  {item.photo_id && (
                    <Image
                      alt=""
                      width={52}
                      height={52}
                      unoptimized
                      loading="lazy"
                      src={`/api/reception/${item.session_id}/photo?photo=${item.photo_id}`}
                    />
                  )}
                  <span>
                    {item.title || d.quickIntake.garment}
                    <small>{'I-' + item.id.slice(0, 8).toUpperCase()}</small>
                  </span>
                  <strong>
                    {item.price_ore
                      ? new Intl.NumberFormat(intlLocale(locale), {
                          style: 'currency',
                          currency,
                        }).format(Number(item.price_ore) / 100)
                      : '—'}
                  </strong>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {items.length === 50 && <p>{b.limit}</p>}
      </section>
      <nav className="row bag-inspection-links">
        <Link className="text-link" href={`/intake/bags/${bagId}`}>
          {d.inspection.bag}
        </Link>
        <Link className="text-link" href="?view=drafts">
          {b.drafts}
        </Link>
      </nav>
    </main>
  )
}
