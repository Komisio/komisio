import { describe, expect, it } from 'vitest'
import { onboardingSteps } from '../../lib/engine/onboarding'

const empty = {
  profileName: false,
  policyVersions: 0,
  agreementVersions: 0,
  sellers: 0,
  items: 0,
  sales: 0,
  dayCloses: 0,
  fortnoxConnected: false,
  zettleConnections: 0,
  members: 1,
}

describe('onboarding steps', () => {
  it('marks account and store done for a fresh store and nothing else', () => {
    const steps = onboardingSteps(empty)
    expect(steps.map((s) => s.key)).toEqual([
      'account',
      'store',
      'profile',
      'policy',
      'agreement',
      'seller',
      'item',
      'sale',
      'dayClose',
      'integrations',
      'team',
    ])
    expect(steps.filter((s) => s.done).map((s) => s.key)).toEqual([
      'account',
      'store',
    ])
  })
  it('treats unknown counts as not done and either integration as done', () => {
    const unknown = onboardingSteps({
      ...empty,
      sellers: null,
      fortnoxConnected: null,
      zettleConnections: null,
    })
    expect(unknown.find((s) => s.key === 'seller')?.done).toBe(false)
    expect(unknown.find((s) => s.key === 'integrations')?.done).toBe(false)
    expect(
      onboardingSteps({ ...empty, fortnoxConnected: true }).find(
        (s) => s.key === 'integrations',
      )?.done,
    ).toBe(true)
    expect(
      onboardingSteps({ ...empty, zettleConnections: 1 }).find(
        (s) => s.key === 'integrations',
      )?.done,
    ).toBe(true)
  })
  it('completes the whole list for a running store', () => {
    const all = onboardingSteps({
      profileName: true,
      policyVersions: 2,
      agreementVersions: 1,
      sellers: 5,
      items: 40,
      sales: 12,
      dayCloses: 3,
      fortnoxConnected: true,
      zettleConnections: 1,
      members: 3,
    })
    expect(all.every((s) => s.done)).toBe(true)
  })
})
