import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const agent = require('../../print-agent/agent.cjs') as {
  configDir: () => string
  splitAddress: (address: string) => { host: string; port: number }
  VERSION: string
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
})
