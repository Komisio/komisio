import { notFound, redirect } from 'next/navigation'
import Link from '@/components/platform/working-link'
import { SellerHeader } from '@/components/seller/header'
import { SignOut } from '@/components/platform/sign-out'
import { RegistrationApplication } from '@/components/seller-registration/apply'
import { renderPlatformContext } from '@/lib/platform/context'
import { platformPageMetadata } from '@/lib/platform/page-metadata'
import { dictionary, intlLocale } from '@/lib/i18n'
import {
  registrationToken,
  readRegistrationEntry,
} from '@/lib/engine/seller-registration'
import '@/components/seller-registration/registration.css'
export const generateMetadata = () =>
  platformPageMetadata((d) => d.selfRegistration.applyTitle, {
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  })
export default async function JoinStore({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const { token } = await params
  if (!registrationToken.safeParse(token).success) notFound()
  const next = encodeURIComponent(`/join/${token}`)
  const ctx = await renderPlatformContext()
  if (!ctx) redirect(`/login?next=${next}`)
  if (ctx.mfaRequired) redirect(`/mfa?next=${next}`)
  const all = dictionary(ctx.locale),
    d = all.selfRegistration
  const entry = await readRegistrationEntry(ctx.client, token, ctx.locale)
  if (entry.state === 'existing') redirect(`/seller?seller=${entry.sellerId}`)
  return (
    <main
      className="onboarding registration-page"
      lang={intlLocale(ctx.locale)}
    >
      <SellerHeader locale={ctx.locale} />
      <SignOut d={all} next={`/join/${token}`} />
      <section className="card">
        <h1>{d.applyTitle}</h1>
        {entry.state === 'unavailable' ? (
          <p>{d.unavailable}</p>
        ) : (
          <>
            <h2>{entry.storeName}</h2>
            {entry.state === 'pending' ? (
              <>
                <h3>{d.pending}</h3>
                <p>{d.pendingHint}</p>
              </>
            ) : (
              <RegistrationApplication
                key={`${entry.agreement.id}-${entry.agreement.translationId ?? 'base'}`}
                entry={entry}
                token={token}
                d={d}
              />
            )}
          </>
        )}
        <p>
          <Link href="/seller">{d.portal}</Link>
        </p>
      </section>
    </main>
  )
}
