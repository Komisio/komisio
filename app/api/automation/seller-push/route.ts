import { handleSellerPushCron } from '@/lib/push/worker'

export const runtime = 'nodejs'
export const maxDuration = 240
export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  return handleSellerPushCron(request)
}
