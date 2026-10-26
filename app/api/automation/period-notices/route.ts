import { handlePeriodNoticeCron } from '@/lib/engine/period-notices'

export const runtime = 'nodejs'
export const maxDuration = 240
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return handlePeriodNoticeCron(request)
}
