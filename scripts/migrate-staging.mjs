import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function migrationHistory(value) {
  if (!Array.isArray(value?.migrations))
    throw new Error('Unrecognized migration history; refusing deployment')
  const pending = []
  for (const row of value.migrations) {
    if (
      typeof row.local !== 'string' ||
      typeof row.remote !== 'string' ||
      (row.local && !/^\d{14}$/.test(row.local)) ||
      (row.remote && !/^\d{14}$/.test(row.remote)) ||
      (!row.local && !row.remote)
    )
      throw new Error('Invalid migration version; refusing deployment')
    if (row.remote && row.local !== row.remote)
      throw new Error(
        'Remote history is ahead or divergent; refusing deployment',
      )
    if (row.local && !row.remote) pending.push(row.local)
  }
  return pending
}

export function migrateStaging(env = process.env, run = spawnSync) {
  if (
    env.GITHUB_ACTIONS !== 'true' ||
    env.GITHUB_EVENT_NAME !== 'push' ||
    env.GITHUB_REF !== 'refs/heads/main' ||
    env.GITHUB_REPOSITORY !== 'Komisio/komisio'
  )
    throw new Error(
      'Staging deployment requires a main push in the owner repository',
    )
  if (
    !/^[a-z]{20}$/.test(env.SUPABASE_PROJECT_ID ?? '') ||
    !env.SUPABASE_ACCESS_TOKEN
  )
    throw new Error('Missing staging environment configuration')
  const cli = (args, json = false) => {
    const result = run('supabase', args, {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000,
      maxBuffer: 4 * 1024 * 1024,
    })
    if (result.error || result.status !== 0)
      throw new Error(
        `Supabase ${args[0]} ${args[1]} failed; inspect configuration and migration history securely`,
      )
    return json ? JSON.parse(result.stdout) : undefined
  }
  cli(['link', '--project-ref', env.SUPABASE_PROJECT_ID])
  const history = () =>
    migrationHistory(
      cli(['migration', 'list', '--linked', '--output-format', 'json'], true),
    )
  const pending = history()
  console.log(`Pending staging migrations: ${pending.join(', ') || 'none'}`)
  if (pending.length) {
    cli([
      'db',
      'push',
      '--linked',
      '--dry-run',
      '--skip-vault',
      '--include-all',
    ])
    cli(['db', 'push', '--linked', '--skip-vault', '--include-all', '--yes'])
  }
  if (history().length) throw new Error('Staging migration verification failed')
  console.log('Staging migration history matches this committed revision')
  if (env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      `## Staging database\nVerified migration history for ${env.GITHUB_SHA}.\nApplied versions: ${pending.join(', ') || 'none (already current)'}.\n`,
    )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  migrateStaging()
