import { it, expect } from 'vitest'
import { readMCPConfig } from '../../mcp/config'
const env = {
  KOMISIO_MCP_SUPABASE_URL: 'https://example.supabase.co',
  KOMISIO_MCP_PUBLISHABLE_KEY: 'fixture-public',
  KOMISIO_MCP_ACCESS_TOKEN: 'fixture-user',
  KOMISIO_MCP_TENANT_ID: '85000000-0000-4000-8000-000000000001',
  KOMISIO_MCP_SCOPES: 'reception:read',
}
it('requires dedicated explicit MCP configuration, not web or provider credentials', () => {
  expect(() => readMCPConfig({})).toThrow()
  expect(() =>
    readMCPConfig({
      NEXT_PUBLIC_SUPABASE_URL: env.KOMISIO_MCP_SUPABASE_URL,
      OPENAI_API_KEY: 'unrelated',
    }),
  ).toThrow()
  expect(readMCPConfig(env).scopes).toEqual(['reception:read'])
})
it('denies unknown/wildcard scopes and unpinned stores', () => {
  for (const scopes of [
    '*',
    'reception:publish',
    '',
    'reception:read,tenant:admin',
  ])
    expect(() =>
      readMCPConfig({ ...env, KOMISIO_MCP_SCOPES: scopes }),
    ).toThrow()
  expect(() => readMCPConfig({ ...env, KOMISIO_MCP_TENANT_ID: '*' })).toThrow()
})
it('allows HTTPS or loopback only and rejects URL-embedded credentials', () => {
  for (const url of [
    'http://example.com',
    'https://user:password@example.com',
    'file:///tmp/database',
  ])
    expect(() =>
      readMCPConfig({ ...env, KOMISIO_MCP_SUPABASE_URL: url }),
    ).toThrow()
  expect(
    readMCPConfig({
      ...env,
      KOMISIO_MCP_SUPABASE_URL: 'http://127.0.0.1:54321',
    }).url,
  ).toBe('http://127.0.0.1:54321')
})
