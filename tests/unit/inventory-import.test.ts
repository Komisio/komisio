import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  inventoryColumns,
  inventoryFile,
  inventoryPrice,
  inspectInventoryRows,
  parseInventoryFile,
  previewInventoryImport,
} from '../../lib/engine/inventory-import'

const header = inventoryColumns.join(';')
const seller = '10000000-0000-4000-8000-000000000001'
const row = {
  line: 2,
  reference: '001',
  sellerId: '',
  email: 'seller@example.test',
  description: 'Blue shirt',
  price: '150,25',
  currency: 'SEK',
}
describe('inventory-file preflight', () => {
  it('reads BOM, quoted delimiters, escaped quotes and physical multiline row numbers', () => {
    const result = parseInventoryFile(
      '\uFEFF' +
        header +
        '\r\n001;;a@example.test;"Blue; \"\"shirt\"\"\nSmall";150,25;SEK\r\n002;;b@example.test;Coat;200;SEK',
      'test.csv',
    )
    expect(result.rows[0]).toMatchObject({
      line: 2,
      description: 'Blue; "shirt"\nSmall',
    })
    expect(result.rows[1].line).toBe(4)
    expect(
      parseInventoryFile(
        inventoryColumns.join(',') + '\n001,,a@example.test,Shirt,150.25,SEK',
        'test.csv',
      ).rows[0].price,
    ).toBe('150.25')
  })
  it('refuses malformed quotes, wrong columns, duplicate headers, blanks and oversized files without truncating', () => {
    for (const csv of [
      header + '\n001;;a@b.test;"unclosed;150;SEK',
      header + '\n001;;a@b.test;"closed"extra;150;SEK',
      header + '\n001;;a@b.test;bad"quote;150;SEK',
      header + '\n001;short',
      'reference;reference;email;description;price;currency\n1;2;a@b.test;Coat;10;SEK',
      header,
    ])
      expect(() => parseInventoryFile(csv, 'test.csv')).toThrow()
    expect(() =>
      parseInventoryFile(
        header + '\n' + Array(201).fill('001;;a@b.test;Coat;10;SEK').join('\n'),
        'test.csv',
      ),
    ).toThrow('TOO_MANY_ROWS')
    expect(() => parseInventoryFile('a'.repeat(500001), 'test.csv')).toThrow(
      'FILE_TOO_LARGE',
    )
  })
  it('never guesses thousands separators, rounds decimal precision or accepts nonpositive money', () => {
    for (const value of [
      '1,000',
      '1.000',
      '1 000',
      '1e2',
      '-20',
      '0',
      '0.00',
      'SEK 100',
      '9999999999',
      '100,1.2',
    ])
      expect(inventoryPrice(value)).toBeNull()
    expect(inventoryPrice('150,25')).toBe(15025)
    expect(inventoryPrice('150.2')).toBe(15020)
    expect(inventoryPrice('999999999.99')).toBe(99999999999)
    expect(inventoryPrice('0.01')).toBe(1)
  })
  it('marks both duplicate rows, missing metadata, bad seller references and mixed currencies', () => {
    const checked = inspectInventoryRows(
      {
        source: 'test.csv',
        rows: [
          row,
          {
            ...row,
            line: 3,
            reference: ' 001 ',
            description: '',
            price: '0',
            currency: 'EUR',
            email: '',
            sellerId: 'bad',
          },
        ],
      },
      'SEK',
    )
    expect(checked[0].issues).toEqual(['duplicate'])
    expect(checked[1].issues).toEqual([
      'duplicate',
      'description',
      'price',
      'currency',
      'sellerReference',
    ])
    expect(checked[1].lookup).toBeNull()
    expect(
      inspectInventoryRows(
        {
          source: 'test.csv',
          rows: [{ ...row, sellerId: seller, email: ' SELLER@EXAMPLE.TEST ' }],
        },
        'SEK',
      )[0].lookup,
    ).toEqual({ sellerId: seller, email: 'seller@example.test' })
  })
  it('requires distinct row identities and bounded input', () => {
    expect(
      inventoryFile.safeParse({ source: 'x', rows: [row, row] }).success,
    ).toBe(false)
    expect(
      inventoryFile.safeParse({
        source: 'x',
        rows: [{ ...row, description: 'x'.repeat(2001) }],
      }).success,
    ).toBe(false)
  })
  it('checks one exact caller-scoped lookup and returns every row, never silently omitting failures', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: 'SEK' })
      .mockResolvedValueOnce({
        data: [
          { status: 'matched', id: seller, name: 'Seller' },
          { status: 'ambiguous' },
        ],
      })
    const client = { rpc } as unknown as SupabaseClient
    const result = await previewInventoryImport(client, seller, {
      source: 'x',
      rows: [
        row,
        { ...row, line: 3, reference: '002' },
        { ...row, line: 4, reference: '003', email: '' },
      ],
    })
    expect(result.rows).toHaveLength(3)
    expect(result.rows[0]).toMatchObject({ priceOre: 15025, issues: [] })
    expect(result.rows[1].issues).toEqual(['ambiguous'])
    expect(result.rows[2].issues).toEqual(['sellerReference'])
    expect(rpc.mock.calls[1]).toEqual([
      'inventory_import_sellers',
      {
        p_tenant: seller,
        p_rows: [
          { sellerId: '', email: row.email },
          { sellerId: '', email: row.email },
        ],
      },
    ])
  })
  it('fails closed on missing lookup results and permission failures', async () => {
    for (const reply of [{ data: [] }, { error: { message: 'FORBIDDEN' } }]) {
      const rpc = vi
        .fn()
        .mockResolvedValueOnce({ data: 'SEK' })
        .mockResolvedValueOnce(reply)
      await expect(
        previewInventoryImport({ rpc } as unknown as SupabaseClient, seller, {
          source: 'x',
          rows: [row],
        }),
      ).rejects.toThrow()
    }
  })
})
