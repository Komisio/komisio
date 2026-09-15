'use strict'
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS: Node's single-executable build takes a CommonJS entry. */
// Komisio Print: the program at the label printer. Paired once with a code
// from Settings, it signs in as its own anonymous user, holds the role
// `device` for one printer, and prints what the store queues to it. It has
// no dependencies: Node's fetch talks to Supabase Auth and PostgREST, and a
// TCP socket talks ZPL to the printer. Built into KomisioPrint.exe by the
// print-agent workflow; also runs as `node print-agent/agent.cjs <command>`.
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const readline = require('node:readline')

const VERSION = '1.0.0'
// Replaced by the build for each environment; the environment variables win.
const BUILT_URL = '__KOMISIO_SUPABASE_URL__'
const BUILT_KEY = '__KOMISIO_PUBLISHABLE_KEY__'

function configDir() {
  return process.env.KOMISIO_PRINT_HOME
    ? process.env.KOMISIO_PRINT_HOME
    : process.platform === 'win32' && process.env.ProgramData
      ? path.join(process.env.ProgramData, 'KomisioPrint')
      : path.join(os.homedir(), '.komisio-print')
}
function configPath() {
  return path.join(configDir(), 'device.json')
}
function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'))
  } catch {
    return null
  }
}
function writeConfig(config) {
  fs.mkdirSync(configDir(), { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), {
    mode: 0o600,
  })
}
function endpoint() {
  const url =
    process.env.KOMISIO_PRINT_SUPABASE_URL ||
    (BUILT_URL.startsWith('__') ? '' : BUILT_URL)
  const key =
    process.env.KOMISIO_PRINT_PUBLISHABLE_KEY ||
    (BUILT_KEY.startsWith('__') ? '' : BUILT_KEY)
  if (
    !/^https:\/\/[a-z0-9.-]+\.supabase\.co$|^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(
      url,
    ) ||
    !key
  )
    throw new Error(
      'This build carries no Komisio environment; set KOMISIO_PRINT_SUPABASE_URL and KOMISIO_PRINT_PUBLISHABLE_KEY',
    )
  return { url, key }
}
function log(message) {
  console.log(`${new Date().toISOString()} ${message}`)
}

async function authPost(url, key, pathname, body, token) {
  const response = await fetch(`${url}/auth/v1/${pathname}`, {
    method: 'POST',
    headers: {
      apikey: key,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok)
    throw new Error(
      `auth ${pathname}: ${data.error_description || data.msg || data.error || response.status}`,
    )
  return data
}
/** A new anonymous user for this device. Requires anonymous sign-ins on the project. */
async function signUpAnonymously(url, key) {
  const data = await authPost(url, key, 'signup', {})
  if (!data.access_token || !data.refresh_token)
    throw new Error('auth signup: no session (are anonymous sign-ins enabled?)')
  return { accessToken: data.access_token, refreshToken: data.refresh_token }
}
async function refresh(url, key, refreshToken) {
  const data = await authPost(url, key, 'token?grant_type=refresh_token', {
    refresh_token: refreshToken,
  })
  return { accessToken: data.access_token, refreshToken: data.refresh_token }
}
async function rpc(url, key, token, name, args) {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(args ?? {}),
    signal: AbortSignal.timeout(20000),
  })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!response.ok) {
    const code =
      data && typeof data === 'object' && typeof data.message === 'string'
        ? data.message
        : String(response.status)
    const error = new Error(code)
    error.status = response.status
    throw error
  }
  return data
}

function probe(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    socket.setTimeout(4000)
    socket.on('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.on('error', () => resolve(false))
    socket.on('timeout', () => {
      socket.destroy()
      resolve(false)
    })
  })
}
function sendZpl(host, port, payload) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port })
    socket.setTimeout(10000)
    socket.on('connect', () => socket.end(payload, 'utf8'))
    socket.on('close', () => resolve())
    socket.on('error', reject)
    socket.on('timeout', () => socket.destroy(new Error('printer timeout')))
  })
}
function splitAddress(address) {
  const [host, port] = String(address).split(':')
  return { host, port: Number(port || 9100) }
}

async function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer)
    }),
  )
}

async function pair(codeArg) {
  const { url, key } = endpoint()
  const existing = readConfig()
  if (existing?.refreshToken) {
    console.log(
      `Already paired with printer "${existing.printerName}". Run "unpair" first to pair again.`,
    )
    return 2
  }
  const code = (codeArg || (await ask('Pairing code from Settings: ')))
    .trim()
    .toUpperCase()
  if (!/^[0-9A-F]{5}-?[0-9A-F]{5}$/.test(code)) {
    console.error('The code has ten characters, for example 3F9A1-C07B2.')
    return 2
  }
  const session = await signUpAnonymously(url, key)
  const name = os.hostname().slice(0, 80)
  const paired = await rpc(url, key, session.accessToken, 'pair_print_device', {
    p_code: code,
    p_name: name,
    p_version: VERSION,
  })
  writeConfig({
    url,
    key,
    refreshToken: session.refreshToken,
    deviceId: paired.deviceId,
    tenantId: paired.tenantId,
    printerId: paired.printerId,
    printerName: paired.printerName,
    address: paired.address,
    pairedAt: new Date().toISOString(),
  })
  console.log(
    `Paired as "${name}" with printer "${paired.printerName}" at ${paired.address}. Configuration: ${configPath()}`,
  )
  return 0
}

