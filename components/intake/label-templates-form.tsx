'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import type { Dictionary } from '@/lib/i18n'
import {
  resetLabelTemplateCommand,
  setLabelTemplateCommand,
  type LabelTemplates,
} from '@/lib/engine/printing'
import { placeholders } from '@/lib/labels/placeholders'
import { useIntakeAction } from './use-intake-action'

const kinds = ['bag', 'garment', 'item', 'markdown', 'onboarding'] as const
type Kind = (typeof kinds)[number]

/** The ZPL editor: one template per label kind, placeholders, preview with sample data, versions. */
export function LabelTemplatesForm({
  tenantId,
  templates,
  builtins,
  canEdit,
  dpi,
  d,
  intake,
}: {
  tenantId: string
  templates: LabelTemplates
  builtins: Record<Kind, string>
  canEdit: boolean
  dpi: 203 | 300 | 600
  d: Dictionary['printing']
  intake: Dictionary['intake']
}) {
  const [kind, setKind] = useState<Kind>('item')
  return (
    <div>
      <h3>{d.templatesHeading}</h3>
      <p>{d.templatesIntro}</p>
      <div className="field">
        <label htmlFor="template-kind">{d.formatKind}</label>
        <select
          id="template-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as Kind)}
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
      />
    </div>
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
}: {
  tenantId: string
  kind: Kind
  current: LabelTemplates[Kind]
  builtin: string
  canEdit: boolean
  dpi: 203 | 300 | 600
  d: Dictionary['printing']
  intake: Dictionary['intake']
}) {
  const action = useIntakeAction(intake)
  const router = useRouter()
  const running = useRef(false)
  const [name, setName] = useState(current?.name ?? d.templateDefaultName)
  const [zpl, setZpl] = useState(current?.zpl ?? '')
  const [preview, setPreview] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [message, setMessage] = useState('')
  const [invalid, setInvalid] = useState('')
  const errors = d.templateErrors as Record<string, string>
  async function previewNow() {
    if (running.current) return
    running.current = true
    setPreviewing(true)
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
      if (!r.ok || !data.image) {
        setPreview(null)
        setMessage(d.previewUnavailable)
        return
      }
      setPreview(data.image)
    } catch {
      setMessage(d.previewUnavailable)
    } finally {
      running.current = false
      setPreviewing(false)
    }
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
    setInvalid('')
    if (await action.run(candidate.data)) {
      setMessage(d.templateSaved)
      router.refresh()
    }
  }
  async function reset() {
    const candidate = resetLabelTemplateCommand.safeParse({
      action: 'resetLabelTemplate',
      tenantId,
      requestId: crypto.randomUUID(),
      kind,
    })
    if (candidate.success && (await action.run(candidate.data))) {
      setZpl('')
      setMessage(d.templateReset)
      router.refresh()
    }
  }
  return (
    <div className="intake-grid">
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
            disabled={!canEdit}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`template-zpl-${kind}`}>{d.templateZpl}</label>
          <textarea
            id={`template-zpl-${kind}`}
            value={zpl}
            rows={14}
            spellCheck={false}
            disabled={!canEdit}
            style={{ fontFamily: 'monospace', width: '100%' }}
            onChange={(e) => setZpl(e.target.value)}
            placeholder={d.templatePlaceholder}
          />
        </div>
        <p>
          <small>
            {d.placeholdersHint}{' '}
            {placeholders.map((p) => (
              <code key={p} style={{ marginRight: 6 }}>{`{${p}}`}</code>
            ))}
          </small>
        </p>
        <div className="row">
          <Button
            variant="secondary"
            disabled={previewing}
            onClick={() => void previewNow()}
          >
            {previewing ? d.previewing : d.preview}
          </Button>
          {canEdit && (
            <>
              <Button
                variant="secondary"
                disabled={action.busy}
                onClick={() => setZpl(builtin)}
              >
                {d.copyBuiltin}
              </Button>
              <Button
                disabled={action.busy || !zpl.trim()}
                onClick={() => void save()}
              >
                {action.busy ? intake.busy : d.saveTemplate}
              </Button>
              {current && (
                <Button
                  variant="secondary"
                  disabled={action.busy}
                  onClick={() => void reset()}
                >
                  {d.useBuiltin}
                </Button>
              )}
            </>
          )}
        </div>
        {(invalid || action.error) && (
          <p role="alert">
            {invalid || errors[action.error ?? ''] || action.error}
          </p>
        )}
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
