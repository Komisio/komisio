import { handleAuthEmail } from '@/lib/platform/auth-email'
export const runtime = 'nodejs'
export async function POST(request: Request) {
  const reply = (status: number) =>
    Response.json(
      status === 200
        ? {}
        : {
            error: {
              http_code: status,
              message: 'Email delivery could not be completed',
            },
          },
      { status, headers: { 'Cache-Control': 'no-store' } },
    )
  try {
    const reader = request.body?.getReader()
    if (!reader) return reply(400)
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 262144) {
        await reader.cancel()
        return reply(413)
      }
      chunks.push(value)
    }
    return reply(
      await handleAuthEmail(
        Buffer.concat(chunks).toString('utf8'),
        request.headers,
      ),
    )
  } catch {
    return reply(400)
  }
}
