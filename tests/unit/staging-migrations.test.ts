import { describe, expect, it, vi } from 'vitest'
import type { spawnSync } from 'node:child_process'
import {
  migrateStaging,
  migrationHistory,
} from '../../scripts/migrate-staging.mjs'

const env: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  GITHUB_ACTIONS: 'true',
  GITHUB_EVENT_NAME: 'push',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_REPOSITORY: 'Komisio/komisio',
  SUPABASE_PROJECT_ID: 'abcdefghijklmnopqrst',
  SUPABASE_ACCESS_TOKEN: 'test-secret',
}

describe('staging migration release boundary', () => {
  it.each([
    { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_REF: 'refs/heads/feature' },
    { GITHUB_REPOSITORY: 'outside/fork' },
    { SUPABASE_PROJECT_ID: '' },
    { SUPABASE_ACCESS_TOKEN: '' },
  ])('rejects an untrusted or unconfigured run %j', (change) => {
    const run = vi.fn()
    expect(() => migrateStaging({ ...env, ...change }, run)).toThrow()
    expect(run).not.toHaveBeenCalled()
  })

  it.each([
    {},
    { migrations: [{ local: '', remote: '20260915200000' }] },
    { migrations: [{ local: 'invalid', remote: '' }] },
    { migrations: [{ local: '20260915190000', remote: '20260915200000' }] },
  ])('refuses malformed or divergent history', (history) => {
    expect(() => migrationHistory(history)).toThrow()
  })

  it('dry runs before applying and verifies older missing versions without resets', () => {
    let reads = 0
    const run = vi.fn((_command, args) => ({
      status: 0,
      stdout:
        args[0] === 'migration'
          ? JSON.stringify({
              migrations: [
                {
                  local: '20260915190000',
                  remote: reads++ ? '20260915190000' : '',
                },
                { local: '20260915200000', remote: '20260915200000' },
              ],
            })
          : '',
    }))
    migrateStaging(env, run as unknown as typeof spawnSync)
    expect(run.mock.calls.map((call) => call[1].slice(0, 2))).toEqual([
      ['link', '--project-ref'],
      ['migration', 'list'],
      ['db', 'push'],
      ['db', 'push'],
      ['migration', 'list'],
    ])
    expect(run.mock.calls[2][1]).toContain('--dry-run')
    expect(run.mock.calls[3][1]).toContain('--skip-vault')
    expect(run.mock.calls[3][1]).toContain('--include-all')
  })

  it('does not leak CLI diagnostics or continue after failure', () => {
    const run = vi.fn(() => ({ status: 1, stderr: 'test-secret' }))
    expect(() =>
      migrateStaging(env, run as unknown as typeof spawnSync),
    ).toThrow('Supabase link')
    expect(() =>
      migrateStaging(env, run as unknown as typeof spawnSync),
    ).not.toThrow('test-secret')
  })
})
