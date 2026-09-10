import { redirect } from 'next/navigation'
import { serverClient } from '@/lib/supabase/server'
import { dictionary } from '@/lib/i18n'
import { MfaForm } from '@/components/auth/mfa-form'
import { Brand } from '@/components/platform/brand'
export default async function Mfa({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const client = await serverClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) redirect('/login')
  const { data } = await client.auth.mfa.listFactors()
  const factor = data?.totp.find((f) => f.status === 'verified')
  if (!factor) redirect('/')
  const d = dictionary()
  return (
    <main className="onboarding">
      <Brand />
      <section className="card">
        <h1>{d.mfaLogin}</h1>
        <MfaForm d={d} factorId={factor.id} next={(await searchParams).next} />
      </section>
    </main>
  )
}
