import { NextResponse } from 'next/server'
import { serverClient } from '@/lib/supabase/server'
import { boundedJson } from '@/lib/http/bounded-json'
import {
  executeHostSupport,
  hostSupportCommand,
} from '@/lib/engine/host-support'

export async function POST(request: Request) {
  const reply = (body: object, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return reply({ error: 'FORBIDDEN' }, 403)
  let input: unknown
  try {
    input = await boundedJson(request, 4096)
  } catch {
    return reply({ error: 'INVALID_INPUT' }, 400)
  }
  const command = hostSupportCommand.safeParse(input)
  if (!command.success) return reply({ error: 'INVALID_INPUT' }, 400)
  try {
    // The RPC checks real identity, MFA, host authority and session binding.
    return reply({
      support: await executeHostSupport(await serverClient(), command.data),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    const allowed = [
      'FORBIDDEN',
      'AUTH_REQUIRED',
      'INVALID_INPUT',
      'SUPPORT_ACTIVE',
      'SUPPORT_ENDED',
      'TENANT_NOT_FOUND',
    ]
    const code = allowed.includes(message) ? message : 'REQUEST_FAILED'
    return reply(
      { error: code },
      code === 'FORBIDDEN' || code === 'AUTH_REQUIRED' ? 403 : 409,
    )
  }
}
