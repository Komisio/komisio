import { BagWorkSummary } from './bag-work-summary'
import Link from 'next/link'
import { BagRegisteredItems } from './bag-registered-items'
import { redirect } from 'next/navigation'
import { readBagRegisteredItems } from '@/lib/engine/bag-registered-items'
import type { SupabaseClient } from '@supabase/supabase-js'
import { dictionary, type Locale } from '@/lib/i18n'
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
  canManageTypes = false,
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
  canManageTypes?: boolean
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
      readBagRegisteredItems(client, tenantId, bagId, (itemPage - 1) * 25),
    ])
  if (seller.error) throw new Error('Unable to read bag reception')
  const { total, legacy } = received
  const registeredTitle =
    received.scope === 'all' ? b.allRegistered : b.registered
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
            {registeredTitle} ({total}
            {legacy && total === 50 ? ' +' : ''})
          </Link>
        )}
      </header>
      <BagWorkSummary
        client={client}
        tenantId={tenantId}
        bagId={bagId}
        locale={locale}
      />
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
          canManageTypes={canManageTypes}
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
      <BagRegisteredItems
        data={received}
        locale={locale}
        currency={currency}
        itemPage={itemPage}
        href={href}
      />
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
