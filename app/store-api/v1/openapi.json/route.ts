import { storeOpenApi } from '@/lib/engine/store-api-openapi'
export const dynamic = 'force-static'
export function GET() {
  return Response.json(storeOpenApi())
}
