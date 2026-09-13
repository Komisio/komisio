import { createClient } from '@supabase/supabase-js'
import net from 'node:net'
import { setTimeout as pause } from 'node:timers/promises'

// Local print agent (P2 S19). Runs next to the printer, signed in as a store
// member with a dedicated account, and works one printer's queue: claim the
// next job, send the ZPL over TCP, report the outcome. It stores nothing and
// prints only what the store queued. USB transport is not implemented here.
const env = process.env
const url = env.KOMISIO_PRINT_SUPABASE_URL,
  key = env.KOMISIO_PRINT_PUBLISHABLE_KEY,
  token = env.KOMISIO_PRINT_ACCESS_TOKEN,
  tenant = env.KOMISIO_PRINT_TENANT_ID,
  printerId = env.KOMISIO_PRINT_PRINTER_ID
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
if (
  !url ||
  !key ||
  !token ||
  !uuid.test(tenant ?? '') ||
  !uuid.test(printerId ?? '')
)
  throw new Error(
    'Set KOMISIO_PRINT_SUPABASE_URL, KOMISIO_PRINT_PUBLISHABLE_KEY, KOMISIO_PRINT_ACCESS_TOKEN, KOMISIO_PRINT_TENANT_ID and KOMISIO_PRINT_PRINTER_ID',
  )
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${token}` } },
})
const printer = await client
  .from('printers')
  .select('name,transport,address,active')
  .eq('tenant_id', tenant)
  .eq('id', printerId)
  .maybeSingle()
if (printer.error || !printer.data)
  throw new Error('Printer not readable with this account')
if (printer.data.transport !== 'tcp')
  throw new Error('Only the tcp transport is supported by this agent')
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
