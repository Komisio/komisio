import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import net from 'node:net'
import { setTimeout as pause } from 'node:timers/promises'

// Local print agent (P2 S19). Runs next to the printer, signed in as a store
// member with a dedicated account, and works one printer's queue: claim the
// next job, send the ZPL over TCP, report the outcome. It stores nothing and
// prints only what the store queued. USB transport is not implemented here.
//
// Configuration: environment variables, or a file of KEY=VALUE lines given as
// the first argument (`node scripts/print-agent.mjs komisio-print.env`).
// Sign in with KOMISIO_PRINT_EMAIL and KOMISIO_PRINT_PASSWORD (the printer's
// own staff account, no MFA enrolled); the session renews itself. An access
// token in KOMISIO_PRINT_ACCESS_TOKEN still works for a short test.
const env = { ...process.env }
if (process.argv[2]) {
  for (const line of readFileSync(process.argv[2], 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m && !line.trimStart().startsWith('#'))
      env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const url = env.KOMISIO_PRINT_SUPABASE_URL,
  key = env.KOMISIO_PRINT_PUBLISHABLE_KEY,
  token = env.KOMISIO_PRINT_ACCESS_TOKEN,
  email = env.KOMISIO_PRINT_EMAIL,
  password = env.KOMISIO_PRINT_PASSWORD,
  tenant = env.KOMISIO_PRINT_TENANT_ID,
  printerId = env.KOMISIO_PRINT_PRINTER_ID
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
if (
  !url ||
  !key ||
  (!token && !(email && password)) ||
  !uuid.test(tenant ?? '') ||
  !uuid.test(printerId ?? '')
)
  throw new Error(
    'Set KOMISIO_PRINT_SUPABASE_URL, KOMISIO_PRINT_PUBLISHABLE_KEY, KOMISIO_PRINT_EMAIL and KOMISIO_PRINT_PASSWORD (or KOMISIO_PRINT_ACCESS_TOKEN), KOMISIO_PRINT_TENANT_ID and KOMISIO_PRINT_PRINTER_ID',
  )
const client = createClient(url, key, {
  auth: {
    persistSession: false,
    autoRefreshToken: !token,
    detectSessionInUrl: false,
  },
  ...(token
    ? { global: { headers: { Authorization: `Bearer ${token}` } } }
    : {}),
})
if (!token) {
  const signed = await client.auth.signInWithPassword({ email, password })
  if (signed.error)
    throw new Error(
      'Sign-in failed: check the e-mail and password of the printer account, and that it has no MFA enrolled',
    )
}
const printer = await client
  .from('printers')
  .select('name,transport,address,active')
  .eq('tenant_id', tenant)
  .eq('id', printerId)
  .maybeSingle()
if (printer.error || !printer.data)
  throw new Error(
    'Printer not readable with this account: is the account a member of the store, and are the tenant and printer ids right?',
  )
if (printer.data.transport !== 'tcp')
  throw new Error('Only the tcp transport is supported by this agent')
if (!printer.data.active)
  console.warn('The printer is inactive; no jobs will be queued to it')
const [host, port] = printer.data.address.split(':')
console.log(`Print agent for "${printer.data.name}" at ${host}:${port ?? 9100}`)

function sendZpl(payload) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port: Number(port ?? 9100) })
    socket.setTimeout(10000)
    socket.on('connect', () => socket.end(payload, 'utf8'))
    socket.on('close', () => resolve())
    socket.on('error', reject)
    socket.on('timeout', () => {
      socket.destroy(new Error('printer timeout'))
    })
  })
}

let running = true
process.on('SIGINT', () => {
  running = false
})
while (running) {
  const claim = await client.rpc('claim_print_job', {
    p_tenant: tenant,
    p_printer: printerId,
  })
  if (claim.error) {
    console.error('claim failed:', claim.error.message)
    await pause(10000)
    continue
  }
  const job = claim.data
  if (!job) {
    await pause(3000)
    continue
  }
  let ok = true,
    error = ''
  try {
    for (let i = 0; i < job.copies; i++) await sendZpl(job.payload)
  } catch (e) {
    ok = false
    error = e instanceof Error ? e.message : 'print failed'
  }
  const done = await client.rpc('complete_print_job', {
    p_tenant: tenant,
    p_job: job.jobId,
    p_ok: ok,
    p_error: error,
  })
  if (done.error) console.error('complete failed:', done.error.message)
  else console.log(`${ok ? 'printed' : 'failed'} ${job.kind} ${job.jobId}`)
}
