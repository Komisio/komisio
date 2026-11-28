import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
export async function GET(
  _request: Request,
  context: { params: Promise<{ asset: string }> },
) {
  const { asset } = await context.params
  if (asset !== 'swagger-ui-bundle.js' && asset !== 'swagger-ui.css')
    return new Response(null, { status: 404 })
  const content = await readFile(
    join(process.cwd(), 'node_modules', 'swagger-ui-dist', asset),
  )
  return new Response(new Uint8Array(content), {
    headers: {
      'Content-Type': asset.endsWith('.js') ? 'text/javascript' : 'text/css',
    },
  })
}
