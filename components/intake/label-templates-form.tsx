'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import type { Dictionary } from '@/lib/i18n'
import {
  resetLabelTemplateCommand,
  setLabelTemplateCommand,
  type LabelTemplates,
} from '@/lib/engine/printing'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'
import { placeholders } from '@/lib/labels/placeholders'

const kinds = ['bag', 'garment', 'item', 'markdown', 'onboarding'] as const
type Kind = (typeof kinds)[number]

/**
 * What the route answers for a confirmed publish and a confirmed reset.
 * Anything else on a 2xx is not a confirmation: the version may exist while
 * only the reply was damaged.
 */
const savedTemplate = z.object({
  ok: z.literal(true),
  id: z.object({
    id: z.guid(),
    kind: z.string(),
    version: z.number().int().positive(),
    name: z.string(),
  }),
})
const resetTemplate = z.object({ ok: z.literal(true), id: z.boolean() })
/** Answered before any version is written: the fields may be corrected. */
const DEFINITIVE = new Set([
  'INVALID_INPUT',
  'LABEL_TEMPLATE_FRAME',
  'LABEL_TEMPLATE_CONTROL',
  'LABEL_TEMPLATE_REFERENCE',
])
/** The page's context is stale: no further write without a reload. */
const STALE = new Set([
  'FORBIDDEN',
  'AUTH_REQUIRED',
  'TENANT_CHANGED',
  'NOT_FOUND',
])
type Pending = {
  phase: 'idle' | 'busy' | 'uncertain' | 'stale'
  of: 'save' | 'reset' | null
}

/** The ZPL editor: one template per label kind, placeholders, preview with sample data, versions. */
export function LabelTemplatesForm({
  tenantId,
  templates,
  builtins,
  canEdit,
  dpi,
  d,
  intake,
  leaveUnsaved,
}: {
  tenantId: string
  templates: LabelTemplates
  builtins: Record<Kind, string>
  canEdit: boolean
  dpi: 203 | 300 | 600
  d: Dictionary['printing']
  intake: Dictionary['intake']
  leaveUnsaved: string
}) {
  const [kind, setKind] = useState<Kind>('item')
  const [dirty, setDirty] = useState(false)
  // Switching kind remounts the editor; while its outcome is unresolved that
  // would discard the identity and the unsaved text, so the switch waits.
  const [frozen, setFrozen] = useState(false)
  // Expert territory: collapsed until asked for, so the printing tab on a phone
  // is mostly the everyday controls. The editor stays mounted while closed, so
  // typed but unsaved work survives closing and reopening.
  return (
    <details className="label-templates-fold">
      <summary>
        <h3>{d.templatesHeading}</h3>
      </summary>
      <p>{d.templatesIntro}</p>
      <div className="field">
        <label htmlFor="template-kind">{d.formatKind}</label>
        <select
          id="template-kind"
          value={kind}
          disabled={frozen}
          onChange={(e) => {
            if (!frozen && (!dirty || window.confirm(d.discardTemplate)))
              setKind(e.target.value as Kind)
          }}
        >
          {kinds.map((k) => (
            <option key={k} value={k}>
              {d.kinds[k]}
              {templates[k]
                ? ` · ${d.templateCustom}`
                : ` · ${d.templateBuiltin}`}
            </option>
          ))}
        </select>
      </div>
      <TemplateEditor
        key={`${kind}-${templates[kind]?.version ?? 0}`}
        tenantId={tenantId}
        kind={kind}
        current={templates[kind]}
        builtin={builtins[kind]}
        canEdit={canEdit}
        dpi={dpi}
        d={d}
        intake={intake}
        leaveUnsaved={leaveUnsaved}
        onDirty={setDirty}
        onFrozen={setFrozen}
      />
    </details>
  )
}

