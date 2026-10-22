import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rootCertificates } from 'node:tls'
import { X509Certificate } from 'node:crypto'
import {
  setupBundle,
  validateCaBundle,
} from '../../scripts/print-bridge/setup-bundle.mjs'

const pem = rootCertificates.find((value) => {
  const cert = new X509Certificate(value)
  return (
    cert.ca &&
    Date.parse(cert.validFrom) < Date.now() &&
    Date.parse(cert.validTo) > Date.now()
  )
})
test('installation file contains only the validated trust bundle and scoped authenticated endpoint', () => {
  const ca = validateCaBundle(pem)
  const scope = {
    tenantId: '10000000-0000-4000-8000-000000000001',
    printerId: '20000000-0000-4000-8000-000000000002',
    deviceId: '30000000-0000-4000-8000-000000000003',
    password: 'a'.repeat(43),
  }
  const value = setupBundle(pem, 'print.example.com', scope)
  assert.ok(
    value.startsWith(
      `~DYE:WEBLINK1_CA.NRD,B,NRD,${Buffer.byteLength(ca)},,${ca}\r\n`,
    ),
  )
  assert.ok(
    value.includes(`https://print.example.com/weblink/${scope.deviceId}`),
  )
  assert.equal(value.includes('device.reset'), false)
  assert.equal(value.includes('verify'), false)
})
test('invalid, expired and command-bearing trust files fail closed', () => {
  for (const value of [
    '',
    'secret',
    pem + '\n^XA^FDunexpected^FS^XZ',
    pem.repeat(6),
    pem + '\n-----BEGIN PRIVATE KEY-----',
  ])
    assert.throws(() => validateCaBundle(value), /CA_INVALID/)
  assert.throws(
    () =>
      validateCaBundle(pem, Date.parse(new X509Certificate(pem).validTo) + 1),
    /CA_INVALID/,
  )
  assert.throws(
    () =>
      validateCaBundle(pem, Date.parse(new X509Certificate(pem).validFrom) - 1),
    /CA_INVALID/,
  )
})
