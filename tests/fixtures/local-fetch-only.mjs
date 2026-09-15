const originalFetch = globalThis.fetch
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw new Error('External HTTP is disabled in this browser fixture')
  return originalFetch(input, init)
}
