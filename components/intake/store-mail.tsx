'use client'
import { useEffect, useRef, useState } from 'react'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'
import { useBusyState } from '@/components/platform/work-activity'
import { type Dictionary, type Locale, intlLocale } from '@/lib/i18n'
import {
  mailHistory,
  mailPreview,
  type MailPreview,
  type MailHistory,
} from '@/lib/engine/store-mail'
import { EventTime } from '@/components/ui/event-time'

export function StoreMail({
  tenantId,
  initialHistory,
  d,
  locale,
}: {
  tenantId: string
  initialHistory: MailHistory
  d: Dictionary
  locale: Locale
}) {
  const t = d.storeMail
  const [subject, setSubject] = useState(''),
    [body, setBody] = useState('')
  const [preview, setPreview] = useState<MailPreview | null>(null)
  const [history, setHistory] = useState(initialHistory)
  const [busy, setBusy] = useBusyState(false),
    [message, setMessage] = useState('')
  const running = useRef(false),
    requestId = useRef(''),
    mounted = useRef(true)
  const [submitted, setSubmitted] = useState(false)
  useUnsavedChanges(subject || body || busy ? d.leaveUnsaved : null)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const number = (n: number) => n.toLocaleString(intlLocale(locale))
  function errorText(code: string) {
    if (
      ['AUDIENCE_CHANGED', 'CONSENT_CHANGED', 'REQUEST_CONFLICT'].includes(code)
    )
      return t.changed
    if (code === 'EMAIL_DAILY_CAP') return t.cap
    if (code === 'STORE_EMAIL_MISSING') return t.missingReply
    if (code === 'NO_RECIPIENTS') return t.none
    return t.error
  }
  async function post(data: object) {
    const r = await fetch('/api/store-mail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, tenantId }),
    })
    const result = await r.json()
    if (!r.ok) throw new Error(result.error ?? 'REQUEST_FAILED')
    return result
  }
  async function work(run: () => Promise<void>) {
    if (running.current) return
    running.current = true
    setBusy(true)
    setMessage('')
    try {
      await run()
    } catch (e) {
      setMessage(errorText(e instanceof Error ? e.message : ''))
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  async function process(sendId: string) {
    setMessage(t.progress)
    while (mounted.current) {
      const result = await post({ action: 'process', sendId })
      if (result.history) setHistory(mailHistory.parse(result.history))
      if (result.done || result.stop) {
        setMessage(result.done ? t.done : t.paused)
        break
      }
      // Long provider cooldowns remain resumable rather than locking the page.
      if (result.waitMs > 10000) {
        setMessage(t.paused)
        break
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(1000, result.waitMs ?? 1000)),
      )
    }
  }
  return (
    <div className="store-mail-workspace">
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault()
          void work(async () => {
            if (!preview) {
              if (!subject.trim() || !body.trim()) {
                setMessage(t.error)
                return
              }
              const r = await post({ action: 'preview' })
              setPreview(mailPreview.parse(r.data))
              requestId.current = crypto.randomUUID()
              return
            }
            setSubmitted(true)
            const r = await post({
              action: 'create',
              requestId: requestId.current,
              subject,
              body,
              revision: preview.revision,
            })
            const id = String(r.data)
            setPreview(null)
            setSubject('')
            setBody('')
            setSubmitted(false)
            await process(id)
          })
        }}
      >
        <p>{t.intro}</p>
        {!preview ? (
          <fieldset disabled={busy} className="store-mail-fields">
            <div className="field">
              <label htmlFor="mail-subject">{t.subject}</label>
              <input
                id="mail-subject"
                required
                maxLength={200}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="mail-body">{t.body}</label>
              <textarea
                id="mail-body"
                rows={10}
                required
                maxLength={7000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
          </fieldset>
        ) : (
          <section aria-label={t.preview}>
            <h2>{subject}</h2>
            <p className="store-mail-body">{body}</p>
            <p>{t.reviewHint}</p>
            <dl className="store-mail-counts">
              <div>
                <dt>{t.recipients}</dt>
                <dd>{number(preview.eligible)}</dd>
              </div>
              <div>
                <dt>{t.ownCount}</dt>
                <dd>{number(preview.own)}</dd>
              </div>
              <div>
                <dt>{t.automaticCount}</dt>
                <dd>{number(preview.automatic)}</dd>
              </div>
              <div>
                <dt>{t.missingEmail}</dt>
                <dd>{number(preview.missingEmail)}</dd>
              </div>
              <div>
                <dt>{t.withoutConsent}</dt>
                <dd>{number(preview.withoutConsent)}</dd>
              </div>
            </dl>
            <p>
              {t.sender}: {preview.senderName}
              <br />
              {t.replyTo}: {preview.replyTo || t.missingReply}
            </p>
            {!preview.eligible && <p>{t.none}</p>}
          </section>
        )}
        <div className="row">
          <button
            className="btn btn-primary"
            disabled={
              busy || (!!preview && (!preview.eligible || !preview.replyTo))
            }
          >
            {preview ? t.send : t.preview}
          </button>
          {preview && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy || submitted}
              onClick={() => setPreview(null)}
            >
              {t.edit}
            </button>
          )}
        </div>
      </form>
      <p role="status" aria-live="polite">
        {message}
      </p>
      <section className="card" aria-label={t.history}>
        <h2>{t.history}</h2>
        <p>
          <small>{t.recent}</small>
        </p>
        {history.map((send) => (
          <details key={send.id} className="store-mail-entry">
            <summary>
              {send.subject} ·{' '}
              <EventTime value={send.createdAt} locale={locale} />
            </summary>
            <p className="store-mail-body">{send.body}</p>
            <p>
              {t.sentBy}: {send.createdBy}
              <br />
              {t.sender}: {send.senderName}
              <br />
              {t.replyTo}: {send.replyTo}
            </p>
            <dl className="store-mail-counts">
              <div>
                <dt>{t.recipients}</dt>
                <dd>{number(send.total)}</dd>
              </div>
              <div>
                <dt>{t.ownCount}</dt>
                <dd>{number(send.own)}</dd>
              </div>
              <div>
                <dt>{t.automaticCount}</dt>
                <dd>{number(send.automatic)}</dd>
              </div>
              <div>
                <dt>{t.remaining}</dt>
                <dd>{number(send.remaining)}</dd>
              </div>
              {Object.entries(send.outcomes).map(([status, count]) => (
                <div key={status}>
                  <dt>
                    {
                      d.communications.outcomes[
                        status as keyof typeof d.communications.outcomes
                      ]
                    }
                  </dt>
                  <dd>{number(count)}</dd>
                </div>
              ))}
              <div>
                <dt>{t.skipped}</dt>
                <dd>{number(send.skipped)}</dd>
              </div>
              <div>
                <dt>{t.missingEmail}</dt>
                <dd>{number(send.missingEmail)}</dd>
              </div>
              <div>
                <dt>{t.withoutConsent}</dt>
                <dd>{number(send.withoutConsent)}</dd>
              </div>
            </dl>
            {send.remaining > 0 && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void work(() => process(send.id))}
              >
                {t.resume}
              </button>
            )}
          </details>
        ))}
      </section>
    </div>
  )
}
