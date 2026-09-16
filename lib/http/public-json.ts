import { NextResponse } from 'next/server'

// Responses for the public OAuth endpoints: no cookies are involved, so any
// origin may read them; token responses are never cached.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, MCP-Protocol-Version',
}
export function publicJson(
  body: object,
  status = 200,
  cache = 'public, max-age=300',
) {
  return NextResponse.json(body, {
    status,
    headers: { ...cors, 'Cache-Control': cache },
  })
}
export function noStoreJson(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { ...cors, 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  })
}
export function publicPreflight() {
  return new NextResponse(null, { status: 204, headers: cors })
}
/** A bounded form body as a plain object. */
export async function boundedForm(request: Request, limit = 8192) {
  const text = await request.text()
  if (text.length > limit) throw new Error('INVALID_INPUT')
  return Object.fromEntries(new URLSearchParams(text))
}
