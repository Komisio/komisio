import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  bookPostNordReturn,
  postNordConfiguration,
} from '../lib/platform/postnord'
import type { CentralParcel } from '../lib/engine/central-parcel-schema'

const required = [
  'POSTNORD_SANDBOX_API_KEY',
  'POSTNORD_SANDBOX_CUSTOMER_NUMBER',
] as const

type Options = {
  mode: 'check' | 'book' | 'inspect'
  runId?: string
  env?: Record<string, string | undefined>
  workspace?: string
}

/** Operator-only probe. Uses no Supabase credentials and never writes app data. */
export async function runPostNordSandbox(
  { mode, runId, env = process.env, workspace = process.cwd() }: Options,
  transport: typeof fetch = fetch,
) {
  if (mode !== 'check' && (!runId || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(runId)))
    throw new Error(
      'Use a run ID containing only lowercase letters, digits and hyphens',
    )
  const directory = path.resolve(
    workspace,
    'private/postnord-sandbox',
    runId ?? '',
  )
  if (mode === 'inspect') {
    // Inspecting a lost reply must not depend on credentials or resend a booking.
    const attempt = JSON.parse(
      await readFile(path.join(directory, 'attempt.json'), 'utf8'),
    )
    let result
    try {
      result = JSON.parse(
        await readFile(path.join(directory, 'result.json'), 'utf8'),
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return {
      environment: 'sandbox',
      runId,
      attempt,
      result: result ?? { status: 'unconfirmed' },
    }
  }

  // Deliberately do not fall back to the application's production configuration.
  const missing = required.filter((key) => !env[key]?.trim())
  const config = postNordConfiguration({
    KOMISIO_POSTNORD_ENABLED: 'true',
    KOMISIO_POSTNORD_ENVIRONMENT: 'sandbox',
    KOMISIO_POSTNORD_API_KEY: env.POSTNORD_SANDBOX_API_KEY,
    KOMISIO_POSTNORD_APPLICATION_ID: env.POSTNORD_SANDBOX_APPLICATION_ID,
    KOMISIO_POSTNORD_CUSTOMER_NUMBER: env.POSTNORD_SANDBOX_CUSTOMER_NUMBER,
    // The transport adapter does not use this database capability.
    KOMISIO_SHIPPING_SERVER_KEY: '0'.repeat(64),
  })
  if (mode === 'check' || !config)
    return {
      environment: 'sandbox',
      configuration: config ? 'ready' : 'missing-or-invalid',
      missing,
      endpoint: 'https://atapi2.postnord.com/rest/shipment/v3/returns/edi',
      networkRequests: 0,
    }

  const createdAt = new Date().toISOString()
  const reference = 'H-1'
  // Stable for this attempt and within PostNord's 14-character limit. It is
  // correlation evidence, never a claim that the carrier deduplicates POSTs.
  const messageId = `K${Date.now().toString().slice(-12)}`
  const contact = {
    name: 'Komisio sandbox sender',
    street: 'Testgatan 1',
    postalCode: '11122',
    city: 'Stockholm',
    country: 'SE' as const,
    email: 'sender@example.test',
    phone: '+46700000001',
  }
  const parcel: CentralParcel = {
    id: randomUUID(),
    reference: 'P-1',
    environment: 'sandbox',
    sender: contact,
    recipient: {
      ...contact,
      name: 'Komisio sandbox recipient',
      street: 'Testgatan 2',
      email: 'recipient@example.test',
    },
    weightG: 1000,
    lengthMm: 400,
    widthMm: 300,
    heightMm: 200,
    status: 'pending',
    booking: null,
    createdAt,
  }
  await mkdir(directory, { recursive: true })
  // An exclusive durable file prevents repeat/concurrent dispatch for this run,
  // including interruption after PostNord accepted it but before we saved a reply.
  const claim = await open(path.join(directory, 'attempt.json'), 'wx', 0o600)
  try {
    await claim.writeFile(
      JSON.stringify(
        { environment: 'sandbox', runId, messageId, reference, parcel },
        null,
        2,
      ),
    )
    await claim.sync()
  } finally {
    await claim.close()
  }

  let httpStatus: number | null = null
  let result
  try {
    const booking = await bookPostNordReturn(
      config,
      parcel,
      reference,
      messageId,
      async (url, init) => {
        if (new URL(String(url)).origin !== 'https://atapi2.postnord.com')
          throw new Error('Sandbox host required')
        const response = await transport(url, init)
        httpStatus = response.status
        return response
      },
    )
    result = { status: 'confirmed', httpStatus, booking }
  } catch {
    // Provider error bodies and exceptions can contain credentials or contact
    // data. Persist only the HTTP status; never print their URL or raw message.
    result = { status: 'unconfirmed', httpStatus }
  }
  await writeFile(
    path.join(directory, 'result.json'),
    JSON.stringify(result, null, 2),
    { flag: 'wx', mode: 0o600 },
  )
  if ('booking' in result && result.booking)
    await writeFile(
      path.join(directory, 'qr.png'),
      Buffer.from(result.booking.qrPng.split(',')[1], 'base64'),
      { flag: 'wx', mode: 0o600 },
    )
  return {
    environment: 'sandbox',
    runId,
    status: result.status,
    httpStatus,
    evidenceDirectory: directory,
    networkRequests: 1,
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const [flag = '--check', runId, ...extra] = process.argv.slice(2)
  if (
    !['--check', '--book', '--inspect'].includes(flag) ||
    extra.length ||
    (flag === '--check' && runId)
  ) {
    console.error(
      'Usage: postnord-sandbox.ts --check | --book RUN_ID | --inspect RUN_ID',
    )
    process.exitCode = 1
  } else {
    try {
      const result = await runPostNordSandbox({
        mode: flag.slice(2) as Options['mode'],
        runId,
      })
      // Inspection intentionally prints only the status and correlation ID.
      const summary =
        'attempt' in result
          ? {
              environment: result.environment,
              runId,
              messageId: result.attempt.messageId,
              status: result.result.status,
              httpStatus: result.result.httpStatus ?? null,
            }
          : result
      console.log(JSON.stringify(summary, null, 2))
      if (
        ('status' in summary && summary.status !== 'confirmed') ||
        ('configuration' in summary && summary.configuration !== 'ready')
      )
        process.exitCode = 1
    } catch (error) {
      console.error(
        (error as NodeJS.ErrnoException).code === 'EEXIST'
          ? 'This run has already been dispatched. Use --inspect; do not rebook an uncertain outcome.'
          : 'Sandbox check failed. Check local configuration and private evidence; no automatic retry was made.',
      )
      process.exitCode = 1
    }
  }
}
