import { X509Certificate } from 'node:crypto'
import { printerSetup } from './cli.mjs'

// Only PEM CA certificates may precede the credential commands. Never include
// arbitrary supplied bytes in a printer command stream or disable TLS checks.
export function validateCaBundle(value, now = Date.now()) {
  const fail = () => {
    throw new Error('PRINT_MANAGED_CA_INVALID')
  }
  if (typeof value !== 'string' || value.length > 12000) fail()
  const blocks = value.match(
    /-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----/g,
  )
  if (
    !blocks ||
    blocks.length > 5 ||
    value
      .replace(
        /-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----/g,
        '',
      )
      .trim()
  )
    fail()
  for (const block of blocks) {
    let cert
    try {
      cert = new X509Certificate(block)
    } catch {
      fail()
    }
    if (
      !cert.ca ||
      Date.parse(cert.validFrom) > now ||
      Date.parse(cert.validTo) <= now
    )
      fail()
  }
  return blocks.map((b) => b.replaceAll('\r\n', '\n')).join('\n') + '\n'
}

export function setupBundle(caBundle, host, credentials) {
  const certs = validateCaBundle(caBundle)
  return (
    `~DYE:WEBLINK1_CA.NRD,B,NRD,${Buffer.byteLength(certs)},,${certs}\r\n` +
    printerSetup(host, credentials)
  )
}
