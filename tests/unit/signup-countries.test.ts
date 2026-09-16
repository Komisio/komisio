import { describe, expect, it } from 'vitest'
import {
  signupBlocked,
  signupBlockedCountries,
  signupPath,
} from '../../lib/platform/signup-countries'

describe('countries that may open a new store', () => {
  it('reads a list of two-letter codes in any spelling', () => {
    expect(signupBlockedCountries(' in , cn ')).toEqual(['IN', 'CN'])
    expect(signupBlockedCountries('IN,CN')).toEqual(['IN', 'CN'])
  })
  it('ignores anything that is not a country code', () => {
    expect(signupBlockedCountries('IN,,SWE,x,CN')).toEqual(['IN', 'CN'])
    expect(signupBlockedCountries('*')).toEqual([])
  })
  it('refuses a named country and lets every other one through', () => {
    expect(signupBlocked('IN,CN', 'IN')).toBe(true)
    expect(signupBlocked('IN,CN', 'cn')).toBe(true)
    expect(signupBlocked('IN,CN', 'SE')).toBe(false)
    expect(signupBlocked('IN,CN', 'ES')).toBe(false)
  })
  it('blocks nothing until the deployment names a country', () => {
    expect(signupBlocked(undefined, 'IN')).toBe(false)
    expect(signupBlocked('', 'IN')).toBe(false)
    expect(signupBlocked('  ,  ', 'IN')).toBe(false)
  })
  it('fails open when the country is unknown', () => {
    // Self-hosted, local development, or any deployment not behind Vercel:
    // losing the ability to register would be far worse than letting one
    // unknown visitor through.
    expect(signupBlocked('IN,CN', null)).toBe(false)
    expect(signupBlocked('IN,CN', undefined)).toBe(false)
    expect(signupBlocked('IN,CN', '')).toBe(false)
    expect(signupBlocked('IN,CN', 'XX')).toBe(false)
  })
  it('covers the two pages that create a store and nothing else', () => {
    expect(signupPath('/register')).toBe(true)
    expect(signupPath('/onboarding')).toBe(true)
    expect(signupPath('/onboarding/')).toBe(true)
    // Signing in, the store itself and the seller's own pages stay open.
    expect(signupPath('/login')).toBe(false)
    expect(signupPath('/intake')).toBe(false)
    expect(signupPath('/')).toBe(false)
    expect(signupPath('/api/platform')).toBe(false)
    expect(signupPath('/registered-elsewhere')).toBe(false)
  })
})
