// Local Docker Auth hook: use only loopback Supabase and Mailpit transports.
import { createServer } from 'node:http'
import { handleAuthEmail } from '../../lib/platform/auth-email'
import { randomUUID } from 'node:crypto'
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321')
  throw new Error('Local Auth email fixture only')
const env = {
  ...process.env,
  KOMISIO_AUTH_EMAIL_HOOK_SECRET: `v1,whsec_${Buffer.alloc(32, 7).toString('base64')}`,
  RESEND_API_KEY: 'synthetic-mailpit-only',
  SELLER_EMAIL_FROM: 'Komisio <noreply@example.test>',
}
const transport: typeof fetch = async (input, init) => {
  if (String(input) === 'https://api.resend.com/emails') {
    const mail = JSON.parse(String(init?.body))
    if (mail.to.some((email: string) => !email.endsWith('@example.test')))
      throw new Error('Synthetic recipients only')
    const response = await fetch('http://127.0.0.1:54324/api/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        From: { Email: 'noreply@example.test', Name: 'Komisio' },
        To: mail.to.map((Email: string) => ({ Email })),
        Subject: mail.subject,
        Text: mail.text,
        HTML: mail.html,
      }),
    })
    return response.ok
      ? Response.json({ id: randomUUID() })
      : new Response('', { status: 500 })
  }
  if (new URL(String(input)).origin !== 'http://127.0.0.1:54321')
    throw new Error('Local Auth database only')
  return fetch(input, init)
}
createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200).end('ok')
    return
  }
  try {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > 262144) throw new Error('Too large')
      chunks.push(chunk)
    }
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers))
      if (typeof value === 'string') headers.set(key, value)
    const status = await handleAuthEmail(
      Buffer.concat(chunks).toString('utf8'),
      headers,
      env,
      transport,
    )
    res
      .writeHead(status, { 'Content-Type': 'application/json' })
      .end(
        status === 200
          ? '{}'
          : '{"error":{"http_code":400,"message":"Local email delivery failed"}}',
      )
  } catch {
    res.writeHead(400).end('{}')
  }
}).listen(3457, '0.0.0.0')
