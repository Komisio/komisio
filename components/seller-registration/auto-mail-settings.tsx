'use client'
import { useState } from 'react'
import { useRouter } from '@/components/platform/use-working-router'
import { useRegistrationCommand } from './use-registration-command'
import type { Dictionary } from '@/lib/i18n'

export function AutoMailSettings({
  tenantId,
  current,
  canEdit,
  d,
}: {
  tenantId: string
  current: { id: string | null; enabled: boolean }
  canEdit: boolean
  d: Dictionary
}) {
  const [enabled, setEnabled] = useState(current.enabled)
  const command = useRegistrationCommand(d.selfRegistration),
    router = useRouter(),
    t = d.storeMail
  return (
    <section className="card registration-settings">
      <h2>{t.autoTitle}</h2>
      <p id="auto-mail-hint">{t.autoHint}</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (
            await command.send({
              action: 'mailSettings',
              tenantId,
              requestId: crypto.randomUUID(),
              expected: current.id,
              enabled,
            })
          )
            router.refresh()
        }}
      >
        <label className="check">
          <input
            type="checkbox"
            checked={enabled}
            disabled={!canEdit || command.locked}
            aria-describedby="auto-mail-hint"
            onChange={(e) => setEnabled(e.target.checked)}
          />
          {t.autoLabel}
        </label>
        {canEdit && (
          <button
            className="btn btn-secondary"
            disabled={
              command.busy ||
              command.done ||
              (enabled === current.enabled && !command.uncertain)
            }
          >
            {command.uncertain ? d.selfRegistration.retry : t.save}
          </button>
        )}
        {command.error && <p role="alert">{command.error}</p>}
      </form>
    </section>
  )
}
