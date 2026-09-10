import type { Role } from './permissions'
export type Tenant = { id: string; name: string; slug: string; role: Role }
export type Member = {
  user_id: string
  display_name: string
  email: string | null
  role: Role
  created_at: string
}
export type Invitation = {
  id: string
  email: string
  role: Exclude<Role, 'owner'>
  status: string
  expires_at: string
}
