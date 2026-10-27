import { requestLocale } from '@/lib/platform/request-locale'
import { redirect } from 'next/navigation'
import { serverClient } from '@/lib/supabase/server'
import { safeNext } from '@/lib/platform/validation'
import { AuthForm } from '@/components/auth/auth-form'
import { publicPageMetadata } from '@/lib/platform/page-metadata'

export default async function ConfirmEmail({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const destination = safeNext((await searchParams).next)
  const client = await serverClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (user?.email_confirmed_at)
    redirect(`/auth/landing?next=${encodeURIComponent(destination)}`)
  return (
    <AuthForm
      mode="confirm"
      initialEmail={user?.email}
      next={destination}
      initialLocale={await requestLocale()}
    />
  )
}
export const generateMetadata = () =>
  publicPageMetadata((d) => d.sellerAccess.confirmEmail)
