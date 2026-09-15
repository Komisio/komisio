import { describe, expect, it } from 'vitest'
import {
  guessMapping,
  importSellersPayload,
  mapRows,
  parseCsv,
  stageImportCommand,
} from '../../lib/engine/import-sellers'

describe('import sellers', () => {
  it('parses comma and semicolon files with quotes and CRLF', () => {
    expect(parseCsv('name,email\r\n"Berg, Bo",bo@x.test\r\n')).toEqual([
      ['name', 'email'],
      ['Berg, Bo', 'bo@x.test'],
    ])
    expect(parseCsv('Namn;E-post;Telefon\nAnna;anna@x.test;070\n\n')).toEqual([
      ['Namn', 'E-post', 'Telefon'],
      ['Anna', 'anna@x.test', '070'],
    ])
    expect(parseCsv('a,b\n"say ""hi""",c')).toEqual([
      ['a', 'b'],
      ['say "hi"', 'c'],
    ])
    expect(parseCsv('﻿name\nx')).toEqual([['name'], ['x']])
  })
  it('guesses the mapping from Swedish and English headers', () => {
    expect(guessMapping(['Inlämnare', 'E-post', 'Mobil'])).toEqual({
      name: 0,
      email: 1,
      phone: 2,
    })
    expect(guessMapping(['Customer name', 'Phone number'])).toEqual({
      name: 0,
      email: null,
      phone: 1,
    })
    expect(guessMapping(['a', 'b'])).toEqual({
      name: null,
      email: null,
      phone: null,
    })
  })
  it('maps rows, lower-cases e-mail and reports why a row is left out', () => {
    const rows = [
      ['Namn', 'E-post', 'Telefon'],
      ['Anna', 'ANNA@x.test', ''],
      ['', 'no@name.test', ''],
      ['Bo', '', ''],
      ['Cia', 'bad', ''],
      ['Dan', '', '070 1'],
    ]
    const r = mapRows(rows, { name: 0, email: 1, phone: 2 }, true)
    expect(r.accepted).toEqual([
      { name: 'Anna', email: 'anna@x.test', phone: '' },
      { name: 'Dan', email: '', phone: '070 1' },
    ])
    expect(r.rejected).toEqual([
      { line: 3, reason: 'name' },
      { line: 4, reason: 'contact' },
      { line: 5, reason: 'email' },
    ])
    expect(
      mapRows(rows, { name: 0, email: 1, phone: 2 }, false).rejected[0],
    ).toEqual({ line: 1, reason: 'email' })
  })
  it('bounds the payload and the command', () => {
    const row = { name: 'A', email: 'a@x.test', phone: '' }
    expect(
      importSellersPayload.safeParse({ source: 'old.csv', rows: [row] })
        .success,
    ).toBe(true)
    expect(
      importSellersPayload.safeParse({ source: 'old.csv', rows: [] }).success,
    ).toBe(false)
    expect(
      importSellersPayload.safeParse({
        source: 'old.csv',
        rows: Array(201).fill(row),
      }).success,
    ).toBe(false)
    expect(
      importSellersPayload.safeParse({ source: '', rows: [row] }).success,
    ).toBe(false)
    expect(
      stageImportCommand.safeParse({
        tenantId: '10000000-0000-4000-8000-000000000001',
        requestId: '10000000-0000-4000-8000-000000000002',
        expiresAt: '2026-09-16T00:00:00Z',
        payload: { source: 'old.csv', rows: [row] },
      }).success,
    ).toBe(true)
  })
})
