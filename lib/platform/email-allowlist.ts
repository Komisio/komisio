/**
 * The outbound delivery gate for invitations and seller messages.
 *
 * During the pilot this was a list of exact operator-approved mailboxes, so a
 * test store could never mail a real person. Production is open to any store,
 * so a deployment sets `*` and every recipient the engine already authorised is
 * delivered to. This is not an access control: who may invite a colleague or
 * message a seller is decided in SQL (`create_invitation`,
 * `queue_seller_communication`), and the abuse boundary is the host's daily cap
 * per store, enforced in the same functions. An empty list still delivers
 * nothing, which keeps a misconfigured deployment silent rather than loud.
 */
export function allowsRecipient(
  list: string | undefined,
  email: string,
): boolean {
  const entries = (list ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
  if (entries.length === 0) return false
  if (entries.includes('*')) return true
  return entries.includes(email.trim().toLowerCase())
}
