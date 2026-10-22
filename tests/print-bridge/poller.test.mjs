import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pollWeblinkService } from '../../scripts/print-bridge/poller.mjs'

test(
  'polling serializes claims and stops intake permanently after uncertainty',
  { timeout: 4000 },
  async () => {
    const stop = new AbortController()
    let calls = 0,
      active = 0,
      reports = 0,
      closed = 0
    const states = []
    await pollWeblinkService({
      pollMs: 100,
      reportMs: 100,
      signal: stop.signal,
      onState: (value) => states.push(value.state),
      service: {
        status: () => ({ connected: true }),
        runOnce: async () => {
          assert.equal(active++, 0)
          calls++
          await new Promise((resolve) => setTimeout(resolve, 120))
          active--
          return { state: calls === 1 ? 'empty' : 'outcome_unknown' }
        },
        reportStatus: async (held) => {
          reports++
          if (reports === 4) {
            assert.equal(held, true)
            stop.abort()
          }
        },
        close: async () => {
          closed++
        },
      },
    })
    assert.deepEqual(states, ['idle', 'held'])
    assert.equal(calls, 2)
    assert.equal(closed, 1)
  },
)

test(
  'disconnected printers cannot claim; heartbeat failures do not create duplicate loops',
  { timeout: 4000 },
  async () => {
    const stop = new AbortController()
    let reports = 0,
      closed = false
    const states = []
    await pollWeblinkService({
      pollMs: 100,
      reportMs: 100,
      signal: stop.signal,
      onState: (value) => states.push(value.state),
      service: {
        status: () => ({ connected: false }),
        runOnce: () => assert.fail('disconnected'),
        reportStatus: async () => {
          if (++reports === 3) stop.abort()
          throw Error('provider secret')
        },
        close: async () => {
          closed = true
        },
      },
    })
    assert.deepEqual(states, ['waiting'])
    assert.equal(closed, true)
  },
)

test(
  'unexpected worker failures halt connected intake and invalid intervals refuse startup',
  { timeout: 4000 },
  async () => {
    const stop = new AbortController()
    let calls = 0
    const service = {
      status: () => ({ connected: true }),
      runOnce: async () => {
        calls++
        throw Error('disk failure')
      },
      close: async () => {},
      reportStatus: async (held) => {
        assert.equal(held, true)
        stop.abort()
      },
    }
    for (const pollMs of [0, -1, 1, 60001, 1.5])
      await assert.rejects(
        pollWeblinkService({ service, signal: stop.signal, pollMs }),
        /INVALID_PRINT_POLLER/,
      )
    await pollWeblinkService({ service, signal: stop.signal, pollMs: 100 })
    assert.equal(calls, 1)
  },
)
