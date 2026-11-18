import { handleCentralGuaranteeCron } from '@/lib/engine/central-guarantee-automation'

export const runtime = 'nodejs'
export const maxDuration = 240
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return handleCentralGuaranteeCron(request)
}
