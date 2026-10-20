import type { SupabaseClient } from '@supabase/supabase-js'
import type { Dictionary } from '@/lib/i18n'
import type { DayClose } from '@/lib/engine/day-closes'
import { economicCopy } from '@/lib/accounting/economic-copy'
import {
  previewEconomicVoucher,
  readEconomicExports,
  readEconomicMap,
  readEconomicStatus,
} from '@/lib/engine/economic'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import { EconomicMapForm } from './economic-map-form'
import {
  EconomicDelivery,
  EconomicLines,
  EconomicPrepare,
} from './economic-export'
import { DayCloseForm } from './day-close-form'

export async function EconomicWorkspace({
  client,
  tenantId,
  role,
  view,
  selected,
  closes,
  d,
}: {
  client: SupabaseClient
  tenantId: string
  role: string
  view: string
  selected?: string
  closes: DayClose[]
  d: Dictionary
}) {
  const status = await readEconomicStatus(client, tenantId)
  const copy = economicCopy(d)
  if (!status) return <p>{d.economic.notConfigured}</p>
  const editable = ['owner', 'admin'].includes(role)
  if (view === 'accounts') {
    const map = await readEconomicMap(client, tenantId)
    return (
      <section className="card intake-form">
        <h2>{d.accounting.mapHeading} · e-conomic</h2>
        <EconomicMapForm
          key={map.id ?? 'none'}
          tenantId={tenantId}
          current={map}
          editable={editable && status.connected}
          d={copy}
        />
      </section>
    )
  }
  if (view === 'exports') {
    const exports = await readEconomicExports(client, tenantId, selected)
    return (
      <section className="card intake-form">
        <h2>{d.accounting.exportsHeading} · e-conomic</h2>
        {!exports.length && <p>{d.accounting.noExports}</p>}
        {exports.map((row) => (
          <article key={row.id} className="accounting-record stack">
            <h3>
              {row.day_closes.close_date} · {d.accounting.version}{' '}
              {row.day_closes.version}
            </h3>
            <p>
              {d.economic.agreement} {row.agreement_number} ·{' '}
              {d.economic.journal} {row.journal_number} ·{' '}
              {d.accounting.mapVersion} {row.economic_maps.version}
            </p>
            <Link
              className="text-link"
              href={`/intake/accounting?view=exports&destination=economic&export=${row.id}`}
            >
              {d.accounting.openExport}
            </Link>
            <EconomicLines
              lines={row.voucher}
              excluded={row.excluded}
              d={copy}
            />
            <EconomicDelivery
              key={`${row.id}-${row.send?.sendId}-${row.send?.status}`}
              tenantId={tenantId}
              exportId={row.id}
              initial={row.send}
              connected={status.connected}
              editable={editable}
              owner={role === 'owner'}
              d={copy}
            />
          </article>
        ))}
      </section>
    )
  }
  const previews = await Promise.all(
    closes
      .slice(0, 10)
      .map((row) => previewEconomicVoucher(client, tenantId, row.id)),
  )
  return (
    <div className="accounting-workspace">
      <section className="card intake-form">
        <h2>{d.accounting.generateHeading}</h2>
        <p>{d.accounting.generateHint}</p>
        {role !== 'readonly' && (
          <DayCloseForm
            tenantId={tenantId}
            defaultDate={new Date().toLocaleDateString('sv-SE', {
              timeZone: 'Europe/Stockholm',
            })}
            d={d.accounting}
            intake={d.intake}
          />
        )}
        <Link
          className="text-link"
          href="/intake/accounting?view=accounts&destination=economic"
        >
          {d.accounting.mapHeading} · e-conomic
        </Link>
      </section>
      <section className="card intake-form">
        <h2>{d.accounting.views.days} · e-conomic</h2>
        {previews.map((preview) => (
          <details key={preview.dayCloseId} className="accounting-record">
            <summary>
              {preview.closeDate} · {d.accounting.version}{' '}
              {preview.closeVersion}
            </summary>
            <EconomicPrepare
              key={`${preview.dayCloseId}-${preview.mapId}`}
              tenantId={tenantId}
              preview={preview}
              editable={editable && status.connected}
              d={copy}
            />
          </details>
        ))}
      </section>
    </div>
  )
}
