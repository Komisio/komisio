import { pathToFileURL } from 'node:url'
import { migrateHosted, migrationHistory } from './migrate-hosted.mjs'

// Kept as the staging entry point; the shared path lives in migrate-hosted.mjs.
export { migrationHistory }
export function migrateStaging(env = process.env, run) {
  return migrateHosted('staging', env, run)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  migrateStaging()
