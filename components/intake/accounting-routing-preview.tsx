'use client'

import { useState } from 'react'
import type { Dictionary } from '@/lib/i18n'
import type { VoucherPreview } from '@/lib/engine/accounting'
import { formatSignedOre } from '@/lib/engine/seller-ledger'
import {
  previewAccountingRouting,
  routingModes,
  type RoutingMode,
  type ExternalSales,
} from '@/lib/accounting/routing-preview'

export function AccountingRoutingPreview({
  previews,
  currency,
  d,
  accounting,
}: {
  previews: VoucherPreview[]
  currency: string
  d: Dictionary['accountingRouting']
  accounting: Dictionary['accounting']
}) {
  const [mode, setMode] = useState<RoutingMode>('komisio')
  const [external, setExternal] = useState<ExternalSales>('unknown')
  const [closeId, setCloseId] = useState(previews[0]?.dayCloseId ?? '')
  const current = previews.find((p) => p.dayCloseId === closeId) ?? null
  const result = previewAccountingRouting(mode, external, current)
  return (
    <section
      className="card intake-form accounting-routing"
      aria-labelledby="routing-title"
    >
      <h2 id="routing-title">{d.title}</h2>
      <p className="accounting-routing-notice">{d.notice}</p>
      <div className="accounting-routing-grid">
        <div className="stack">
          <fieldset className="accounting-routing-options">
            <legend>{d.modeLabel}</legend>
            {routingModes.map((value) => (
              <label key={value} className="accounting-routing-choice">
                <input
                  type="radio"
                  name="routing-mode"
                  value={value}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                />
                <span>
                  <strong>{d.modes[value].title}</strong>
                  <span>{d.modes[value].hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {mode !== 'manual' && (
            <div className="field">
              <label htmlFor="routing-external">{d.externalLabel}</label>
              <select
                id="routing-external"
                value={external}
                onChange={(e) => setExternal(e.target.value as ExternalSales)}
                aria-describedby="routing-external-hint"
              >
                {(['unknown', 'enabled', 'disabled'] as const).map((value) => (
                  <option key={value} value={value}>
                    {d.external[value]}
                  </option>
                ))}
              </select>
              <small id="routing-external-hint">{d.externalHint}</small>
            </div>
          )}
          <details className="accounting-breakdown">
            <summary>{d.currentHeading}</summary>
            <p>{d.currentHint}</p>
            {previews.length === 0 ? (
              <p>{accounting.empty}</p>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="routing-close">{d.closeLabel}</label>
                  <select
                    id="routing-close"
                    value={closeId}
                    onChange={(e) => setCloseId(e.target.value)}
                  >
                    {previews.map((p) => (
                      <option key={p.dayCloseId} value={p.dayCloseId}>
                        {p.closeDate} · {accounting.version} {p.closeVersion}
                      </option>
                    ))}
                  </select>
                </div>
                {current && (
                  <dl className="accounting-routing-owners">
                    <div>
                      <dt>{accounting.lines}</dt>
                      <dd>{current.lines.length}</dd>
                    </div>
                    <div>
                      <dt>{accounting.debitTotal}</dt>
                      <dd>
                        {formatSignedOre(current.debitOre)} {currency}
                      </dd>
                    </div>
                    <div>
                      <dt>{accounting.creditTotal}</dt>
                      <dd>
                        {formatSignedOre(current.creditOre)} {currency}
                      </dd>
                    </div>
                  </dl>
                )}
              </>
            )}
          </details>
        </div>
        <div className="stack">
          <h3>{d.responsibilities}</h3>
          <dl className="accounting-routing-owners">
            {Object.entries(result.owners).map(([event, owner]) => (
              <div key={event}>
                <dt>{d.events[event as keyof typeof d.events]}</dt>
                <dd>{d.owners[owner]}</dd>
              </div>
            ))}
          </dl>
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="accounting-routing-checks"
          >
            <h3>{d.checkHeading}</h3>
            <ul>
              {result.issues.map((issue) => (
                <li key={issue}>{d.issues[issue]}</li>
              ))}
            </ul>
          </div>
          <p>{d.noActivation}</p>
        </div>
      </div>
    </section>
  )
}
