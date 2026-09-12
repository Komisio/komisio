import Link from 'next/link'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { platformContext } from '@/lib/platform/context'
import { readSellerReview } from '@/lib/engine/seller-review'
import { dictionary } from '@/lib/i18n'
import { Brand } from '@/components/platform/brand'
import { Button } from '@/components/ui/button'
import { SignOut } from '@/components/platform/sign-out'
import { SellerResponse } from '@/components/reception/seller-response'
export const metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
}
export default async function Review({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  if (
    process.env.KOMISIO_INTAKE_ENABLED !== 'true' ||
    !/^[a-f0-9]{64}$/.test(token)
  )
    notFound()
  const ctx = await platformContext()
  const d = dictionary(
    ctx?.locale ?? (await cookies()).get('komisio-locale')?.value,
  )
  const path = `/review/${token}`,
    next = encodeURIComponent(path)
  if (ctx?.mfaRequired) redirect(`/mfa?next=${next}`)
  const review = ctx ? await readSellerReview(ctx.client, token) : null
  const labels: Record<string, string> = {
    description: d.reviewDescription,
    category: d.reviewCategory,
    color: d.reviewColor,
    brand: d.reviewBrand,
    size: d.reviewSize,
    material: d.reviewMaterial,
    condition: d.reviewCondition,
  }
  return (
    <main className="onboarding seller-review">
      <Brand />
      <section className="card">
        <h1>{d.reviewTitle}</h1>
        {!ctx ? (
          <>
            <p>{d.reviewLogin}</p>
            <div className="row">
              <Button asChild>
                <Link href={`/login?next=${next}`}>{d.login}</Link>
              </Button>
              <Button variant="secondary" asChild>
                <Link href={`/register?next=${next}`}>{d.register}</Link>
              </Button>
            </div>
          </>
        ) : (
          <>
            <p>
              {d.signedInAs} <strong>{ctx.user.email}</strong>
            </p>
            {!review ? (
              <p role="status">{d.reviewUnavailable}</p>
            ) : (
              <>
                <h2>{review.storeName}</h2>
                <p>
                  {d.reviewVersion} {review.version}
                </p>
                <dl>
                  {Object.entries(review.metadata).map(([key, value]) => (
                    <div key={key}>
                      <dt>{labels[key] ?? key}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                <h2>
                  {d.reviewPrice}: {review.price.amount} SEK
                </h2>
                <p>{d.reviewPriceNotice}</p>
                <p>{review.price.rationale}</p>
                <h2>{review.terms.title}</h2>
                <div
                  lang={review.terms.language}
                  style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                >
                  {review.terms.body}
                </div>
                <p>
                  {d.reviewExpires}{' '}
                  {new Date(review.expiresAt).toLocaleString(
                    ctx.locale === 'sv' ? 'sv-SE' : 'en-GB',
                    { timeZone: 'Europe/Stockholm' },
                  )}{' '}
                  (Europe/Stockholm)
                </p>
                {review.response ? (
                  <p role="status">
                    {review.response.decision === 'approve'
                      ? d.reviewApproved
                      : d.reviewDeclined}
                  </p>
                ) : (
                  <SellerResponse
                    token={token}
                    reviewId={review.reviewId}
                    d={d}
                  />
                )}
              </>
            )}
            <p>{d.inviteSwitchAccount}</p>
            <SignOut d={d} next={path} />
          </>
        )}
      </section>
    </main>
  )
}