function TemplateEditor({
  tenantId,
  kind,
  current,
  builtin,
  canEdit,
  dpi,
  d,
  intake,
  leaveUnsaved,
  onFrozen,
  onDirty,
}: {
  tenantId: string
  kind: Kind
  current: LabelTemplates[Kind]
  builtin: string
  canEdit: boolean
  dpi: 203 | 300 | 600
  d: Dictionary['printing']
  intake: Dictionary['intake']
  leaveUnsaved: string
  onDirty: (dirty: boolean) => void
  onFrozen: (frozen: boolean) => void
}) {
  const router = useRouter()
  const running = useRef(false)
  const [name, setName] = useState(current?.name ?? d.templateDefaultName)
  const [zpl, setZpl] = useState(current?.zpl ?? '')
  const [confirmed, setConfirmed] = useState({
    name: current?.name ?? d.templateDefaultName,
    zpl: current?.zpl ?? '',
  })
  const dirty = name !== confirmed.name || zpl !== confirmed.zpl
  useEffect(() => {
    onDirty(dirty)
    return () => onDirty(false)
  }, [dirty, onDirty])
  const [preview, setPreview] = useState<string | null>(null)
  const previewRevision = useRef(0)
  const [previewing, setPreviewing] = useState(false)
  const [message, setMessage] = useState('')
  const [invalid, setInvalid] = useState('')
  // Publishing is not replay-safe (every call writes a new version), so an
  // unanswered save or reset is never resent: the editor freezes and offers a
  // reload to inspect what the store actually holds.
  const [pending, setPending] = useState<Pending>({ phase: 'idle', of: null })
  const busy = pending.phase === 'busy'
  const frozen = pending.phase === 'uncertain' || pending.phase === 'stale'
  // The parent's kind switch remounts this editor; while a command is in
  // flight or unresolved that would discard its outcome, so it waits too.
  const locked = busy || frozen
  useUnsavedChanges(canEdit && (dirty || locked) ? leaveUnsaved : null)
  useEffect(() => {
    onFrozen(locked)
    return () => onFrozen(false)
  }, [locked, onFrozen])
  const errors = d.templateErrors as Record<string, string>
  /** One command, one classified outcome; guarded against a second click. */
  async function send<T>(
    of: 'save' | 'reset',
    command: object,
    shape: z.ZodType<{ ok: true; id: T }>,
  ): Promise<T | null> {
    if (running.current || frozen) return null
    running.current = true
    setPending({ phase: 'busy', of })
    setMessage('')
    setInvalid('')
    try {
      const r = await fetch('/api/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      })
      const body: unknown = await r.json().catch(() => null)
      if (r.ok) {
        const parsed = shape.safeParse(body)
        if (!parsed.success) {
          setPending({ phase: 'uncertain', of })
          setInvalid(d.templateUncertain)
          return null
        }
        setPending({ phase: 'idle', of: null })
        return parsed.data.id
      }
      const code =
        body && typeof body === 'object' && 'error' in body
          ? String((body as { error: unknown }).error)
          : ''
      const answered = r.status >= 400 && r.status < 500
      if (answered && DEFINITIVE.has(code)) {
        setPending({ phase: 'idle', of: null })
        setInvalid(errors[code] ?? d.templateInvalid)
      } else if (answered && STALE.has(code)) {
        setPending({ phase: 'stale', of })
        setInvalid(code === 'TENANT_CHANGED' ? intake.changed : intake.denied)
      } else {
        setPending({ phase: 'uncertain', of })
        setInvalid(d.templateUncertain)
      }
      return null
    } catch {
      setPending({ phase: 'uncertain', of })
      setInvalid(d.templateUncertain)
      return null
    } finally {
      running.current = false
    }
  }
  async function previewNow() {
    if (running.current) return
    running.current = true
    const revision = previewRevision.current
    setPreviewing(true)
    setPreview(null)
    setMessage('')
    try {
      const r = await fetch('/api/print/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          kind,
          zpl: zpl.trim() ? zpl : null,
          dpi,
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (revision !== previewRevision.current) return
      if (!r.ok || !data.image) {
        setPreview(null)
        setMessage(d.previewUnavailable)
        return
      }
      setPreview(data.image)
    } catch {
      if (revision === previewRevision.current) setMessage(d.previewUnavailable)
    } finally {
      running.current = false
      setPreviewing(false)
    }
  }
  function editTemplate(value: string) {
    previewRevision.current++
    setZpl(value)
    setPreview(null)
    setMessage('')
  }
  async function save() {
    const candidate = setLabelTemplateCommand.safeParse({
      action: 'setLabelTemplate',
      tenantId,
      requestId: crypto.randomUUID(),
      kind,
      name,
      zpl,
    })
    if (!candidate.success) {
      setInvalid(d.templateInvalid)
      return
    }
    const saved = await send('save', candidate.data, savedTemplate)
    if (saved && saved.kind === kind) {
      setConfirmed({ name, zpl })
      setMessage(d.templateSaved)
      router.refresh()
    } else if (saved) {
      // A version of another kind is not this editor's confirmation.
      setPending({ phase: 'uncertain', of: 'save' })
      setInvalid(d.templateUncertain)
    }
  }
  async function reset() {
    const candidate = resetLabelTemplateCommand.safeParse({
      action: 'resetLabelTemplate',
      tenantId,
      requestId: crypto.randomUUID(),
      kind,
    })
    if (!candidate.success) return
    const done = await send('reset', candidate.data, resetTemplate)
    if (done === true) {
      editTemplate('')
      setConfirmed({ name, zpl: '' })
      setMessage(d.templateReset)
      router.refresh()
    } else if (done === false) {
      // Confirmed: nothing was active any more, someone else already restored
      // the built-in layout. Show the store's state, not this page's memory.
      editTemplate('')
      setConfirmed({ name, zpl: '' })
      setMessage(d.templateBuiltinHint)
      router.refresh()
    }
  }
  return (
    <div className="intake-grid label-template-editor">
      <div>
        <p>
          {current
            ? `${d.templateCustom} · ${d.templateVersion} ${current.version} · ${current.name}`
            : d.templateBuiltinHint}
        </p>
        <div className="field">
          <label htmlFor={`template-name-${kind}`}>{d.templateName}</label>
          <input
            id={`template-name-${kind}`}
            value={name}
            maxLength={80}
            disabled={!canEdit || busy || frozen}
            onChange={(e) => {
              setName(e.target.value)
              setMessage('')
            }}
          />
        </div>
        <div className="field">
          <label htmlFor={`template-zpl-${kind}`}>{d.templateZpl}</label>
          <textarea
            id={`template-zpl-${kind}`}
            value={zpl}
            rows={14}
            spellCheck={false}
            disabled={!canEdit || busy || frozen}
            style={{ fontFamily: 'monospace', width: '100%' }}
            onChange={(e) => {
              editTemplate(e.target.value)
            }}
            placeholder={d.templatePlaceholder}
          />
        </div>
        <p>
          <small>
            {d.placeholdersHint}{' '}
            {/* A space between placeholders lets the list wrap on a phone. */}
            {placeholders.map((p) => (
              <span key={p}>
                <code>{`{${p}}`}</code>{' '}
              </span>
            ))}
          </small>
        </p>
        {/* Four actions must fit a 320px phone: wrap instead of pushing the page sideways. */}
        <div className="row wrap">
          <Button
            variant="secondary"
            disabled={!canEdit || previewing || busy || frozen}
            onClick={() => void previewNow()}
          >
            {previewing ? d.previewing : d.preview}
          </Button>
          {canEdit && (
            <>
              <Button
                variant="secondary"
                disabled={busy || frozen}
                onClick={() => {
                  if (
                    !busy &&
                    !frozen &&
                    (zpl === confirmed.zpl ||
                      zpl === builtin ||
                      window.confirm(d.discardTemplate))
                  )
                    editTemplate(builtin)
                }}
              >
                {d.copyBuiltin}
              </Button>
              <Button
                disabled={previewing || busy || frozen || !zpl.trim()}
                onClick={() => void save()}
              >
                {busy && pending.of === 'save' ? intake.busy : d.saveTemplate}
              </Button>
              {current && (
                <Button
                  variant="secondary"
                  disabled={previewing || busy || frozen}
                  onClick={() => void reset()}
                >
                  {busy && pending.of === 'reset' ? intake.busy : d.useBuiltin}
                </Button>
              )}
              {frozen && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => window.location.reload()}
                >
                  {intake.reload}
                </Button>
              )}
            </>
          )}
        </div>
        {invalid && <p role="alert">{invalid}</p>}
        {message && <p role="status">{message}</p>}
      </div>
      <div>
        <p>
          <small>{d.previewHint}</small>
        </p>
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt={d.preview}
            style={{ maxWidth: '100%', border: '1px solid #ccc' }}
          />
        ) : (
          <p>{d.noPreview}</p>
        )}
      </div>
    </div>
  )
}
