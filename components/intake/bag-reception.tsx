import Link from 'next/link'
import Image from 'next/image'
import { redirect } from 'next/navigation'
import { readBagReceivedItems } from '@/lib/engine/bag-received-items'
import type { SupabaseClient } from '@supabase/supabase-js'
import { dictionary, intlLocale, type Locale } from '@/lib/i18n'
import { QuickReception } from './quick-reception'
import { readPrinters } from '@/lib/engine/printing'
import { readAttributeVocabulary } from '@/lib/engine/attributes'
import { resolveReceptionAssistance } from '@/lib/assistance/reception-config'

export async function BagReception({
  client,
  tenantId,
  bagId,
  reference,
  note,
  locale,
  currency,
  readonly,
  itemPage = 1,
}: {
  client: SupabaseClient
  tenantId: string
  bagId: string
  reference: string | number
  note: string
  locale: Locale
  currency: string
  readonly: boolean
  itemPage?: number
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
      readBagReceivedItems(client, tenantId, bagId, (itemPage - 1) * 25),
    ])
  if (seller.error) throw new Error('Unable to read bag reception')
  const { items, total, offset, legacy } = received
  const pages = legacy ? 1 : Math.max(1, Math.ceil(total / 25))
  const href = (page: number) =>
    `/intake/bags/${bagId}/inspect?itemPage=${page}#bag-registered`
  if (itemPage > pages) redirect(href(pages))
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
        {total > 0 && (
          <Link className="text-link" href="#bag-registered">
            {b.registered} ({total}
            {legacy && total === 50 ? ' +' : ''})
          </Link>
        )}
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
      <section
        id="bag-registered"
        className="card bag-received-items"
        style={{ scrollMarginTop: '1rem' }}
      >
        <h2>{b.registered}</h2>
        {!legacy && total > 0 && (
          <p>
            <small>
              {d.items.showingRange
                .replace('{from}', String(offset + 1))
                .replace('{to}', String(offset + items.length))
                .replace('{total}', String(total))}
            </small>
          </p>
        )}
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
        {legacy && items.length === 50 && <p>{b.limit}</p>}
        {pages > 1 && (
          <nav className="row wrap" aria-label={b.registered}>
            {itemPage > 1 && (
              <Link className="btn btn-secondary" href={href(itemPage - 1)}>
                {d.items.previousPage}
              </Link>
            )}
            <span>
              {d.items.pageOf
                .replace('{page}', String(itemPage))
                .replace('{pages}', String(pages))}
            </span>
            {itemPage < pages && (
              <Link className="btn btn-secondary" href={href(itemPage + 1)}>
                {d.items.nextPage}
              </Link>
            )}
          </nav>
        )}
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
