/** Isolated developer test stacks must never target a hosted database or inbox. */
export function localTestUrl(name: string, fallback: string) {
  const value = process.env[name] || fallback
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value).hostname))
    throw new Error('Test services must use loopback')
  return value
}
