import { pathToFileURL } from 'node:url'

/** Run only through the protected release operation; never enable phone auth. */
export async function retirePhoneAuth(
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
    throw new Error('Phone retirement requires the protected main workflow')
  if (
    !/^[a-z]{20}$/.test(env.SUPABASE_PROJECT_ID ?? '') ||
    !env.SUPABASE_ACCESS_TOKEN
  )
    throw new Error('Missing Auth configuration')
  const origin =
    target === 'production'
      ? 'https://app.komisio.com'
      : 'https://komisio-staging.vercel.app'
  const url = `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_ID}/config/auth`
  const options = {
    headers: {
      Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    redirect: 'error',
  }
  async function read() {
    const response = await request(url, {
      ...options,
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error('Cannot read Auth configuration')
    return response.json()
  }
  const before = await read()
  if (before.site_url !== origin) throw new Error('Auth environment mismatch')
  const expected = {
    external_phone_enabled: false,
    hook_send_sms_enabled: false,
    hook_send_sms_uri: '',
    hook_send_sms_secrets: '',
  }
  const response = await request(url, {
    ...options,
    method: 'PATCH',
    body: JSON.stringify(expected),
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error('Cannot retire phone authentication')
  const after = await read()
  if (
    after.external_phone_enabled !== false ||
    after.hook_send_sms_enabled !== false ||
    after.hook_send_sms_uri
  )
    throw new Error('Phone retirement verification failed')
  for (const key of Object.keys(before)) {
    if (key in expected) continue
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      throw new Error('Unrelated Auth configuration changed')
  }
  console.log(
    `Phone authentication and SMS delivery disabled and verified for ${target}.`,
  )
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await retirePhoneAuth(process.argv[2])
