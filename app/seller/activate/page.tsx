import { redirect } from 'next/navigation'
import Link from 'next/link'
import { platformContext } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { Brand } from '@/components/platform/brand'
import { PasswordForm } from '@/components/platform/account-form'
import { publicPageMetadata } from '@/lib/platform/page-metadata'
import { Feedback } from '@/components/platform/feedback'
import { Button } from '@/components/ui/button'

export default async function SellerPassword() {
  const ctx = await platformContext()
  if (!ctx || !ctx.user.email_confirmed_at)
    redirect('/login?next=/seller/activate')
  if (ctx.mfaRequired) redirect('/mfa?next=/seller/activate')
  const d = dictionary(ctx.locale)
  const { data: hasPassword, error } = await ctx.client.rpc(
    'current_user_has_password',
  )
  const unavailable = Boolean(error) || typeof hasPassword !== 'boolean'
  return (
    <main className="onboarding">
      <Brand href="/seller" />
      <section className="card">
        <h1>
          {unavailable
            ? d.sellerActivation.title
            : hasPassword
              ? d.sellerActivation.alreadyActive
              : d.sellerActivation.passwordTitle}
        </h1>
        <p>{ctx.user.email}</p>
        {unavailable ? (
          <Feedback error={d.authError} />
        ) : hasPassword ? (
          <p>{d.sellerActivation.keepPassword}</p>
        ) : (
          <PasswordForm d={d} />
        )}
        <p>
          <Button asChild>
            <Link href="/seller">{d.sellerActivation.continue}</Link>
          </Button>
        </p>
      </section>
    </main>
  )
}
export const generateMetadata = () =>
  publicPageMetadata((d) => d.sellerActivation.title)
