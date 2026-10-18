import { NextResponse } from 'next/server'
import { serverClient } from '@/lib/supabase/server'
import { unsubscribeCommand } from '@/lib/engine/store-mail'

export async function POST(request: Request) {
  const reply = (ok: boolean, status = 200) =>
    NextResponse.json(
      { ok },
      {
        status,
        headers: {
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        },
      },
    )
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return reply(false, 403)
  try {
    const text = await request.text()
    if (text.length > 512) return reply(false, 413)
    const c = unsubscribeCommand.parse(JSON.parse(text))
    const client = await serverClient()
    const r = await client.rpc('unsubscribe_store_mail', {
      p_message: c.messageId,
      p_token: c.token,
    })
    return reply(!r.error && r.data === true)
  } catch {
    return reply(false, 400)
  }
}
