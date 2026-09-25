'use client'
import { useEffect, useState } from 'react'
import type { Dictionary } from '@/lib/i18n'
import {
  sellerSearchResult,
  type SellerChoice,
} from '@/lib/intake/seller-search'

export function QuickSellerPicker({
  tenantId,
  sellers,
  total,
  onSelect,
  d,
}: {
  tenantId: string
  sellers: SellerChoice[]
  total: number
  onSelect: (seller: SellerChoice) => void
  d: Dictionary['quickIntake']
}) {
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [retry, setRetry] = useState(0)
  const q = query.trim()
  const key = JSON.stringify([tenantId, q, offset, retry])
  const initial = q === '' && offset === 0
  const [answer, setAnswer] = useState<{
    key: string
    data?: { sellers: SellerChoice[]; total: number; offset: number }
    failed?: boolean
  } | null>(null)
  useEffect(() => {
    if (initial) return
    const controller = new AbortController()
    let active = true
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          '/api/sellers/search?' +
            new URLSearchParams({
              tenant: tenantId,
              q,
              offset: String(offset),
            }),
          { signal: controller.signal, cache: 'no-store' },
        )
        if (!response.ok) throw new Error('SEARCH_FAILED')
        const data = sellerSearchResult.parse(await response.json())
        if (active) setAnswer({ key, data })
      } catch {
        if (active) setAnswer({ key, failed: true })
      }
    }, 250)
    return () => {
      active = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [tenantId, q, offset, key, initial])
  // Never show or allow selection from a response for an earlier query.
  const current: typeof answer = initial
    ? { key, data: { sellers, total, offset: 0 } }
    : answer?.key === key
      ? answer
      : null
  const data = current?.data
  return (
    <>
      <div className="field">
        <label htmlFor="quick-seller-search">{d.searchSeller}</label>
        <input
          id="quick-seller-search"
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setOffset(0)
          }}
          maxLength={120}
          autoFocus
          placeholder={d.sellerSearchHint}
        />
      </div>
      <div aria-live="polite" role="status">
        {!current && <p>{d.sellerSearching}</p>}
        {current?.failed && (
          <p>
            {d.sellerSearchFailed}{' '}
            <button
              type="button"
              className="text-link"
              onClick={() => setRetry((value) => value + 1)}
            >
              {d.sellerSearchRetry}
            </button>
          </p>
        )}
        {data && data.total > 0 && (
          <p>
            <small>
              {d.sellerSearchRange
                .replace(
                  '{from}',
                  String(data.sellers.length ? data.offset + 1 : 0),
                )
                .replace('{to}', String(data.offset + data.sellers.length))
                .replace('{total}', String(data.total))}
            </small>
          </p>
        )}
        {data && data.sellers.length === 0 && <p>{d.noSeller}</p>}
      </div>
      {data && (
        <>
          <ul className="intake-list">
            {data.sellers.map((seller) => (
              <li key={seller.id}>
                <button
                  type="button"
                  className="intake-seller"
                  onClick={() => onSelect(seller)}
                >
                  <strong>{seller.name}</strong>
                  <small>{seller.contact ?? ''}</small>
                </button>
              </li>
            ))}
          </ul>
          {(data.offset > 0 ||
            data.offset + data.sellers.length < data.total) && (
            <nav className="row wrap" aria-label={d.seller}>
              {data.offset > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setOffset(Math.max(0, data.offset - 12))}
                >
                  {d.sellerSearchPrevious}
                </button>
              )}
              {data.offset + data.sellers.length < data.total && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setOffset(data.offset + 12)}
                >
                  {d.sellerSearchNext}
                </button>
              )}
            </nav>
          )}
        </>
      )}
    </>
  )
}
