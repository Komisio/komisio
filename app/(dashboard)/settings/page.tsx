import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { can } from '@/lib/platform/permissions'
import { TenantForm } from '@/components/platform/tenant-form'
export default async function Settings() {
  const ctx = await requirePlatform()
  const d = dictionary(ctx.locale)
  const active = ctx.active!
  const events = can(active.role, 'audit.read')
    ? await ctx.client
        .from('access_events')
        .select('id,action,occurred_at')
        .eq('tenant_id', active.id)
        .order('occurred_at', { ascending: false })
        .limit(12)
    : { data: [], error: null }
  if (events.error) throw events.error
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">{active.name}</div>
        <h1>{d.tenant}</h1>
        <p>{d.tenantIntro}</p>
      </div>
      <div className="settings-grid">
        <section className="card">
          <h2>{d.tenantIdentity}</h2>
          {can(active.role, 'tenant.edit') ? (
            <TenantForm d={d} tenant={active} />
          ) : (
            <p>{active.name}</p>
          )}
          <hr className="divider" />
          <div className="read-details">
            <label>{d.slug}</label>
            <p>{active.slug}</p>
            <label>{d.tenantId}</label>
            <p>{active.id}</p>
            <small>{d.tenantImmutable}</small>
          </div>
        </section>
        {can(active.role, 'audit.read') && (
          <section className="card">
            <h2>{d.audit}</h2>
            {events.data?.map((e) => (
              <div key={e.id} className="audit-row">
                <span>
                  {d.events[e.action as keyof typeof d.events] ?? e.action}
                </span>
                <small>
                  {new Date(e.occurred_at).toLocaleDateString(ctx.locale)}
                </small>
              </div>
            ))}
            {!events.data?.length && <p>{d.noAudit}</p>}
          </section>
        )}
      </div>
    </>
  )
}
