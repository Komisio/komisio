'use client'
import { useRef, useState } from 'react'
import { locales, localeNames, type Dictionary } from '@/lib/i18n'
import {
  categoryName,
  createCategoryInput,
  itemCategory,
  type ItemCategory,
} from '@/lib/engine/item-categories'
import { useBusyState } from '@/components/platform/work-activity'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'
import { Button } from '@/components/ui/button'
import { SettingsSectionHelp } from './settings-section-help'

export function CategorySettings({
  tenantId,
  initial,
  locale,
  editable,
  d,
}: {
  tenantId: string
  initial: ItemCategory[]
  locale: string
  editable: boolean
  d: Dictionary
}) {
  const t = d.vocabularySettings
  const [categories, setCategories] = useState(initial)
  const [query, setQuery] = useState('')
  const [name, setName] = useState('')
  const [translations, setTranslations] = useState<Record<string, string>>({})
  const [busy, setBusy] = useBusyState(false)
  const [locked, setLocked] = useState(false)
  const [refused, setRefused] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const pending = useRef<ReturnType<typeof createCategoryInput.parse> | null>(
    null,
  )
  const running = useRef(false)
  useUnsavedChanges(
    name || locked || Object.values(translations).some((v) => v.trim())
      ? t.leave
      : null,
  )
  async function create() {
    if (!editable || running.current || refused) return
    const parsed = createCategoryInput.safeParse(
      pending.current ?? {
        tenantId,
        requestId: crypto.randomUUID(),
        name,
        labels: {
          ...Object.fromEntries(
            Object.entries(translations)
              .filter(([, v]) => v.trim())
              .map(([k, v]) => [k, v.trim()]),
          ),
          [locale]: name.trim(),
        },
      },
    )
    if (!parsed.success) {
      setError(t.nameRequired)
      return
    }
    const command = parsed.data
    pending.current = command
    running.current = true
    setBusy(true)
    setLocked(true)
    setError('')
    setSaved('')
    try {
      const response = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      })
      const result = await response.json()
      const category = itemCategory.safeParse(result.category)
      if (
        response.ok &&
        result.ok === true &&
        result.id === command.requestId &&
        category.success &&
        category.data.id === command.requestId &&
        category.data.name === command.name &&
        Object.entries(command.labels).every(
          ([key, value]) =>
            category.data.labels[key as keyof typeof category.data.labels] ===
            value,
        )
      ) {
        setCategories((current) => [
          ...current.filter((c) => c.id !== category.data.id),
          category.data,
        ])
        setName('')
        setTranslations({})
        setQuery('')
        setLocked(false)
        pending.current = null
        setSaved(t.saved.replace('{name}', categoryName(category.data, locale)))
      } else if (response.status >= 400 && response.status < 500) {
        setRefused(true)
        setError(
          result.error === 'CATEGORY_EXISTS' ? t.categoryExists : t.refused,
        )
      } else setError(t.uncertain)
    } catch {
      setError(t.uncertain)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  const rows = categories
    .filter((c) =>
      categoryName(c, locale)
        .toLocaleLowerCase(locale)
        .includes(query.trim().toLocaleLowerCase(locale)),
    )
    .sort((a, b) =>
      categoryName(a, locale).localeCompare(categoryName(b, locale), locale),
    )
  return (
    <div className="card vocabulary-panel">
      <SettingsSectionHelp
        label={`${d.settingsHelp.label}: ${t.categories}`}
        steps={d.settingsHelp.categories}
      />
      <div className="vocabulary-toolbar">
        <div className="field">
          <label htmlFor="category-search">{t.searchCategories}</label>
          <input
            id="category-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      {editable && (
        <form
          aria-label={t.addCategory}
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
        >
          <fieldset disabled={locked} className="vocabulary-category-form">
            <div className="field">
              <label htmlFor="new-category-name">{t.addCategory}</label>
              <input
                id="new-category-name"
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <details>
              <summary>{t.translations}</summary>
              <div className="vocabulary-form-grid">
                {locales
                  .filter((l) => l !== locale)
                  .map((l) => (
                    <div key={l} className="field">
                      <label htmlFor={`category-${l}`}>{localeNames[l]}</label>
                      <input
                        id={`category-${l}`}
                        maxLength={120}
                        value={translations[l] ?? ''}
                        onChange={(e) =>
                          setTranslations({
                            ...translations,
                            [l]: e.target.value,
                          })
                        }
                      />
                    </div>
                  ))}
              </div>
            </details>
          </fieldset>
          <div className="vocabulary-create-row">
            <Button
              type="submit"
              disabled={busy || refused || (!locked && !name.trim())}
            >
              {locked && !refused ? d.quickIntake.typeRetry : t.createCategory}
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
          </div>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      {saved && <p role="status">{saved}</p>}
      <table className="vocabulary-table">
        <caption className="sr-only">{t.categories}</caption>
        <thead>
          <tr>
            <th scope="col">{t.name}</th>
            <th scope="col">{t.languages}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <th scope="row">{categoryName(c, locale)}</th>
              <td>
                {locales
                  .filter((l) => c.labels[l])
                  .map((l) => localeNames[l])
                  .join(', ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <p>{categories.length ? t.noMatches : t.noCategories}</p>
      )}
    </div>
  )
}
