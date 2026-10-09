import { readFile, stat } from 'node:fs/promises'
import { evaluatePricing } from '../lib/assistance/pricing-evaluation'

// Explicit local input only. No database credentials, AI calls or network reads.
try {
  const file = process.argv[2]
  if (!file || process.argv.length !== 3) throw new Error('USAGE')
  const info = await stat(file)
  if (!info.isFile() || info.size > 2_000_000) throw new Error('INPUT_SIZE')
  const input: unknown = JSON.parse(await readFile(file, 'utf8'))
  console.log(JSON.stringify(evaluatePricing(input), null, 2))
} catch {
  // Do not echo customer input, paths, or schema-error values into shared logs.
  console.error(
    'Cannot evaluate pricing. Supply one valid local cohort JSON file (max 2 MB). See docs/PRICE-EVIDENCE.md.',
  )
  process.exitCode = 1
}
