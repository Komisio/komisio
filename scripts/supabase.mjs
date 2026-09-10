import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { spawnSync } from 'node:child_process'
const env = { ...process.env }
const dockerPath = 'C:\\Program Files\\Docker\\Docker\\resources\\bin'
if (process.platform === 'win32' && existsSync(dockerPath))
  env.PATH = `${dockerPath}${delimiter}${env.PATH}`
const windowsScript = join(
  process.env.APPDATA ?? '',
  'npm',
  'node_modules',
  'supabase',
  'dist',
  'supabase.js',
)
const command =
  process.platform === 'win32' && existsSync(windowsScript)
    ? process.execPath
    : 'supabase'
const args =
  command === process.execPath
    ? [windowsScript, ...process.argv.slice(2)]
    : process.argv.slice(2)
const result = spawnSync(command, args, { stdio: 'inherit', env })
if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)
