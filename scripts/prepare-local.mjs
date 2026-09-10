import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'

// CLI 2.117.0 reads this checkout-local service override before starting Docker.
// v14.18 fixes fresh-JWT rejection present in the CLI's default v16.2 image.
const versions = JSON.parse(
  readFileSync('supabase/local-services.json', 'utf8'),
)
if (!/^v\d+\.\d+(\.\d+)?$/.test(versions.postgrest))
  throw new Error('Invalid local PostgREST version')
mkdirSync('supabase/.temp', { recursive: true })
writeFileSync('supabase/.temp/rest-version', versions.postgrest)
console.log(
  `Prepared local PostgREST ${versions.postgrest}. Restart an existing local stack to apply.`,
)
