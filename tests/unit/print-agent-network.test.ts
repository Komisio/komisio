import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createTransport } = require('../../print-agent/agent.cjs') as {
  createTransport: (context: { transport: string; address: string }) => {
    probe: () => Promise<boolean>
    send: (job: { payload: string; copies: number }) => Promise<void>
  }
}

it('sends copies through the unchanged agent to a real loopback TCP listener', async () => {
  const received: string[] = []
  const server = createServer((socket) => {
    let data = ''
    socket.setEncoding('utf8')
    socket.on('data', (part) => {
      data += part
    })
    socket.on('end', () => {
      if (data) received.push(data)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No TCP port')
    const transport = createTransport({
      transport: 'tcp',
      address: `127.0.0.1:${address.port}`,
    })
    expect(await transport.probe()).toBe(true)
    const payload = '^XA^CI28^FDSynthetic ÅÄÖ^FS^XZ'
    await transport.send({ payload, copies: 2 })
    await expect.poll(() => received).toEqual([payload, payload])
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
