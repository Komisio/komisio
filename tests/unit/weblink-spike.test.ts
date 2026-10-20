import { afterEach, describe, expect, it } from 'vitest'
import { request } from 'node:http'
import {
  MAIN,
  RAW,
  startWeblinkExperiment,
} from '../../scripts/print-spike/weblink.mjs'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close()
})
function message(socket: WebSocket) {
  return new Promise<string>((resolve) =>
    socket.addEventListener(
      'message',
      (event) =>
        resolve(Buffer.from(event.data as ArrayBuffer).toString('utf8')),
      { once: true },
    ),
  )
}
async function connect(url: string, protocol: string) {
  const socket = new WebSocket(url, protocol)
  socket.binaryType = 'arraybuffer'
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true })
    socket.addEventListener('error', () => reject(new Error('Refused')), {
      once: true,
    })
  })
  return socket
}
async function paired() {
  const experiment = await startWeblinkExperiment()
  cleanups.push(experiment.close)
  const main = await connect(experiment.url, MAIN)
  const opened = message(main)
  main.send(Buffer.from(JSON.stringify({ discovery_b64: 'U1lOVEhFVElD' })))
  expect(JSON.parse(await opened)).toEqual({ open: RAW })
  const raw = await connect(experiment.url, RAW)
  const status = message(raw)
  raw.send(
    Buffer.from(
      JSON.stringify({
        unique_id: 'SYNTHETIC-PRINTER',
        channel_name: RAW,
        channel_id: '2',
      }),
    ),
  )
  expect(await status).toBe('~HS\r\n')
  raw.send(Buffer.from('\x02000,0,0,0000,000,0,0,0,000,0,0,0\x03\r\n'))
  await expect.poll(() => experiment.snapshot().reachable).toBe(true)
  return { experiment, main, raw }
}
describe('loopback-only Weblink protocol experiment', () => {
  it('adds the Zebra upgrade header and agrees the exact subprotocol', async () => {
    const experiment = await startWeblinkExperiment()
    cleanups.push(experiment.close)
    const headers = await new Promise<import('node:http').IncomingHttpHeaders>(
      (resolve, reject) => {
        const req = request(experiment.url.replace('ws:', 'http:'), {
          headers: {
            Upgrade: 'websocket',
            Connection: 'Upgrade',
            'Sec-WebSocket-Key': Buffer.alloc(16, 1).toString('base64'),
            'Sec-WebSocket-Version': '13',
            'Sec-WebSocket-Protocol': MAIN,
          },
        })
        req.on('upgrade', (response, socket) => {
          resolve(response.headers)
          socket.destroy()
        })
        req.on('error', reject)
        req.end()
      },
    )
    expect(headers['content-length']).toBe('0')
    expect(headers['sec-websocket-protocol']).toBe(MAIN)
  })
  it('opens main/raw binary channels and transmits copies without rewriting ZPL', async () => {
    const { experiment, raw } = await paired()
    const received: string[] = []
    raw.addEventListener('message', (event) =>
      received.push(Buffer.from(event.data as ArrayBuffer).toString('utf8')),
    )
    const payload = '^XA^CI28^FDRöd jacka^FS^XZ'
    await experiment.submit({ id: 'synthetic-job', payload, copies: 2 })
    await expect.poll(() => received).toEqual([payload, payload])
    expect(experiment.snapshot().jobs[0].state).toBe('submitted')
    await expect(
      experiment.submit({ id: 'synthetic-job', payload }),
    ).rejects.toThrow('ALREADY_ATTEMPTED')
  })
  it('holds uncertain output across disconnect and refuses revoked connections', async () => {
    const { experiment, main } = await paired()
    await experiment.submit({ id: 'job', payload: '^XA^XZ' })
    main.close()
    await expect
      .poll(() => experiment.snapshot().jobs[0].state)
      .toBe('outcome_unknown')
    expect(experiment.snapshot().reachable).toBe(false)
    experiment.revoke()
    await expect(connect(experiment.url, MAIN)).rejects.toThrow('Refused')
    await expect(
      experiment.submit({ id: 'new-job', payload: '^XA^XZ' }),
    ).rejects.toThrow('PRINTER_UNAVAILABLE')
  })
  it('rejects unauthorized channels, text frames and a wrong raw printer identity', async () => {
    const experiment = await startWeblinkExperiment()
    cleanups.push(experiment.close)
    await expect(
      connect(experiment.url.replace(/fixture=.*/, 'fixture=wrong'), MAIN),
    ).rejects.toThrow()
    const main = await connect(experiment.url, MAIN)
    const closed = new Promise<number>((resolve) =>
      main.addEventListener('close', (e) => resolve(e.code)),
    )
    main.send('{}')
    expect(await closed).toBe(1003)
    const nextMain = await connect(experiment.url, MAIN)
    const opened = message(nextMain)
    nextMain.send(Buffer.from('{"discovery_b64":"U1lOVEhFVElD"}'))
    await opened
    const raw = await connect(experiment.url, RAW)
    const rawClosed = new Promise<number>((resolve) =>
      raw.addEventListener('close', (e) => resolve(e.code)),
    )
    raw.send(
      Buffer.from(
        JSON.stringify({
          unique_id: 'other',
          channel_name: RAW,
          channel_id: '2',
        }),
      ),
    )
    expect(await rawClosed).toBe(1008)
    expect(experiment.snapshot().reachable).toBe(false)
  })
})
