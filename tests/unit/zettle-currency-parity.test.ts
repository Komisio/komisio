import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { storeCurrencies } from '../../lib/platform/currencies'

it('runs the database currency guard for exactly the application currency set', () => {
  const sql = readFileSync(
    new URL(
      '../../supabase/tests/0360_zettle_currency_matrix.test.sql',
      import.meta.url,
    ),
    'utf8',
  )
  const list = sql.match(/jsonb_array_elements_text\('([^']+)'::jsonb\)/)?.[1]
  expect(list).toBeDefined()
  expect(JSON.parse(list!)).toEqual([...storeCurrencies])
})
