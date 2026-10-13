import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { compileUsb } from './build-usb.mjs'

compileUsb('UsbSpoolerTests.exe', [
  '/main:UsbSpoolerTests',
  'print-agent/usb-spooler-tests.cs',
])
execFileSync('print-agent/dist/UsbSpoolerTests.exe', [], {
  stdio: 'inherit',
  windowsHide: true,
})
function request(input) {
  const result = spawnSync('print-agent/dist/KomisioUsb.exe', [], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
  })
  assert.equal(result.error, undefined)
  return { status: result.status, body: JSON.parse(result.stdout) }
}
// Only enumerate/probe real Windows queues. No physical output or installation.
const list = request({ operation: 'list' })
assert.equal(list.status, 0)
assert.equal(list.body.ok, true)
assert.ok(Array.isArray(list.body.printers))
for (const input of [
  { operation: 'probe', printer: '\\\\server\\queue' },
  { operation: 'probe', printer: 'Komisio-nonexistent-test-queue-397e7455' },
  { operation: 'print', printer: 'not-used', data: '', copies: 1 },
  { operation: 'print', printer: 'not-used', data: 'WA==', copies: 21 },
  { operation: 'shell', printer: 'not-used' },
]) {
  const result = request(input)
  assert.equal(result.status, 1)
  assert.equal(result.body.ok, false)
  assert.match(result.body.error, /^USB_/)
}
console.log('Windows USB bridge smoke passed; no labels printed')
