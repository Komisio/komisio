import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const agent = require('../../print-agent/agent.cjs') as {
  configDir: () => string
  splitAddress: (address: string) => { host: string; port: number }
  VERSION: string
  createTransport: (
    context: { transport: string; address: string },
    dependencies?: {
      usbRequest?: (
        request: Record<string, unknown>,
      ) => Promise<{ jobId?: number }>
      sendZpl?: (host: string, port: number, payload: string) => Promise<void>
      probe?: (host: string, port: number) => Promise<boolean>
    },
  ) => {
    probe: () => Promise<boolean>
    send: (job: { payload: string; copies: number }) => Promise<void>
  }
}

describe('Komisio Print', () => {
  it('reads the printer address with a default port', () => {
    expect(agent.splitAddress('192.168.1.49:9100')).toEqual({
      host: '192.168.1.49',
      port: 9100,
    })
    expect(agent.splitAddress('printer.local')).toEqual({
      host: 'printer.local',
      port: 9100,
    })
  })
  it('keeps its configuration where the service can read it', () => {
    expect(agent.configDir()).toMatch(/KomisioPrint|\.komisio-print/)
    expect(agent.VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
  it('sends the original UTF-8 ZPL and copy count to the exact USB queue as data', async () => {
    const usbRequest = vi.fn().mockResolvedValue({ jobId: 42 })
    const sendZpl = vi.fn()
    const name = "ZDesigner 'Åäö' & echo"
    const payload = '^XA^CI28^FDRöd tröja^FS^XZ'
    const transport = agent.createTransport(
      { transport: 'usb', address: name },
      { usbRequest, sendZpl },
    )
    expect(await transport.probe()).toBe(true)
    expect(usbRequest).toHaveBeenNthCalledWith(1, {
      operation: 'probe',
      printer: name,
    })
    await transport.send({ payload, copies: 3 })
    expect(usbRequest).toHaveBeenNthCalledWith(2, {
      operation: 'print',
      printer: name,
      copies: 3,
      data: Buffer.from(payload, 'utf8').toString('base64'),
    })
    expect(sendZpl).not.toHaveBeenCalled()
  })
  it('never falls back to another printer or retries an uncertain USB submission', async () => {
    const usbRequest = vi
      .fn()
      .mockRejectedValue(new Error('USB_RESULT_UNKNOWN'))
    const sendZpl = vi.fn()
    const transport = agent.createTransport(
      { transport: 'usb', address: 'Synthetic USB' },
      { usbRequest, sendZpl },
    )
    await expect(
      transport.send({ payload: '^XA^XZ', copies: 1 }),
    ).rejects.toThrow('USB_RESULT_UNKNOWN')
    expect(usbRequest).toHaveBeenCalledTimes(1)
    expect(sendZpl).not.toHaveBeenCalled()
    usbRequest.mockResolvedValue({})
    await expect(
      transport.send({ payload: '^XA^XZ', copies: 1 }),
    ).rejects.toThrow('USB_RESULT_UNKNOWN')
  })
  it('rejects invalid USB targets and oversized jobs before invoking Windows', async () => {
    for (const address of ['', '\\\\server\\queue', 'queue\ncommand'])
      expect(() =>
        agent.createTransport({ transport: 'usb', address }),
      ).toThrow('USB_INVALID_QUEUE_NAME')
    const usbRequest = vi.fn()
    const transport = agent.createTransport(
      { transport: 'usb', address: 'Synthetic USB' },
      { usbRequest },
    )
    for (const job of [
      { payload: '', copies: 1 },
      { payload: 'x'.repeat(80001), copies: 1 },
      { payload: 'x', copies: 21 },
      { payload: 'x', copies: 1.5 },
    ])
      await expect(transport.send(job)).rejects.toThrow('USB_INVALID_JOB')
    expect(usbRequest).not.toHaveBeenCalled()
    expect(() =>
      agent.createTransport({ transport: 'unknown', address: '' }),
    ).toThrow('Unsupported')
  })
  it('retains network transport and stops copies on a network failure', async () => {
    const sendZpl = vi.fn().mockResolvedValue(undefined)
    const probe = vi.fn().mockResolvedValue(true)
    const usbRequest = vi.fn()
    const transport = agent.createTransport(
      { transport: 'tcp', address: 'printer.local:9200' },
      { sendZpl, probe, usbRequest },
    )
    expect(await transport.probe()).toBe(true)
    expect(probe).toHaveBeenCalledWith('printer.local', 9200)
    await transport.send({ payload: '^XA^XZ', copies: 2 })
    expect(sendZpl).toHaveBeenCalledTimes(2)
    expect(sendZpl).toHaveBeenLastCalledWith('printer.local', 9200, '^XA^XZ')
    sendZpl.mockClear().mockRejectedValue(new Error('offline'))
    await expect(
      transport.send({ payload: '^XA^XZ', copies: 3 }),
    ).rejects.toThrow('offline')
    expect(sendZpl).toHaveBeenCalledTimes(1)
    expect(usbRequest).not.toHaveBeenCalled()
  })
})
