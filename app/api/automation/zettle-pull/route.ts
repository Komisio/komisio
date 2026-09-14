import { handleZettleCron } from '@/lib/engine/zettle-automation'

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return handleZettleCron(request)
}
