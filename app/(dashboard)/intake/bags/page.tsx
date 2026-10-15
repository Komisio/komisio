import { notFound, redirect } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'

/** Old draft-only links no longer have a source to resolve. */
export default async function BagLocation() {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  await requirePlatform()
  redirect('/intake')
}
