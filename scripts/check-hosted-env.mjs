// Validate configuration without printing credentials or connecting to services.
const failures = []
for (const name of ['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_SUPABASE_URL']) {
  try {
    const url = new URL(process.env[name] ?? '')
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    )
      throw new Error('Invalid origin')
  } catch {
    failures.push(`${name} must be a public HTTPS origin`)
  }
}
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''
let publicKey = key.startsWith('sb_publishable_')
if (!publicKey) {
  try {
    publicKey =
      JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString())
        .role === 'anon'
  } catch {
    /* Not a legacy public key. */
  }
}
if (!publicKey)
  failures.push(
    'Use a Supabase publishable or legacy anon key, never a secret/service-role key',
  )
if (process.env.KOMISIO_ENVIRONMENT !== 'staging')
  failures.push(
    'This initial hosted release requires KOMISIO_ENVIRONMENT=staging; production readiness is not yet verified',
  )
const delivery = process.env.INVITATION_EMAIL_DELIVERY ?? 'manual'
if (!['manual', 'resend'].includes(delivery))
  failures.push('Invalid INVITATION_EMAIL_DELIVERY')
if (delivery === 'resend') {
  for (const name of [
    'RESEND_API_KEY',
    'INVITATION_EMAIL_FROM',
    'INVITATION_EMAIL_ALLOWLIST',
  ]) {
    if (!process.env[name]?.trim())
      failures.push(`${name} is required for pilot invitation email`)
  }
}
if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log(
    'Hosted staging configuration is present. Verify service regions, SMTP and callbacks in the provider dashboards.',
  )
}
