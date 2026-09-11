'use client'
import Link from 'next/link'
import type { Dictionary } from '@/lib/i18n'
import { useCommand } from './use-command'
import { Button } from '@/components/ui/button'
import { Feedback } from './feedback'
export function AcceptInvite({ d, token }: { d: Dictionary; token: string }) {
  const action = useCommand(d)
  return (
    <>
      <Button
        disabled={action.busy}
        onClick={async () => {
          if (await action.run({ action: 'accept', token })) {
            action.router.push('/')
            action.router.refresh()
          }
        }}
      >
        {d.acceptInvite}
      </Button>
      <Feedback error={action.error} />
      {action.error && (
        <div>
          <p>{d.inviteRecovery}</p>
          <Link href="/" className="text-link">
            {d.home}
          </Link>
        </div>
      )}
    </>
  )
}
