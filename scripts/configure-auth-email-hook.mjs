import { createHmac, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

export async function configureAuthEmailHook(
  target,
  env = process.env,
  request = fetch,
) {
  if (
    !['staging', 'production'].includes(target) ||
    env.GITHUB_ACTIONS !== 'true' ||
    env.GITHUB_REPOSITORY !== 'Komisio/komisio' ||
    env.GITHUB_REF !== 'refs/heads/main' ||
    env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
  )
    throw new Error('Auth email hook requires the protected main workflow')
  const secret = env.KOMISIO_AUTH_EMAIL_HOOK_SECRET ?? ''
  if (
    !/^v1,whsec_[A-Za-z0-9+/]{43}=$/.test(secret) ||
    !/^[a-z]{20}$/.test(env.SUPABASE_PROJECT_ID ?? '') ||
    !env.SUPABASE_ACCESS_TOKEN
  )
    throw new Error('Missing Auth hook configuration')
  const url = `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_ID}/config/auth`
  const headers = {
    Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  }
  const read = await request(url, {
    headers,
    signal: AbortSignal.timeout(15000),
  })
  if (!read.ok) throw new Error('Cannot read Auth configuration')
  const current = await read.json()
  const site = new URL(current.site_url)
  if (site.protocol !== 'https:' || site.origin !== current.site_url)
    throw new Error('Auth Site URL must be the public HTTPS origin')
  const endpoint = `${site.origin}/api/auth/email`
  if (
    current.hook_send_email_enabled &&
    current.hook_send_email_uri !== endpoint
  )
    throw new Error(
      'A different email hook is already configured; review before replacing it',
    )
  const body = JSON.stringify({ type: 'komisio-auth-email-probe' })
  const id = randomUUID(),
    timestamp = Math.floor(Date.now() / 1000).toString()
  const signature = createHmac(
    'sha256',
    Buffer.from(secret.slice('v1,whsec_'.length), 'base64'),
  )
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64')
  const probe = await request(endpoint, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': timestamp,
      'webhook-signature': `v1,${signature}`,
    },
    body,
    signal: AbortSignal.timeout(15000),
  })
  if (!probe.ok)
    throw new Error(
      'Deploy the email handler and its matching secret before enabling the hook',
    )
  const redirects = new Set(
    (current.uri_allow_list ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  redirects.add(`${site.origin}/auth/activate?ticket=*`)
  const expected = {
    hook_send_email_enabled: true,
    hook_send_email_uri: endpoint,
    uri_allow_list: [...redirects].join(','),
  }
  const patch = await request(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ ...expected, hook_send_email_secrets: secret }),
    signal: AbortSignal.timeout(15000),
  })
  if (!patch.ok) throw new Error('Auth email hook update failed')
  const check = await request(url, {
    headers,
    signal: AbortSignal.timeout(15000),
  })
  if (!check.ok) throw new Error('Auth email hook readback failed')
  const actual = await check.json()
  if (Object.entries(expected).some(([k, v]) => actual[k] !== v))
    throw new Error('Auth email hook verification mismatch')
  console.log(
    `Auth email hook configured and verified for ${target}. Enable branded activation only after verifying Auth delivery.`,
  )
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await configureAuthEmailHook(process.argv[2])
