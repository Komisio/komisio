// Read-only checks; never register accounts or run database tests remotely.
const target = new URL(process.argv[2] ?? '')
if (
  target.protocol !== 'https:' ||
  target.username ||
  target.password ||
  target.pathname !== '/' ||
  target.search ||
  target.hash
)
  throw new Error('Supply the exact HTTPS staging origin')
for (const path of ['/login', '/register']) {
  const response = await fetch(new URL(path, target), {
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  })
  if (response.status !== 200)
    throw new Error(
      `${path}: expected 200, received ${response.status}. Check deployment protection and app configuration.`,
    )
  const html = await response.text()
  if (!html.includes('Komisio') || !html.includes('<form'))
    throw new Error(`${path}: application form is missing`)
  console.log(`${path}: application form available`)
}
const denied = await fetch(new URL('/api/platform', target), {
  method: 'POST',
  headers: { Origin: target.origin, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'profile',
    name: 'Anonymous check',
    locale: 'sv',
  }),
  redirect: 'manual',
  signal: AbortSignal.timeout(15000),
})
if (denied.status !== 401)
  throw new Error(`Anonymous request: expected 401, received ${denied.status}`)
console.log(
  'Anonymous mutation rejected. Authenticated journeys and email delivery still require a pilot walkthrough.',
)
