import { handleDayCloseCron } from '@/lib/engine/day-close-automation'

export const runtime = 'nodejs'
export const maxDuration = 240
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return handleDayCloseCron(request)
}
