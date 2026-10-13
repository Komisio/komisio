import { pathToFileURL } from 'node:url'
import { confirmationConfig } from './confirmation-template.mjs'

export async function configureAuthEmails(
  target,
  env = process.env,
  request = fetch,
) {
  if (
    !['staging', 'production'].includes(target) ||
    env.GITHUB_ACTIONS !== 'true' ||
    env.GITHUB_REPOSITORY !== 'Komisio/komisio' ||
    env.GITHUB_REF !== 'refs/heads/main' ||
    env.GITHUB_EVENT_NAME !==
      (target === 'production' ? 'workflow_dispatch' : 'push')
  )
    throw new Error(
      'Auth template deployment requires the protected main workflow',
    )
  if (
    !/^[a-z]{20}$/.test(env.SUPABASE_PROJECT_ID ?? '') ||
    !env.SUPABASE_ACCESS_TOKEN
  )
    throw new Error('Missing Auth template deployment configuration')
  const url = `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_ID}/config/auth`
  const headers = {
    Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  }
  const before = await request(url, {
    headers,
    signal: AbortSignal.timeout(30000),
  })
  if (!before.ok)
    throw new Error(`Auth configuration read failed (${before.status})`)
  const current = await before.json()
  const site = new URL(current.site_url)
  if (site.protocol !== 'https:' || site.origin !== current.site_url)
    throw new Error(
      'Auth Site URL must be the public HTTPS origin without a trailing slash',
    )
  // Add only our exact activation destination; preserve every existing callback.
  const redirects = new Set(
    (current.uri_allow_list ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  )
  redirects.add(`${site.origin}/auth/activate`)
  const expected = {
    ...confirmationConfig(),
    uri_allow_list: [...redirects].join(','),
  }
  const update = await request(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(expected),
    signal: AbortSignal.timeout(30000),
  })
  if (!update.ok)
    throw new Error(`Auth template update failed (${update.status})`)
  const check = await request(url, {
    headers,
    signal: AbortSignal.timeout(30000),
  })
  if (!check.ok)
    throw new Error(`Auth template verification failed (${check.status})`)
  const actual = await check.json()
  if (Object.entries(expected).some(([key, value]) => actual[key] !== value))
    throw new Error('Auth template verification mismatch')
  console.log(
    'Confirmation and activation email templates updated and verified for ' +
      target,
  )
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await configureAuthEmails(process.argv[2])
