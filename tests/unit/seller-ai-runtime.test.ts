import { describe, expect, it, vi } from 'vitest'
import { configureSellerAIRuntime } from '../../scripts/configure-seller-ai-runtime.mjs'
const env: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'Komisio/komisio',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_EVENT_NAME: 'push',
  SUPABASE_PROJECT_ID: 'abcdefghijklmnopqrst',
  SUPABASE_ACCESS_TOKEN: 'synthetic',
  KOMISIO_SELLER_AI_SERVER_KEY: 'a'.repeat(64),
}
describe('seller AI hosted provisioning', () => {
  it('rejects a branch, wrong event and missing secret before requests', async () => {
    const request = vi.fn()
    for (const change of [
      { GITHUB_REF: 'refs/heads/feature' },
      { GITHUB_EVENT_NAME: 'pull_request' },
      { KOMISIO_SELLER_AI_SERVER_KEY: '' },
    ])
      await expect(
        configureSellerAIRuntime('staging', { ...env, ...change }, request),
      ).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })
  it('sends only a hash and verifies the result', async () => {
    const request = vi.fn(async (_url, options) => {
      expect(options.body).not.toContain(env.KOMISIO_SELLER_AI_SERVER_KEY)
      return Response.json([{ verified: true }])
    })
    await configureSellerAIRuntime('staging', env, request)
    expect(request).toHaveBeenCalledOnce()
  })
  it('fails closed on an unconfirmed database response', async () => {
    await expect(
      configureSellerAIRuntime('staging', env, async () => Response.json([])),
    ).rejects.toThrow('verification failed')
  })
})
