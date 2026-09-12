import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { it, expect } from 'vitest'
import {
  receptionInstructions,
  receptionPromptVersion,
} from '../../lib/assistance/openai-reception'

// The runtime prompt is versioned. Attempt records store the version, so a
// wording change under an unchanged version would silently mix two prompts in
// the same operational history. When the text changes on purpose: bump
// receptionPromptVersion, add an additive migration that accepts the new
// version in reserve_reception_assistance, review the skill, then update the
// pinned hash below.
const pinned: Record<string, string> = {
  'reception-v1':
    'e4f19410547cbb9504a3a0093377a5a65ec7a3cce8281282c029e5f4bed6a464',
}

it('pins the exact prompt text to its version', () => {
  const hash = createHash('sha256').update(receptionInstructions).digest('hex')
  expect(
    pinned[receptionPromptVersion],
    `No pinned hash for ${receptionPromptVersion}; add it after reviewing the prompt`,
  ).toBeDefined()
  expect(
    hash,
    `Prompt text changed without bumping receptionPromptVersion (${receptionPromptVersion})`,
  ).toBe(pinned[receptionPromptVersion])
})

it('is accepted by the database attempt reservation', () => {
  // reserve_reception_assistance pins the prompt version in SQL; a bump needs a migration.
  const migrations = readdirSync('supabase/migrations')
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8'))
    .join('\n')
  expect(migrations).toContain(`'${receptionPromptVersion}'`)
})

it('keeps the skill and the prompt on the same rules', () => {
  const skill = readFileSync('skills/garment-reception/SKILL.md', 'utf8')
  // Each rule the prompt enforces must be stated for people and agents too.
  for (const rule of [
    'untrusted',
    'identity',
    'price evidence',
    'tentative',
    'commission',
  ])
    expect(skill.toLowerCase(), `skill no longer mentions "${rule}"`).toContain(
      rule,
    )
  for (const rule of ['untrusted', 'identity', 'price-evidence', 'commission'])
    expect(receptionInstructions.toLowerCase()).toContain(rule)
})
