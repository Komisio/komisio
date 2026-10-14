import type { SupabaseClient } from '@supabase/supabase-js'
import { NavigationLink as PageLink } from '@/components/platform/navigation-warning'
import { dictionary, type Locale } from '@/lib/i18n'
import type { BagInventoryPage } from '@/lib/engine/bag-inventory'
import type { ItemSort } from '@/lib/engine/item-directory'
import { readAssortmentGroups } from '@/lib/engine/item-classification'
import { readAttributeVocabulary } from '@/lib/engine/attributes'
import { readItemCategories } from '@/lib/engine/item-categories'
import { InventoryTable } from './inventory-table'

export async function BagRegisteredItems({
  data,
  locale,
  itemPage,
  href,
  bagId,
  client,
  tenantId,
  role,
  sort,
  direction,
}: {
  data: BagInventoryPage
  locale: Locale
  itemPage: number
  href: (page: number, sort?: ItemSort, direction?: 'asc' | 'desc') => string
  bagId: string
  client: SupabaseClient
  tenantId: string
  role: string
  sort: ItemSort
  direction: 'asc' | 'desc'
}) {
  const d = dictionary(locale)
  const { items, total, offset } = data
  const pages = Math.max(1, Math.ceil(total / 25))
  const title = d.bagIntake.allRegistered
  const [groups, vocabulary, categories] = await Promise.all([
    readAssortmentGroups(client, tenantId),
    readAttributeVocabulary(client, tenantId),
    readItemCategories(client, tenantId),
  ])
  return (
    <section
      id="bag-registered"
      className="inventory-panel bag-inventory"
      style={{ scrollMarginTop: '1rem' }}
    >
      <h2>{title}</h2>
      <InventoryTable
        items={items}
        tenantId={tenantId}
        currency={data.currency}
        locale={locale}
        groups={groups}
        types={vocabulary.types}
        categories={categories}
        write={['owner', 'admin', 'staff'].includes(role)}
        manage={['owner', 'admin'].includes(role)}
        sort={sort}
        direction={direction}
        sortHref={(key, next) => href(1, key, next)}
        selectionKey={tenantId + bagId + itemPage + sort + direction}
        preserveDraft
      >
        {!items.length && (
          <p className="inventory-message">{d.bagIntake.empty}</p>
        )}
        <footer className="inventory-footer">
          <span>
            {d.items.showingRange
              .replace('{from}', String(total ? offset + 1 : 0))
              .replace('{to}', String(offset + items.length))
              .replace('{total}', String(total))}
          </span>
          {pages > 1 && (
            <nav className="inventory-pagination" aria-label={title}>
              {itemPage > 1 && (
                <PageLink
                  warningScope="inventory-table"
                  className="btn btn-secondary"
                  href={href(itemPage - 1)}
                >
                  {d.items.previousPage}
                </PageLink>
              )}
              <span>
                {d.items.pageOf
                  .replace('{page}', String(itemPage))
                  .replace('{pages}', String(pages))}
              </span>
              {itemPage < pages && (
                <PageLink
                  warningScope="inventory-table"
                  className="btn btn-secondary"
                  href={href(itemPage + 1)}
                >
                  {d.items.nextPage}
                </PageLink>
              )}
            </nav>
          )}
        </footer>
      </InventoryTable>
    </section>
  )
}
