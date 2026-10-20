// Test-process preload only. Production code has no configurable provider origin.
const loopback = (value) =>
  ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value).hostname)
if (
  !loopback(process.env.NEXT_PUBLIC_APP_URL ?? '') ||
  !loopback(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '') ||
  process.env.ECONOMIC_APP_SECRET_TOKEN !== 'synthetic-economic-secret'
)
  throw new Error(
    'e-conomic simulator requires loopback and synthetic credentials',
  )
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (['restapi.e-conomic.com', 'apis.e-conomic.com'].includes(url.hostname)) {
    const headers = new Headers(init?.headers)
    if (
      headers.get('X-AppSecretToken') !== 'synthetic-economic-secret' ||
      headers.get('X-AgreementGrantToken') !== 'synthetic-economic-grant'
    )
      throw new Error('Only simulator credentials may cross this test boundary')
    return realFetch(`http://127.0.0.1:3468${url.pathname}${url.search}`, init)
  }
  return realFetch(input, init)
}
