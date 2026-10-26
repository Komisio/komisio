import { redirect } from 'next/navigation'
import { platformContext } from '@/lib/platform/context'
import { AuthForm } from '@/components/auth/auth-form'
import { safeNext } from '@/lib/platform/validation'
import { publicPageMetadata } from '@/lib/platform/page-metadata'

export default async function UpdatePassword({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const destination = safeNext((await searchParams).next)
  const ctx = await platformContext()
  if (!ctx) redirect(`/reset-password?next=${encodeURIComponent(destination)}`)
  if (!ctx.user.email_confirmed_at)
    redirect(`/confirm-email?next=${encodeURIComponent(destination)}`)
  if (ctx.mfaRequired)
    redirect(
      `/mfa?next=${encodeURIComponent(`/update-password?next=${encodeURIComponent(destination)}`)}`,
    )
  return (
    <AuthForm mode="password" initialLocale={ctx.locale} next={destination} />
  )
}
export const generateMetadata = () =>
  publicPageMetadata((d) => d.sellerAccess.choosePassword)
