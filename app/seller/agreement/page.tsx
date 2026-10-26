import { notFound, redirect } from 'next/navigation'
/** Preserve old bookmarks while approval and history live in the Agreement tab. */
export default async function SellerAgreementPage({
  searchParams,
}: {
  searchParams: Promise<{
    seller?: string
    version?: string
    page?: string
    text?: string
  }>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const p = await searchParams,
    q = new URLSearchParams()
  if (!p.seller) notFound()
  q.set('seller', p.seller)
  if (p.version) q.set('agreementVersion', p.version)
  if (p.page) q.set('agreementPage', p.page)
  if (p.text) q.set('agreementText', p.text)
  redirect('/seller?' + q + '#seller-workspace-agreement')
}
