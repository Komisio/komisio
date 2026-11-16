import {
  handleDeletion,
  handleDeletionCommand,
} from '@/lib/engine/account-deletion'
import { boundedJson } from '@/lib/http/bounded-json'
import { serverClient } from '@/lib/supabase/server'
import {
  deletionFailure,
  deletionHeaders,
} from '@/lib/platform/account-deletion-http'
import { MobileRequestError } from '@/lib/platform/mobile-seller'
export async function POST(request: Request) {
  try {
    const origin = process.env.NEXT_PUBLIC_APP_URL
    if (!origin || request.headers.get('origin') !== new URL(origin).origin)
      throw new MobileRequestError('FORBIDDEN', 403)
    let input: unknown
    try {
      input = await boundedJson(request, 8192)
    } catch {
      throw new MobileRequestError('INVALID_INPUT', 400)
    }
    const command = handleDeletionCommand.safeParse(input)
    if (!command.success) throw new MobileRequestError('INVALID_INPUT', 400)
    const client = await serverClient()
    const { data, error } = await client.auth.getUser()
    if (error || !data.user) throw new MobileRequestError('AUTH_REQUIRED', 401)
    return Response.json(await handleDeletion(client, command.data), {
      headers: deletionHeaders(),
    })
  } catch (error) {
    return deletionFailure(error)
  }
}
