import { describe, it, expect, vi } from 'vitest'
import { createWorkActivity } from '../../lib/platform/work-activity'

describe('shared work lifetime', () => {
  it('does not hide other active work when one request completes or is released twice', () => {
    const work = createWorkActivity()
    const first = work.start()
    const second = work.start()
    expect(work.snapshot()).toBe(2)
    first()
    first()
    expect(work.snapshot()).toBe(1)
    second()
    expect(work.snapshot()).toBe(0)
  })
  it('releases failed work and allows later work without notifying removed observers', async () => {
    const work = createWorkActivity()
    const listener = vi.fn()
    const unsubscribe = work.subscribe(listener)
    const finish = work.start()
    try {
      await Promise.reject(new Error('NETWORK_FAILED'))
    } catch {
    } finally {
      finish()
    }
    expect(work.snapshot()).toBe(0)
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    const retry = work.start()
    expect(work.snapshot()).toBe(1)
    retry()
    expect(work.snapshot()).toBe(0)
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
