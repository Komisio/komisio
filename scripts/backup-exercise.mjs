// Restore exercise for the local or self-hosted stack: dump the running
// database with pg_dump inside the Supabase container, restore it into a
// fresh disposable database as an existing privileged role that can recreate
// the original ownership, verify the application schemas in the copy, then
// drop the copy. Never touches the source database, never creates or alters
// roles. Requires Docker on PATH and the local stack running (npm run
// db:start).
//
// The verdict is APPLICATION RESTORE CHECK PASSED only when pg_restore exits
// 0 without errors and public plus komisio_private match the source in table
// names, row counts and object definitions. Raw pg_restore output, error
// messages and row data are never printed; scripts/backup-verification.mjs
// holds the logic and its tests.
//
// KOMISIO_RESTORE_DB_USER names the role pg_restore runs as inside the
// container; the bundled Supabase image has supabase_admin. A self-hosted
// stack sets it to its own existing privileged role.
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { runRestoreExercise } from './backup-verification.mjs'

const container = process.env.KOMISIO_DB_CONTAINER ?? 'supabase_db_komisio'
const connectionString =
  process.env.KOMISIO_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const restoreUser = process.env.KOMISIO_RESTORE_DB_USER ?? 'supabase_admin'
const copy = `komisio_restore_${randomUUID().replaceAll('-', '')}`

const code = await runRestoreExercise({
  copy,
  dump: `/tmp/${copy}.dump`,
  restoreUser,
  log: (line) => console.log(line),
  spawn: (args) => {
    const r = spawnSync('docker', ['exec', container, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
    return { status: r.status, stderr: r.stderr ?? '' }
  },
  newClient: (database) => {
    const url = new URL(connectionString)
    url.pathname = `/${database}`
    return new pg.Client({ connectionString: url.toString() })
  },
})
process.exit(code)