async function run() {
  const config = readConfig()
  if (!config?.refreshToken) {
    console.error('Not paired. Run: KomisioPrint pair')
    return 2
  }
  const { url, key } = config
  let session = await refresh(url, key, config.refreshToken)
  writeConfig({ ...config, refreshToken: session.refreshToken })
  let context = await rpc(url, key, session.accessToken, 'print_device_context')
  let { host, port } = splitAddress(context.address)
  log(
    `Komisio Print ${VERSION}: printer "${context.printerName}" at ${host}:${port}`,
  )
  let lastHeartbeat = 0
  let lastRefresh = Date.now()
  let lastError = ''
  const call = async (name, args) => {
    try {
      return await rpc(url, key, session.accessToken, name, args)
    } catch (e) {
      if (e.status === 401) {
        session = await refresh(url, key, session.refreshToken)
        writeConfig({ ...readConfig(), refreshToken: session.refreshToken })
        return rpc(url, key, session.accessToken, name, args)
      }
      throw e
    }
  }
  let running = true
  const stop = () => {
    running = false
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  while (running) {
    try {
      if (Date.now() - lastRefresh > 45 * 60 * 1000) {
        session = await refresh(url, key, session.refreshToken)
        writeConfig({ ...readConfig(), refreshToken: session.refreshToken })
        lastRefresh = Date.now()
      }
      if (Date.now() - lastHeartbeat > 60 * 1000) {
        context = await call('print_device_context')
        ;({ host, port } = splitAddress(context.address))
        const reachable = await probe(host, port)
        await call('report_print_device', {
          p_status: {
            version: VERSION,
            printerReachable: reachable,
            error: lastError,
          },
        })
        lastHeartbeat = Date.now()
      }
      const job = await call('claim_print_job', {
        p_tenant: context.tenantId,
        p_printer: context.printerId,
      })
      if (!job) {
        await new Promise((r) => setTimeout(r, 3000))
        continue
      }
      let ok = true
      let error = ''
      try {
        for (let i = 0; i < job.copies; i++)
          await sendZpl(host, port, job.payload)
      } catch (e) {
        ok = false
        error = e instanceof Error ? e.message : 'print failed'
      }
      lastError = error
      await call('complete_print_job', {
        p_tenant: context.tenantId,
        p_job: job.jobId,
        p_ok: ok,
        p_error: error,
      })
      log(
        `${ok ? 'printed' : 'failed'} ${job.kind} ${job.jobId}${error ? ` (${error})` : ''}`,
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (
        /DEVICE_REVOKED|AUTH_REQUIRED|FORBIDDEN/.test(message) ||
        e.status === 403
      ) {
        log(
          'This device is disconnected from the store; pair it again from Settings.',
        )
        await new Promise((r) => setTimeout(r, 60 * 1000))
        return 3
      }
      lastError = message.slice(0, 200)
      log(`error: ${lastError}; retrying`)
      await new Promise((r) => setTimeout(r, 10000))
    }
  }
  return 0
}

function status() {
  const config = readConfig()
  if (!config) {
    console.log(`Not paired. Configuration would be written to ${configPath()}`)
    return 2
  }
  console.log(
    `Paired with printer "${config.printerName}" at ${config.address} (device ${config.deviceId}, since ${config.pairedAt}). Version ${VERSION}.`,
  )
  return 0
}
function unpair() {
  try {
    fs.rmSync(configPath())
    console.log(
      'Configuration removed. Disconnect the device in Settings as well.',
    )
  } catch {
    console.log('Nothing to remove.')
  }
  return 0
}

async function main() {
  const [command, arg] = process.argv.slice(2)
  switch (command) {
    case 'pair':
      return pair(arg)
    case 'run':
      return run()
    case 'status':
      return status()
    case 'unpair':
      return unpair()
    default:
      console.log(
        `Komisio Print ${VERSION}\n  KomisioPrint pair [code]   pair this computer with a printer (code from Settings)\n  KomisioPrint run           print what the store queues (the service runs this)\n  KomisioPrint status\n  KomisioPrint unpair`,
      )
      return command ? 2 : 0
  }
}

if (require.main === module)
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof Error ? e.message : String(e))
      process.exit(1)
    },
  )

module.exports = { configDir, splitAddress, VERSION }
