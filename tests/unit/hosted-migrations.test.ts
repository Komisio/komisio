import { describe, expect, it, vi } from 'vitest'
import type { spawnSync } from 'node:child_process'
import { migrateHosted } from '../../scripts/migrate-hosted.mjs'

const base: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  GITHUB_ACTIONS: 'true',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_REPOSITORY: 'Komisio/komisio',
  SUPABASE_PROJECT_ID: 'abcdefghijklmnopqrst',
  SUPABASE_ACCESS_TOKEN: 'test-secret',
}
const current = (command: string, args: string[]) => ({
  command,
  args,
  status: 0,
  stdout: JSON.stringify({
    migrations: [{ local: '20260916350000', remote: '20260916350000' }],
  }),
})

describe('production migration release boundary', () => {
  it('runs only from an owner-dispatched workflow on main', () => {
    const run = vi.fn(current)
    migrateHosted(
      'production',
      { ...base, GITHUB_EVENT_NAME: 'workflow_dispatch' },
      run as unknown as typeof spawnSync,
    )
    expect(run.mock.calls.map((c) => c[1].slice(0, 2))).toEqual([
      ['link', '--project-ref'],
      ['migration', 'list'],
      ['migration', 'list'],
    ])
  })
  it.each([
    { GITHUB_EVENT_NAME: 'push' },
    { GITHUB_EVENT_NAME: 'pull_request' },
    {
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_REF: 'refs/heads/release',
    },
    {
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_REPOSITORY: 'fork/komisio',
    },
    { GITHUB_EVENT_NAME: 'workflow_dispatch', SUPABASE_ACCESS_TOKEN: '' },
  ])('refuses %j before touching the CLI', (change) => {
    const run = vi.fn(current)
    expect(() =>
      migrateHosted(
        'production',
        { ...base, ...change },
        run as unknown as typeof spawnSync,
      ),
    ).toThrow()
    expect(run).not.toHaveBeenCalled()
  })
  it('never lets a push reach production, and never lets a dispatch reach staging', () => {
    const run = vi.fn(current)
    expect(() =>
      migrateHosted(
        'staging',
        { ...base, GITHUB_EVENT_NAME: 'workflow_dispatch' },
        run as unknown as typeof spawnSync,
      ),
    ).toThrow()
    expect(() =>
      migrateHosted('elsewhere', base, run as unknown as typeof spawnSync),
    ).toThrow('Unknown deployment target')
    expect(run).not.toHaveBeenCalled()
  })
})
