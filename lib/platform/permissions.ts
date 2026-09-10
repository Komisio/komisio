export const roles = ['owner', 'admin', 'staff', 'readonly'] as const
export type Role = (typeof roles)[number]
export type Capability =
  'tenant.edit' | 'members.manage' | 'owners.manage' | 'audit.read'
const grants: Record<Role, readonly Capability[]> = {
  owner: ['tenant.edit', 'members.manage', 'owners.manage', 'audit.read'],
  admin: ['tenant.edit', 'members.manage', 'audit.read'],
  staff: [],
  readonly: [],
}
export function can(role: Role | null, capability: Capability) {
  return role !== null && grants[role]?.includes(capability) === true
}
export function canChangeMember(actor: Role, target: Role, next: Role | null) {
  return (
    actor === 'owner' ||
    (actor === 'admin' &&
      !['owner', 'admin'].includes(target) &&
      (next === null || !['owner', 'admin'].includes(next)))
  )
}
