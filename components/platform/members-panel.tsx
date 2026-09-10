'use client'
import { useRef, useState, useEffect } from 'react'
import { UserPlus, X, Copy } from 'lucide-react'
import type { Dictionary, Locale } from '@/lib/i18n'
import {
  can,
  canChangeMember,
  roles,
  type Role,
} from '@/lib/platform/permissions'
import type { Tenant, Member, Invitation } from '@/lib/platform/types'
import { Button } from '@/components/ui/button'
import { useCommand } from './use-command'
import { Feedback } from './feedback'
export function MembersPanel({
  d,
  locale,
  tenant,
  members,
  invitations,
  userId,
}: {
  d: Dictionary
  locale: Locale
  tenant: Tenant
  members: Member[]
  invitations: Invitation[]
  userId: string
}) {
  const action = useCommand(d)
  const [inviteUrl, setInviteUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [change, setChange] = useState<{
    userId: string
    role: Role | null
  } | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (change) dialog.current?.showModal()
    else dialog.current?.close()
  }, [change])
  const manage = can(tenant.role, 'members.manage')
  async function invite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const result = await action.run({
      action: 'invite',
      tenantId: tenant.id,
      email: form.get('email'),
      role: form.get('role'),
    })
    if (result?.inviteUrl) {
      setInviteUrl(result.inviteUrl)
      setCopied(false)
    }
  }
  return (
    <div className="stack">
      {manage ? (
        <section className="card">
          <div className="row" style={{ marginBottom: 16 }}>
            <span className="feature-icon">
              <UserPlus size={20} />
            </span>
            <div>
              <h2 style={{ marginBottom: 3 }}>{d.inviteTitle}</h2>
              <p style={{ fontSize: 12, marginBottom: 0 }}>{d.inviteIntro}</p>
            </div>
          </div>
          <form onSubmit={invite} className="invite-grid">
            <div className="field">
              <label htmlFor="invite-email">{d.email}</label>
              <input
                name="email"
                id="invite-email"
                type="email"
                autoComplete="off"
                maxLength={254}
                required
                placeholder="namn@exempel.se"
              />
            </div>
            <div className="field">
              <label htmlFor="invite-role">{d.role}</label>
              <select id="invite-role" name="role" defaultValue="staff">
                {roles
                  .filter(
                    (r) =>
                      r !== 'owner' &&
                      (tenant.role === 'owner' || r !== 'admin'),
                  )
                  .map((r) => (
                    <option key={r} value={r}>
                      {d.roles[r]}
                    </option>
                  ))}
              </select>
            </div>
            <Button disabled={action.busy}>
              {d.invite}
              <UserPlus size={15} />
            </Button>
          </form>
          {inviteUrl && (
            <div className="notice notice-success">
              <strong>{d.inviteReady}</strong>
              <p style={{ margin: '6px 0 12px', color: 'inherit' }}>
                {d.inviteDelivery}
              </p>
              <input
                value={inviteUrl}
                readOnly
                aria-label={d.inviteReady}
                onFocus={(e) => e.target.select()}
              />
              <Button
                variant="ghost"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(inviteUrl)
                    setCopied(true)
                  } catch {
                    setCopied(false)
                  }
                }}
              >
                <Copy size={14} />
                {copied ? d.copied : d.copyLink}
              </Button>
            </div>
          )}
        </section>
      ) : (
        <p>{d.readOnlyMembers}</p>
      )}
      <Feedback error={action.error} success={action.success} />
      <section className="card table-card">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{d.name}</th>
                <th>{d.role}</th>
                <th className="joined">{d.joined}</th>
                {manage && (
                  <th>
                    <span className="sr-only">{d.changeRole}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.user_id}>
                  <td>
                    <div className="row">
                      <span className="avatar">
                        {member.display_name.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="person">
                        <strong style={{ fontWeight: 500 }}>
                          {member.display_name}
                          {member.user_id === userId ? ` (${d.you})` : ''}
                        </strong>
                        {member.email && <small>{member.email}</small>}
                      </span>
                    </div>
                  </td>
                  <td>
                    <span
                      className={`badge ${member.role === 'readonly' ? 'badge-neutral' : ''}`}
                    >
                      {d.roles[member.role]}
                    </span>
                  </td>
                  <td className="joined">
                    <small>
                      {new Date(member.created_at).toLocaleDateString(locale)}
                    </small>
                  </td>
                  {manage && (
                    <td>
                      <div className="table-actions">
                        {canChangeMember(tenant.role, member.role, 'staff') && (
                          <>
                            <select
                              aria-label={`${d.changeRole}: ${member.display_name}`}
                              value={member.role}
                              disabled={action.busy}
                              onChange={(e) =>
                                setChange({
                                  userId: member.user_id,
                                  role: e.target.value as Role,
                                })
                              }
                            >
                              {roles
                                .filter((r) =>
                                  canChangeMember(tenant.role, member.role, r),
                                )
                                .map((r) => (
                                  <option key={r} value={r}>
                                    {d.roles[r]}
                                  </option>
                                ))}
                            </select>
                            <Button
                              variant="ghost"
                              aria-label={`${d.remove}: ${member.display_name}`}
                              disabled={action.busy}
                              onClick={() =>
                                setChange({
                                  userId: member.user_id,
                                  role: null,
                                })
                              }
                            >
                              <X size={14} />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {manage && (
        <section className="card">
          <h2>{d.pendingInvites}</h2>
          {invitations.length === 0 ? (
            <div className="empty">{d.noInvites}</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{d.email}</th>
                    <th>{d.role}</th>
                    <th>{d.expires}</th>
                    <th>
                      <span className="sr-only">{d.revoke}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {invitations.map((invite) => (
                    <tr key={invite.id}>
                      <td>{invite.email}</td>
                      <td>
                        <span className="badge">{d.roles[invite.role]}</span>
                      </td>
                      <td>
                        <small>
                          {new Date(invite.expires_at).toLocaleDateString(
                            locale,
                          )}
                        </small>
                      </td>
                      <td>
                        {(tenant.role === 'owner' ||
                          invite.role !== 'admin') && (
                          <Button
                            variant="ghost"
                            disabled={action.busy}
                            onClick={() =>
                              action.run({
                                action: 'revoke',
                                tenantId: tenant.id,
                                invitationId: invite.id,
                              })
                            }
                          >
                            {d.revoke}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      <dialog
        ref={dialog}
        className="dialog-box"
        onCancel={() => setChange(null)}
        style={{ margin: 'auto', border: '1px solid var(--line)' }}
      >
        <h2>{change?.role === null ? d.remove : d.changeRole}</h2>
        <p>{change?.role === null ? d.removeConfirm : d.roleConfirm}</p>
        {change?.role && (
          <p>
            <span className="badge">{d.roles[change.role]}</span>
          </p>
        )}
        <div className="row">
          <Button variant="secondary" onClick={() => setChange(null)}>
            {d.cancel}
          </Button>
          <Button
            variant={change?.role === null ? 'danger' : 'primary'}
            disabled={action.busy}
            onClick={async () => {
              if (change) {
                await action.run({
                  action: 'member',
                  tenantId: tenant.id,
                  ...change,
                })
                setChange(null)
              }
            }}
          >
            {d.confirm}
          </Button>
        </div>
      </dialog>
    </div>
  )
}
