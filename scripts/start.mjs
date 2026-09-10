import { cpSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const server = resolve('.next/standalone/server.js')
if (!existsSync(server)) throw new Error('Run npm run build before npm start.')
if (existsSync('.env.local')) process.loadEnvFile('.env.local')
// Standalone output does not include static/public assets automatically.
cpSync('.next/static', '.next/standalone/.next/static', { recursive: true })
if (existsSync('public'))
  cpSync('public', '.next/standalone/public', { recursive: true })
process.env.HOSTNAME = process.env.KOMISIO_HOSTNAME ?? '127.0.0.1'
await import(pathToFileURL(server).href)
