import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Builds KomisioPrint.exe for one environment: the agent with the
// environment's Supabase URL and publishable key baked in, packed into a
// Node single executable. Run on Windows with Node 22 or later.
const url = process.env.KOMISIO_PRINT_SUPABASE_URL ?? ''
const key = process.env.KOMISIO_PRINT_PUBLISHABLE_KEY ?? ''
if (!/^https:\/\/[a-z0-9.-]+\.supabase\.co$/.test(url))
  throw new Error('KOMISIO_PRINT_SUPABASE_URL must be the project URL')
if (!key.startsWith('sb_publishable_') && !key.startsWith('eyJ'))
  throw new Error('KOMISIO_PRINT_PUBLISHABLE_KEY must be a publishable key')
const dist = join('print-agent', 'dist')
mkdirSync(dist, { recursive: true })
const source = readFileSync(join('print-agent', 'agent.cjs'), 'utf8')
  .replace('__KOMISIO_SUPABASE_URL__', url)
  .replace('__KOMISIO_PUBLISHABLE_KEY__', key)
writeFileSync(join(dist, 'agent.cjs'), source)
writeFileSync(
  join(dist, 'sea-config.json'),
  JSON.stringify({
    main: 'agent.cjs',
    output: 'sea-prep.blob',
    disableExperimentalSEAWarning: true,
  }),
)
execFileSync(
  process.execPath,
  ['--experimental-sea-config', 'sea-config.json'],
  {
    cwd: dist,
    stdio: 'inherit',
  },
)
const exe = join(dist, 'KomisioPrint.exe')
copyFileSync(process.execPath, exe)
execFileSync(
  'npx',
  [
    '--yes',
    'postject@1.0.0-alpha.6',
    exe,
    'NODE_SEA_BLOB',
    join(dist, 'sea-prep.blob'),
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ],
  { stdio: 'inherit', shell: process.platform === 'win32' },
)
console.log(`Built ${exe} for ${url}`)
