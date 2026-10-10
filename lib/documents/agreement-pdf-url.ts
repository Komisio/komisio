export function agreementPdfUrl({
  tenantId,
  agreementId,
  sellerId,
  textId,
  portal = false,
}: {
  tenantId: string
  agreementId: string
  sellerId?: string
  textId?: string
  portal?: boolean
}) {
  const query = new URLSearchParams({ tenant: tenantId, version: agreementId })
  if (sellerId) query.set('seller', sellerId)
  if (textId) query.set('text', textId)
  return `${portal ? '/api/seller/agreement/pdf' : '/api/agreements/pdf'}?${query}`
}
