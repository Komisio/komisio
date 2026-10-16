'use client'
import { useState, useSyncExternalStore } from 'react'
import type { Dictionary } from '@/lib/i18n'
import { useCommand } from './use-command'
import { Feedback } from './feedback'
import { Button } from '@/components/ui/button'
import { MarketingConsentField } from './marketing-consent-field'
const subscribe = () => () => {}
const clientReady = () => true
const serverReady = () => false

export function MarketingConsentForm({
  d,
  consented,
  enabled,
}: {
  d: Dictionary
  consented: boolean
  enabled: boolean
}) {
  const action = useCommand(d)
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady)
  const [edited, setEdited] = useState(false)
  return (
    <form
      method="post"
      onChange={() => setEdited(true)}
      onSubmit={async (event) => {
        event.preventDefault()
        if (!ready || action.busy) return
        setEdited(false)
        const fields = new FormData(event.currentTarget)
        await action.run({
          action: 'marketingConsent',
          consented: enabled ? fields.get('marketingConsent') === 'on' : false,
        })
      }}
    >
      {enabled ? (
        <MarketingConsentField
          d={d}
          defaultChecked={consented}
          disabled={!ready || action.busy}
        />
      ) : (
        <p>{d.marketingConsentDisabled}</p>
      )}
      <Button disabled={!ready || action.busy}>
        {enabled ? d.marketingConsentSave : d.marketingConsentWithdraw}
      </Button>
      <Feedback error={action.error} success={edited ? '' : action.success} />
    </form>
  )
}
