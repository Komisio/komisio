'use client'
import { useState } from 'react'
import Image from 'next/image'
import Link from '@/components/platform/working-link'
import { useRouter } from '@/components/platform/use-working-router'
import { useRegistrationCommand } from './use-registration-command'
import type { RegistrationSettings } from '@/lib/engine/seller-registration'
import type { Dictionary } from '@/lib/i18n'

export function RegistrationSettingsForm({
  tenantId,
  current,
  canEnable,
  url,
  qr,
  d,
}: {
  tenantId: string
  current: RegistrationSettings
  canEnable: boolean
  url: string | null
  qr: string | null
  d: Dictionary['selfRegistration']
}) {
  const command = useRegistrationCommand(d),
    router = useRouter()
  const [copied, setCopied] = useState(false)
  const [selected, setSelected] = useState<
    'enable' | 'disable' | 'rotate' | null
  >(null)
  async function change(action: 'enable' | 'disable' | 'rotate') {
    if (
      action === 'rotate' &&
      !command.uncertain &&
      !window.confirm(d.rotateConfirm)
    )
      return
    setSelected(action)
    if (
      await command.send({
        action: 'settings',
        tenantId,
        requestId: crypto.randomUUID(),
        expected: current.id,
        change: action,
      })
    )
      router.refresh()
  }
  return (
    <section className="card registration-settings">
      <h2>{current.enabled ? d.enabled : d.disabled}</h2>
      <p>{d.intro}</p>
      {!current.hasAgreement && (
        <p>
          <Link href="/settings#policy-section-agreements">
            {d.agreementRequired}
          </Link>
        </p>
      )}
      <div className="actions">
        {(canEnable || current.enabled) && (
          <button
            className="btn btn-secondary"
            disabled={
              command.busy ||
              command.done ||
              (!current.enabled && !current.hasAgreement) ||
              (command.uncertain && selected === 'rotate')
            }
            onClick={() => void change(current.enabled ? 'disable' : 'enable')}
          >
            {command.uncertain && selected !== 'rotate'
              ? d.retry
              : current.enabled
                ? d.disable
                : d.enable}
          </button>
        )}
        {current.enabled && (
          <button
            className="btn btn-secondary"
            disabled={
              command.busy ||
              command.done ||
              (command.uncertain && selected !== 'rotate')
            }
            onClick={() => void change('rotate')}
          >
            {command.uncertain && selected === 'rotate' ? d.retry : d.rotate}
          </button>
        )}
      </div>
      {command.error && <p role="alert">{command.error}</p>}
      {command.done && <p role="status">{d.saved}</p>}
      {current.enabled && url && qr && (
        <div className="registration-share">
          <div>
            <label htmlFor="registration-link">{d.link}</label>
            <input
              id="registration-link"
              value={url}
              readOnly
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              className="btn btn-secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url)
                  setCopied(true)
                } catch {
                  setCopied(false)
                }
              }}
            >
              {d.copy}
            </button>
            <p role="status">{copied ? d.copied : ''}</p>
          </div>
          <Image src={qr} width={240} height={240} alt={d.qr} unoptimized />
        </div>
      )}
      <Link href="/intake/sellers/registrations">{d.queue}</Link>
    </section>
  )
}
