import { redirect } from 'next/navigation'
import { platformContext, isSellerOnly } from '@/lib/platform/context'
import { safeNext } from '@/lib/platform/validation'

export default async function Landing({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const destination = safeNext((await searchParams).next)
  const ctx = await platformContext()
  if (!ctx) redirect(`/login?next=${encodeURIComponent(destination)}`)
  if (!ctx.user.email_confirmed_at)
    redirect(`/confirm-email?next=${encodeURIComponent(destination)}`)
  if (ctx.mfaRequired) redirect(`/mfa?next=${encodeURIComponent(destination)}`)
  if (ctx.user.app_metadata.komisio_password_recovery_pending === true)
    redirect(
      destination.startsWith('/update-password')
        ? destination
        : `/update-password?next=${encodeURIComponent(destination)}`,
    )
  if (
    (destination === '/' || destination === '/account') &&
    (await isSellerOnly(ctx))
  )
    redirect('/seller')
  redirect(destination)
}
