import { createHmac, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

export async function configureAuthSmsHook(
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
    throw new Error('Auth SMS requires the protected main workflow')
  const secret = env.KOMISIO_AUTH_SMS_HOOK_SECRET ?? ''
  if (
    !/^v1,whsec_[A-Za-z0-9+/]{43}=$/.test(secret) ||
    !/^[a-z]{20}$/.test(env.SUPABASE_PROJECT_ID ?? '') ||
    !env.SUPABASE_ACCESS_TOKEN
  )
    throw new Error('Missing Auth SMS configuration')
  const origin =
    target === 'production'
      ? 'https://app.komisio.com'
      : 'https://komisio-staging.vercel.app'
  const endpoint = `${origin}/api/auth/sms`
  const url = `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_ID}/config/auth`
  const headers = {
    Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  }
  const read = async () => {
    const response = await request(url, {
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error('Cannot read Auth SMS configuration')
    return response.json()
  }
  const current = await read()
  if (current.site_url !== origin)
    throw new Error('Auth Site URL does not match the selected environment')
  if (
    (current.hook_send_sms_enabled && current.hook_send_sms_uri !== endpoint) ||
    (current.external_phone_enabled &&
      (!current.hook_send_sms_enabled ||
        current.hook_send_sms_uri !== endpoint))
  )
    throw new Error(
      'A different SMS transport is active; review before replacing it',
    )
  if (current.sms_test_otp)
    throw new Error(
      'Remove hosted test codes before enabling real phone verification',
    )

  const body = JSON.stringify({ type: 'komisio-auth-sms-probe' })
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
  if (!probe.ok || JSON.stringify(await probe.json()) !== '{}')
    throw new Error(
      'Deploy and verify the SMS handler and its secrets before activation',
    )

  const expected = {
    hook_send_sms_enabled: true,
    hook_send_sms_uri: endpoint,
    external_phone_enabled: true,
    sms_autoconfirm: false,
    sms_max_frequency: Math.max(60, Number(current.sms_max_frequency) || 60),
    rate_limit_sms_sent: Math.min(
      20,
      Number(current.rate_limit_sms_sent) > 0
        ? Number(current.rate_limit_sms_sent)
        : 20,
    ),
  }
  const patch = await request(url, {
    method: 'PATCH',
    headers,
    redirect: 'error',
    body: JSON.stringify({ ...expected, hook_send_sms_secrets: secret }),
    signal: AbortSignal.timeout(15000),
  })
  if (!patch.ok) throw new Error('Auth SMS configuration update failed')
  const actual = await read()
  if (Object.entries(expected).some(([key, value]) => actual[key] !== value))
    throw new Error('Auth SMS configuration verification mismatch')
  // Detect unexpected changes without printing Auth configuration or secrets.
  for (const key of Object.keys(current)) {
    if (key in expected || key === 'hook_send_sms_secrets') continue
    if (JSON.stringify(current[key]) !== JSON.stringify(actual[key]))
      throw new Error(
        'An unrelated Auth setting changed; inspect before using SMS',
      )
  }
  console.log(
    `Auth SMS configured and read back for ${target}. Verify real code delivery separately.`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await configureAuthSmsHook(process.argv[2])
