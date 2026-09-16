import {
  anonClient,
  connectorsEnabled,
  issueTokens,
} from '@/lib/engine/connectors'
import {
  boundedForm,
  noStoreJson,
  publicPreflight,
} from '@/lib/http/public-json'

/** RFC 6749 token endpoint for public clients: authorization code with PKCE, and refresh with rotation. */
export async function POST(request: Request) {
  if (!connectorsEnabled()) return noStoreJson({ error: 'not_found' }, 404)
  let input: Record<string, string>
  try {
    input = await boundedForm(request)
  } catch {
    return noStoreJson({ error: 'invalid_request' }, 400)
  }
  if (
    input.grant_type !== 'authorization_code' &&
    input.grant_type !== 'refresh_token'
  )
    return noStoreJson({ error: 'unsupported_grant_type' }, 400)
  try {
    return noStoreJson(await issueTokens(anonClient(), input))
  } catch (e) {
    const code = e instanceof Error ? e.message : ''
    if (code === 'PLAN_PLUS_REQUIRED')
      return noStoreJson(
        { error: 'invalid_grant', error_description: 'Butik Plus required' },
        400,
      )
    return noStoreJson(
      {
        error: code.startsWith('CONNECTOR_')
          ? 'invalid_grant'
          : 'invalid_request',
      },
      400,
    )
  }
}
export async function OPTIONS() {
  return publicPreflight()
}
