import { redirect } from 'next/navigation'
import { platformContext } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { HostSupportBanner } from '@/components/platform/host-support-banner'

export default async function SupportRecovery() {
  const context = await platformContext()
  if (!context) redirect('/login')
  if (!context.user.email_confirmed_at) redirect('/confirm-email')
  if (context.user.app_metadata.komisio_password_recovery_pending === true)
    redirect('/update-password')
  if (context.mfaRequired) redirect('/mfa')
  if (!context.support) redirect('/host')
  return (
    <main className="onboarding">
      <HostSupportBanner
        support={context.support}
        d={dictionary(context.locale).hostSupport}
        locale={context.locale}
        watchExpiry={false}
      />
    </main>
  )
}
