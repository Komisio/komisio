'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { Dictionary } from '@/lib/i18n'
import { saleSearchRows, type SaleSearchItem } from '@/lib/engine/sale-search'

/** Search only suggests identities; the separate match action commits the choice. */
export function ItemMatchInput({
  id,
  tenantId,
  value,
  onChange,
  disabled,
  d,
  search,
}: {
  id: string
  tenantId: string
  value: string
  onChange: (value: string) => void
  disabled: boolean
  d: Dictionary['zettle']
  search: Dictionary['sales']
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SaleSearchItem[]>([])
  const [selected, setSelected] = useState<SaleSearchItem | null>(null)
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')
  const version = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  function invalidate() {
    version.current++
    setResults([])
    setSearched(false)
    setSearching(false)
    setError('')
  }
  async function find() {
    const q = query.trim()
    if (disabled || q.length < 2) return
    const attempt = ++version.current
    setSearching(true)
    setSearched(false)
    setResults([])
    setError('')
    try {
      const response = await fetch(
        `/api/sales/items?${new URLSearchParams({ tenant: tenantId, q })}`,
        { cache: 'no-store' },
      )
      if (!response.ok) throw new Error('Search failed')
      const items = saleSearchRows.parse((await response.json()).items)
      if (attempt !== version.current) return
      setResults(items)
      setSearched(true)
    } catch {
      if (attempt === version.current) setError(search.searchFailed)
    } finally {
      if (attempt === version.current) setSearching(false)
    }
  }
  return (
    <div className="item-match-input">
      <input type="hidden" name="itemId" value={value} />
      {selected ? (
        <div className="item-match-selected" role="status">
          <span>{d.selectedItem}</span>
          <strong>{selected.title}</strong>
          <small>I-{selected.id.slice(0, 8).toUpperCase()}</small>
          <Button
            type="button"
            variant="secondary"
            disabled={disabled}
            onClick={() => {
              invalidate()
              setSelected(null)
              onChange('')
              setQuery('')
              requestAnimationFrame(() => input.current?.focus())
            }}
          >
            {search.remove}
          </Button>
        </div>
      ) : (
        <>
          <div className="field">
            <label htmlFor={`${id}-search`}>{search.search}</label>
            <input
              ref={input}
              id={`${id}-search`}
              value={query}
              maxLength={120}
              disabled={disabled}
              aria-describedby={`${id}-hint`}
              onChange={(event) => {
                invalidate()
                setQuery(event.target.value)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void find()
                }
              }}
            />
            <small id={`${id}-hint`}>{search.searchHint}</small>
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={disabled || searching || query.trim().length < 2}
            onClick={() => void find()}
          >
            {searching ? d.busy : search.searchButton}
          </Button>
          {error && <p role="alert">{error}</p>}
          {searched && !results.length && (
            <p role="status">{search.noMatches}</p>
          )}
          {results.length > 20 && <p role="status">{search.narrowSearch}</p>}
          {results.length > 0 && (
            <ul className="item-match-results">
              {results.slice(0, 20).map((item) => {
                const prefix = item.id.slice(0, 8).toUpperCase()
                const collision = results.some(
                  (other) =>
                    other.id !== item.id &&
                    other.id.slice(0, 8).toUpperCase() === prefix,
                )
                return (
                  <li key={item.id}>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={disabled}
                      onClick={() => {
                        invalidate()
                        setSelected(item)
                        onChange(item.id)
                        requestAnimationFrame(() =>
                          document.getElementById(`${id}-confirm`)?.focus(),
                        )
                      }}
                    >
                      <span>
                        {d.chooseItem}: <strong>{item.title}</strong>
                      </span>
                      <small>{collision ? item.id : `I-${prefix}`}</small>
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
      <details className="item-match-manual">
        <summary>{d.item}</summary>
        <div className="field">
          <label htmlFor={id}>{d.item}</label>
          <input
            id={id}
            value={value}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            onChange={(event) => {
              invalidate()
              setSelected(null)
              onChange(event.target.value)
            }}
          />
        </div>
      </details>
    </div>
  )
}
