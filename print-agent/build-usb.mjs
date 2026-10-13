import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

if (process.platform !== 'win32')
  throw new Error('Build the USB helper on Windows')
const dist = join('print-agent', 'dist')
mkdirSync(dist, { recursive: true })
const compiler = join(
  process.env.SystemRoot || 'C:\\Windows',
  'Microsoft.NET',
  'Framework64',
  'v4.0.30319',
  'csc.exe',
)
export function compileUsb(output, extra = []) {
  execFileSync(
    compiler,
    [
      '/nologo',
      '/target:exe',
      '/platform:x64',
      '/optimize+',
      '/reference:System.Web.Extensions.dll',
      `/out:${resolve(dist, output)}`,
      resolve('print-agent/usb-spooler.cs'),
      ...extra.map((arg) => (arg.endsWith('.cs') ? resolve(arg) : arg)),
    ],
    { stdio: 'inherit', windowsHide: true },
  )
}
compileUsb('KomisioUsb.exe')
