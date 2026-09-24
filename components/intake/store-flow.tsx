'use client'
import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowRight, Check, ShoppingBag } from 'lucide-react'
import type { Dictionary } from '@/lib/i18n'
import {
  flowDocument,
  type FlowDocument,
  type FlowStepId,
} from '@/lib/engine/store-flow'
import { flowGroups, flowLinks } from '@/lib/platform/store-flow'
import './store-flow.css'

export function StoreFlow({
  tenantId,
  current,
  editable,
  perItem,
  d,
  live,
}: {
  live: ReactNode
  tenantId: string
  current: FlowDocument
  editable: boolean
  perItem: boolean
  d: Dictionary['storeFlow']
}) {
  const [mode, setMode] = useState<'work' | 'now'>('work')
  const [selected, setSelected] = useState<FlowStepId>('receive')
  const [saved, setSaved] = useState(current)
  const [notes, setNotes] = useState(current.notes)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const dirty = JSON.stringify(notes) !== JSON.stringify(saved.notes)
  const step = d.steps[selected]
  function selectStep(id: FlowStepId) {
    setSelected(id)
    setStatus('')
    if (window.matchMedia('(max-width: 900px)').matches) {
      document.getElementById('flow-detail')?.scrollIntoView({ block: 'start' })
      document.getElementById('flow-detail')?.focus({ preventScroll: true })
    }
  }
  async function save() {
    setBusy(true)
    setStatus('')
    try {
      const response = await fetch('/api/store-flow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, revision: saved.revision, notes }),
      })
      const body = await response.json()
      if (!response.ok) {
        setStatus(body.error === 'STALE_VERSION' ? d.conflict : d.failed)
        return
      }
      const next = flowDocument.parse(body)
      setSaved(next)
      setNotes(next.notes)
      setStatus(d.saved)
    } catch {
      setStatus(d.failed)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="store-flow">
      <header className="flow-heading">
        <div>
          <p className="flow-eyebrow">
            {mode === 'now' ? d.live.now : d.eyebrow}
          </p>
          <h1>{d.title}</h1>
          <p>{d.intro}</p>
        </div>
        <ShoppingBag aria-hidden="true" size={36} />
      </header>
      <div className="flow-modes" role="group" aria-label={d.title}>
        <button
          type="button"
          aria-pressed={mode === 'work'}
          onClick={() => setMode('work')}
        >
          {d.live.work}
        </button>
        <button
          type="button"
          aria-pressed={mode === 'now'}
          onClick={() => setMode('now')}
        >
          {d.live.now}
        </button>
      </div>
      <div hidden={mode !== 'now'}>{live}</div>
      <div hidden={mode !== 'work'}>
        <p className="flow-explanation">{d.guide}</p>
        <div className="flow-route" aria-label={d.eyebrow}>
          {[0, 1, 2, 4].map((group, index) => (
            <div className="flow-route-step" key={group}>
              {index > 0 && <ArrowRight aria-hidden="true" />}
              <button
                type="button"
                onClick={() => selectStep(flowGroups[group][0])}
              >
                {d.groups[group]}
              </button>
            </div>
          ))}
          <p>{d.branch}</p>
          <div className="flow-route-step">
            <span>{d.groups[2]}</span>
            <ArrowRight aria-hidden="true" />
            <button type="button" onClick={() => selectStep('unsold')}>
              {d.groups[3]}
            </button>
          </div>
        </div>
        <div className="flow-layout">
          <nav
            id="flow-map"
            className="flow-map"
            aria-label={d.title}
            tabIndex={-1}
          >
            {flowGroups.map((group, index) => (
              <section className="flow-group" key={index}>
                <h2>
                  <span>{index + 1}</span>
                  {d.groups[index]}
                </h2>
                <div className="flow-cards">
                  {group.map((id, i) => (
                    <div key={id} className="flow-node-wrap">
                      {i > 0 && (
                        <ArrowDown className="flow-arrow" aria-hidden="true" />
                      )}
                      <button
                        type="button"
                        className="flow-node"
                        aria-pressed={selected === id}
                        aria-controls="flow-detail"
                        onClick={() => selectStep(id)}
                      >
                        <small>{d.steps[id].actor}</small>
                        <strong>{d.steps[id].title}</strong>
                        {notes[id] && (
                          <span className="flow-note-mark">
                            <Check size={14} aria-hidden="true" />
                            {d.localRoutine}
                          </span>
                        )}
                      </button>
                    </div>
                  ))}
                </div>
                {index === 2 && <p className="flow-branch">{d.branch}</p>}
              </section>
            ))}
          </nav>
          <aside
            id="flow-detail"
            className="flow-detail"
            aria-label={d.details}
            tabIndex={-1}
          >
            <a className="flow-back" href="#flow-map">
              ↑ {d.title}
            </a>
            <p className="flow-eyebrow">{step.actor}</p>
            <h2>{step.title}</h2>
            <h3>{d.happens}</h3>
            <p>{step.description}</p>
            <h3>{d.inKomisio}</h3>
            <p>
              {selected === 'review'
                ? perItem
                  ? d.reviewRequired
                  : d.reviewDelegated
                : step.system}
            </p>
            <Link className="flow-open" href={flowLinks[selected]}>
              {step.action}
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <div className="flow-routine">
              <label htmlFor="flow-note">{d.localRoutine}</label>
              <p>{d.noteHelp}</p>
              {editable ? (
                <>
                  <textarea
                    id="flow-note"
                    value={notes[selected] ?? ''}
                    maxLength={2000}
                    disabled={busy}
                    onChange={(e) => {
                      setNotes({ ...notes, [selected]: e.target.value })
                      setStatus('')
                    }}
                    placeholder={d.placeholder}
                  />
                  <div className="flow-save">
                    <button
                      type="button"
                      onClick={save}
                      disabled={busy || !dirty}
                    >
                      {busy ? d.saving : d.save}
                    </button>
                    <span>{dirty ? d.unsaved : ''}</span>
                  </div>
                </>
              ) : (
                <p className="flow-note-text">{notes[selected] || d.empty}</p>
              )}
              <p role="status">{status}</p>
            </div>
          </aside>
        </div>
      </div>
    </section>
  )
}
