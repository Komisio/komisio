import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
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
  'reception-v4':
    '5b981d54ac56d6ca938dcdfe04f7c6987dca0be36e4983dd095df85dde45b858',
  'reception-v1':
    'e4f19410547cbb9504a3a0093377a5a65ec7a3cce8281282c029e5f4bed6a464',
  'reception-v2':
    '992cb8bd19692db0d9ba849a9a21502ceaa552557b82a890779c28829d341f35',
  // Same text as version two. What moved is the response shape: the seven
  // fixed keys left the schema, so the two versions are different contracts
  // and an attempt record has to say which one ran.
  'reception-v3':
    '992cb8bd19692db0d9ba849a9a21502ceaa552557b82a890779c28829d341f35',
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

// Database compatibility is exercised by the AI HTTP fixture: the runtime
// version must reserve an actual attempt before calling the fixture provider.
// Searching historical migration text cannot prove the installed function accepts it.

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
