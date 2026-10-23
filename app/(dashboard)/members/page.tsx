import { platformPageMetadata } from '@/lib/platform/page-metadata'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { can } from '@/lib/platform/permissions'
import type { Member, Invitation } from '@/lib/platform/types'
import { MembersPanel } from '@/components/platform/members-panel'
import { resolveSellerEmailLocale } from '@/lib/communications/locale'
export default async function Members() {
  const ctx = await requirePlatform()
  const d = dictionary(ctx.locale)
  const active = ctx.active!
  const { data: members, error } = await ctx.client.rpc('list_members', {
    p_tenant: active.id,
  })
  if (error) throw error
  const invites = can(active.role, 'members.manage')
    ? await ctx.client
        .from('tenant_invitations')
        .select('id,email,role,status,expires_at')
        .eq('tenant_id', active.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
    : { data: [], error: null }
  if (invites.error) throw invites.error
  const invitationLocale = can(active.role, 'members.manage')
    ? await resolveSellerEmailLocale(ctx.client, active.id)
    : 'en'
  return (
    <>
      <div className="page-heading">
        <h1>{d.members}</h1>
        <p>{d.membersIntro}</p>
      </div>
      <MembersPanel
        d={d}
        locale={ctx.locale}
        invitationLocale={invitationLocale}
        tenant={active}
        members={members as Member[]}
        invitations={invites.data as Invitation[]}
        userId={ctx.user.id}
      />
    </>
  )
}

export const generateMetadata = () => platformPageMetadata((d) => d.members)
