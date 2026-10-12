import { handleCatalogCron } from '@/lib/engine/catalog-worker'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300
export async function GET(request: Request) {
  return handleCatalogCron(request)
}
