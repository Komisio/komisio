'use client'
import { DeleteCatalogueRecord } from './delete-catalogue-record'
import { SettingsSectionHelp } from './settings-section-help'

import { useRef, useState } from 'react'
import type { Dictionary } from '@/lib/i18n'
import { classificationCommand } from '@/lib/engine/item-classification'
import { useBusyState } from '@/components/platform/work-activity'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'
import { Button } from '@/components/ui/button'

export function AssortmentSettings({
  tenantId,
  initial,
  editable,
  d,
}: {
  tenantId: string
  initial: { id: string; name: string }[]
  editable: boolean
  d: Dictionary
}) {
  const t = d.vocabularySettings
  const [groups, setGroups] = useState(initial)
  const [query, setQuery] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useBusyState(false)
  const [locked, setLocked] = useState(false)
  const [refused, setRefused] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const pending = useRef<ReturnType<typeof classificationCommand.parse> | null>(
    null,
  )
  const running = useRef(false)
  useUnsavedChanges(name || locked ? t.leave : null)
  async function create() {
    if (!editable || running.current || refused) return
    const parsed = classificationCommand.safeParse(
      pending.current ?? {
        action: 'group',
        tenantId,
        requestId: crypto.randomUUID(),
        name,
      },
    )
    if (!parsed.success || parsed.data.action !== 'group') {
      setError(t.nameRequired)
      return
    }
    const command = parsed.data
    pending.current = command
    running.current = true
    setLocked(true)
    setBusy(true)
    setError('')
    setSaved('')
    try {
      const response = await fetch('/api/items/classification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      })
      const result = await response.json()
      if (
        response.ok &&
        result.ok === true &&
        result.id === command.requestId
      ) {
        setGroups((current) => [
          ...current.filter((g) => g.id !== result.id),
          { id: result.id, name: command.name },
        ])
        setName('')
        setQuery('')
        setSaved(t.saved.replace('{name}', command.name))
        pending.current = null
        setLocked(false)
      } else if (response.status >= 400 && response.status < 500) {
        setRefused(true)
        setError(result.error === 'GROUP_EXISTS' ? t.groupExists : t.refused)
      } else setError(t.uncertain)
    } catch {
      setError(t.uncertain)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  const rows = groups
    .filter((g) =>
      g.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    )
    .sort((a, b) => a.name.localeCompare(b.name))
  return (
    <div className="card vocabulary-panel">
      <SettingsSectionHelp
        label={`${d.settingsHelp.label}: ${d.vocabularySettings.groups}`}
        steps={d.settingsHelp.groups}
      />
      <p className="muted">{t.groupsHint}</p>
      <div className="vocabulary-toolbar">
        <div className="field">
          <label htmlFor="group-search">{t.searchGroups}</label>
          <input
            id="group-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      {editable && (
        <form
          aria-label={d.itemWorkflow.newGroup}
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
          className="vocabulary-create-row"
        >
          <div className="field">
            <label htmlFor="new-group-name">{d.itemWorkflow.newGroup}</label>
            <input
              id="new-group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              disabled={locked}
            />
          </div>
          <Button
            type="submit"
            disabled={busy || refused || (!locked && !name.trim())}
          >
            {locked && !refused
              ? d.quickIntake.typeRetry
              : d.itemWorkflow.createGroup}
          </Button>
          {refused && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                pending.current = null
                setLocked(false)
                setRefused(false)
                setError('')
              }}
            >
              {d.quickIntake.typeCancel}
            </Button>
          )}
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      {saved && <p role="status">{saved}</p>}
      <table className="vocabulary-table">
        <caption className="sr-only">{t.groups}</caption>
        <thead>
          <tr>
            <th scope="col">{t.name}</th>
            {editable && <th scope="col">{d.catalogueDeletion.actions}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.id}>
              <th scope="row">{g.name}</th>
              {editable && (
                <td className="catalogue-actions">
                  <DeleteCatalogueRecord
                    tenantId={tenantId}
                    kind="group"
                    recordKey={g.id}
                    name={g.name}
                    d={d}
                    onDeleted={() => {
                      setGroups((v) => v.filter((row) => row.id !== g.id))
                      setSaved(
                        d.catalogueDeletion.deleted.replace('{name}', g.name),
                      )
                    }}
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p>{groups.length ? t.noMatches : t.noGroups}</p>}
    </div>
  )
}
