import { redirect } from 'next/navigation'
import Link from 'next/link'
import { platformContext } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { Brand } from '@/components/platform/brand'
import { PasswordForm } from '@/components/platform/account-form'
import { publicPageMetadata } from '@/lib/platform/page-metadata'

export default async function SellerPassword() {
  const ctx = await platformContext()
  if (!ctx || !ctx.user.email_confirmed_at)
    redirect('/login?next=/seller/activate')
  if (ctx.mfaRequired) redirect('/mfa?next=/seller/activate')
  const d = dictionary(ctx.locale)
  return (
    <main className="onboarding">
      <Brand />
      <section className="card">
        <h1>{d.sellerActivation.passwordTitle}</h1>
        <p>{ctx.user.email}</p>
        <PasswordForm d={d} />
        <p>
          <Link className="text-link" href="/seller">
            {d.sellerActivation.continue}
          </Link>
        </p>
      </section>
    </main>
  )
}
export const generateMetadata = () =>
  publicPageMetadata((d) => d.sellerActivation.passwordTitle)
