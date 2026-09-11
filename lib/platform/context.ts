import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { resolveLocale } from '@/lib/i18n'
import { serverClient } from '@/lib/supabase/server'
import type { Tenant } from './types'
import type { Role } from './permissions'
export async function platformContext() {
  const client = await serverClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) return null
  const { data: assurance } =
    await client.auth.mfa.getAuthenticatorAssuranceLevel()
  const mfaRequired =
    assurance?.nextLevel === 'aal2' && assurance.currentLevel !== 'aal2'
  const [memberships, profile] = await Promise.all([
    client
      .from('tenant_members')
      .select('tenant_id,role,tenants(id,name,slug)')
      .eq('user_id', user.id),
    client
      .from('user_profiles')
      .select('display_name,locale,active_tenant_id')
      .eq('user_id', user.id)
      .maybeSingle(),
  ])
  if (memberships.error || profile.error) {
    console.error('Platform context query failed', {
      membership: memberships.error?.message,
      profile: profile.error?.message,
    })
    throw new Error('Unable to load platform context')
  }
  const tenants: Tenant[] = (memberships.data ?? []).flatMap((row) => {
    const tenant = Array.isArray(row.tenants) ? row.tenants[0] : row.tenants
    return tenant ? [{ ...tenant, role: row.role as Role }] : []
  })
  const active =
    tenants.find((t) => t.id === profile.data?.active_tenant_id) ??
    tenants[0] ??
    null
  return {
    client,
    user,
    tenants,
    active,
    mfaRequired,
    profile: profile.data,
    locale: resolveLocale(
      (await cookies()).get('komisio-locale')?.value,
      profile.data?.locale,
    ),
  }
}
export async function requirePlatform(tenantRequired = true) {
  const context = await platformContext()
  if (!context) redirect('/login')
  if (context.mfaRequired) redirect('/mfa')
  if (tenantRequired && !context.active) redirect('/onboarding')
  return context
}
