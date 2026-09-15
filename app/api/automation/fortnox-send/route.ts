import { handleFortnoxCron } from '@/lib/engine/fortnox-automation'

export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return handleFortnoxCron(request)
}
