import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join, delimiter } from 'node:path'
const script = join(
  process.env.APPDATA ?? '',
  'npm',
  'node_modules',
  'supabase',
  'dist',
  'supabase.js',
)
const command =
  process.platform === 'win32' && existsSync(script)
    ? process.execPath
    : 'supabase'
const args =
  command === process.execPath
    ? [script, 'status', '-o', 'json']
    : ['status', '-o', 'json']
const env = { ...process.env }
if (process.platform === 'win32')
  env.PATH = `C:\\Program Files\\Docker\\Docker\\resources\\bin${delimiter}${env.PATH}`
const result = spawnSync(command, args, { encoding: 'utf8', env })
if (result.status !== 0)
  throw new Error('Start local Supabase before configuring the application.')
const state = JSON.parse(result.stdout)
const key = state.ANON_KEY ?? state.PUBLISHABLE_KEY
if (!key) throw new Error('Local public client key unavailable.')
writeFileSync(
  '.env.local',
  `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${key}\nNEXT_PUBLIC_APP_URL=http://127.0.0.1:3000\n`,
)
console.log('Local public client configuration written to ignored .env.local.')
