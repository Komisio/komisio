import { BackLink } from '@/components/platform/back-link'
import type { ItemSort } from '@/lib/engine/item-directory'
import { readBagProcessing } from '@/lib/engine/bag-processing'
import { BagProcessing } from './bag-processing'
import { readBagWorkSummary } from '@/lib/engine/bag-work-summary'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import { BagRegisteredItems } from './bag-registered-items'
import { redirect } from 'next/navigation'
import { readBagInventory } from '@/lib/engine/bag-inventory'
import type { SupabaseClient } from '@supabase/supabase-js'
import { dictionary, type Locale } from '@/lib/i18n'
import { QuickReception } from './quick-reception'
import { readPrinters } from '@/lib/engine/printing'
import { readItemCategories } from '@/lib/engine/item-categories'
import { readAssortmentGroups } from '@/lib/engine/item-classification'
import { readAttributeVocabulary } from '@/lib/engine/attributes'
import { resolveReceptionAssistance } from '@/lib/assistance/reception-config'

export async function BagReception({
  client,
  tenantId,
  bagId,
  reference,
  note,
  locale,
  readonly,
  itemPage = 1,
  sort,
  direction,
  role,
}: {
  client: SupabaseClient
  tenantId: string
  bagId: string
  reference: string | number
  note: string
  locale: Locale
  readonly: boolean
  sort: ItemSort
  direction: 'asc' | 'desc'
  role: string
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
      readBagInventory(
        client,
        tenantId,
        bagId,
        (itemPage - 1) * 25,
        sort,
        direction,
      ),
    ])
  if (seller.error) throw new Error('Unable to read bag reception')
  const processing = await readBagProcessing(client, tenantId, bagId)
  const { total } = received
  const registeredTitle = b.allRegistered
  const pages = Math.max(1, Math.ceil(total / 25))
  const href = (page: number, nextSort = sort, nextDirection = direction) =>
    `/intake/bags/${bagId}/inspect?itemSort=${nextSort}&itemDirection=${nextDirection}&itemPage=${page}#bag-registered`
  if (itemPage > pages) redirect(href(pages))
  const [groups, categories, progress] = await Promise.all([
    readAssortmentGroups(client, tenantId),
    readItemCategories(client, tenantId),
    readBagWorkSummary(client, tenantId, bagId),
  ])
  return (
    <div className="bag-reception-page">
      <BackLink className="text-link" href="/intake">
        {d.returnNavigation.back}
      </BackLink>
      <header className="page-heading">
        <p className="eyebrow">
          {d.intake.bag} K-{reference} · {seller.data.name}
        </p>
        <h1>{d.inspection.title}</h1>
        {processing.state === 'open' && <p>{b.intro}</p>}
        {note && <p className="bag-note">{note}</p>}
        {total > 0 && (
          <Link className="text-link" href="#bag-registered">
            {registeredTitle} ({total})
          </Link>
        )}
      </header>
      {progress ? (
        <BagProcessing
          key={`${bagId}:${processing.version}`}
          tenantId={tenantId}
          bagId={bagId}
          locale={locale}
          current={processing}
          pending={progress.receptions > 0}
          d={d}
          readonly={readonly}
        />
      ) : (
        <p role="status">{d.bagProgress.unavailable}</p>
      )}
      {progress?.nextReception && (
        <Link
          className="text-link"
          href={`/intake/reception/${progress.nextReception}`}
        >
          {d.bagProgress.resumeReception} →
        </Link>
      )}
      {!readonly && processing.state === 'open' && (
        <QuickReception
          currency={received.currency}
          scanFocusLabel={d.scanFocus}
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
          typeSettings={d.vocabularySettings}
          canManageTypes={['owner', 'admin'].includes(role)}
          groups={groups}
          categories={categories}
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
        bagId={bagId}
        data={received}
        locale={locale}
        client={client}
        tenantId={tenantId}
        role={role}
        sort={sort}
        direction={direction}
        itemPage={itemPage}
        href={href}
      />
      <nav className="row bag-inspection-links">
        <Link className="text-link" href={`/intake/bags/${bagId}`}>
          {d.inspection.bag}
        </Link>
      </nav>
    </div>
  )
}
