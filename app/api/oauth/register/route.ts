import {
  anonClient,
  connectorsEnabled,
  registerClient,
} from '@/lib/engine/connectors'
import { boundedJson } from '@/lib/http/bounded-json'
import { noStoreJson, publicPreflight } from '@/lib/http/public-json'

/** RFC 7591 dynamic registration: an assistant announces its name and redirect URIs; no secret is issued. */
export async function POST(request: Request) {
  if (!connectorsEnabled()) return noStoreJson({ error: 'not_found' }, 404)
  let input: unknown
  try {
    input = await boundedJson(request, 8192)
  } catch {
    return noStoreJson({ error: 'invalid_client_metadata' }, 400)
  }
  try {
    return noStoreJson(await registerClient(anonClient(), input), 201)
  } catch (e) {
    const code = e instanceof Error ? e.message : ''
    if (code === 'RATE_LIMITED')
      return noStoreJson({ error: 'temporarily_unavailable' }, 429)
    return noStoreJson(
      {
        error: 'invalid_client_metadata',
        error_description:
          'client_name (1-100 characters) and 1-10 https redirect_uris are required.',
      },
      400,
    )
  }
}
export async function OPTIONS() {
  return publicPreflight()
}
