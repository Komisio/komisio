import Link from 'next/link'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { platformContext } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { Brand } from '@/components/platform/brand'
import { AcceptInvite } from '@/components/platform/accept-invite'
import { Button } from '@/components/ui/button'
import { SignOut } from '@/components/platform/sign-out'
export default async function Invite({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  if (!/^[a-f0-9]{64}$/.test(token)) notFound()
  const ctx = await platformContext()
  const d = dictionary(
    ctx?.locale ?? (await cookies()).get('komisio-locale')?.value,
  )
  const next = encodeURIComponent(`/invite/${token}`)
  if (ctx?.mfaRequired) redirect(`/mfa?next=${next}`)
  return (
    <main className="onboarding">
      <Brand />
      <section className="card">
        <h1>{d.inviteAcceptTitle}</h1>
        <p>{d.inviteAcceptIntro}</p>
        {ctx ? (
          <>
            <p>
              {d.signedInAs} <strong>{ctx.user.email}</strong>
            </p>
            <AcceptInvite d={d} token={token} />
            <p>{d.inviteSwitchAccount}</p>
            <SignOut d={d} next={`/invite/${token}`} />
          </>
        ) : (
          <>
            <p>{d.inviteLogin}</p>
            <div className="row">
              <Button asChild>
                <Link href={`/login?next=${next}`}>{d.login}</Link>
              </Button>
              <Button variant="secondary" asChild>
                <Link href={`/register?next=${next}`}>{d.register}</Link>
              </Button>
            </div>
          </>
        )}
      </section>
    </main>
  )
}
