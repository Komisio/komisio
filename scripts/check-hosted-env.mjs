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
const environment = process.env.KOMISIO_ENVIRONMENT
if (process.env.KOMISIO_AUTH_EMAIL_HOOK_ENABLED === 'true') {
  if (
    !/^v1,whsec_[A-Za-z0-9+/]{43}=$/.test(
      process.env.KOMISIO_AUTH_EMAIL_HOOK_SECRET ?? '',
    )
  )
    failures.push('Branded activation requires KOMISIO_AUTH_EMAIL_HOOK_SECRET')
  if (
    !process.env.RESEND_API_KEY ||
    !(process.env.SELLER_EMAIL_FROM || process.env.INVITATION_EMAIL_FROM)
  )
    failures.push('Branded activation requires the Auth hook email transport')
}
if (!['staging', 'production'].includes(environment ?? ''))
  failures.push('KOMISIO_ENVIRONMENT must be staging or production')
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
if (environment === 'production') {
  if (
    process.env.STRIPE_SECRET_KEY &&
    process.env.STRIPE_PRICE_ID &&
    process.env.KOMISIO_STRIPE_AUTOMATIC_TAX !== 'true'
  )
    console.warn(
      'Stripe is configured but automatic tax is off. Complete docs/STRIPE-TAX.md before enabling KOMISIO_STRIPE_AUTOMATIC_TAX=true.',
    )
  // Production is the only environment customers see: an own domain, real
  // e-mail, own secrets for the jobs, no staging-only switches.
  let host = ''
  try {
    host = new URL(process.env.NEXT_PUBLIC_APP_URL ?? '').hostname
  } catch {
    /* Reported above. */
  }
  if (/staging|vercel\.app$|localhost/.test(host))
    failures.push('Production must run on its own domain, not a staging host')
  if (delivery !== 'resend')
    failures.push('Production requires INVITATION_EMAIL_DELIVERY=resend')
  if (!/^[0-9a-f]{64}$/i.test(process.env.KOMISIO_CREDENTIAL_KEY ?? ''))
    failures.push(
      'Production requires its own KOMISIO_CREDENTIAL_KEY (64 hex characters)',
    )
  if ((process.env.CRON_SECRET ?? '').length < 16)
    failures.push('Production requires CRON_SECRET (at least 16 characters)')
  if (
    !process.env.KOMISIO_AUTOMATION_EMAIL?.trim() ||
    (process.env.KOMISIO_AUTOMATION_PASSWORD ?? '').length < 16
  )
    failures.push(
      'Production requires the automation identity (KOMISIO_AUTOMATION_EMAIL and a password of at least 16 characters)',
    )
  for (const name of ['SHOPIFY_ACCEPT_TEST_ORDERS']) {
    if (process.env[name] === 'true')
      failures.push(
        `${name} is a staging-only switch and must be unset in production`,
      )
  }
}
if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log(
    `Hosted ${environment} configuration is present. Verify service regions, SMTP and callbacks in the provider dashboards.`,
  )
}
