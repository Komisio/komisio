import { createServer } from 'node:http'
// A loopback simulator of the pinned provider contract, never a real agreement.
let entries = [],
  voucher,
  posts = 0,
  mode = 'normal'
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:3468')
  const json = (body, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  if (url.pathname === '/health') return json({ ready: true })
  if (url.pathname === '/control') {
    if (req.method === 'POST') mode = url.searchParams.get('mode') ?? 'normal'
    return json({ posts, mode, entries })
  }
  if (
    req.headers['x-appsecrettoken'] !== 'synthetic-economic-secret' ||
    req.headers['x-agreementgranttoken'] !== 'synthetic-economic-grant'
  )
    return json({}, 401)
  if (mode === 'revoked') return json({}, 401)
  if (mode === 'denied') return json({}, 403)
  if (url.pathname === '/self')
    return json({
      agreementNumber: 123456,
      company: {
        name: 'Synthetic Danish store',
        companyIdentificationNumber: '12345678',
      },
      settings: { baseCurrency: 'DKK' },
    })
  if (url.pathname === '/accounts')
    return json({
      collection: [10000, 30000, 40000].map((accountNumber) => ({
        accountNumber,
        name: `Synthetic ${accountNumber}`,
        accountType: 'status',
      })),
    })
  if (url.pathname === '/vat-accounts')
    return json({
      collection: [
        { vatCode: 'Z0', name: 'Explicit VAT', ratePercentage: 0 },
        { vatCode: 'U25', name: 'Automatic VAT', ratePercentage: 25 },
      ],
    })
  if (url.pathname === '/accounting-years')
    return json({
      collection: [
        { year: '2020', fromDate: '2020-01-01', toDate: '2020-12-31' },
      ],
    })
  if (url.pathname === '/journalsapi/v16.0.1/journals')
    return json({
      items: [
        {
          number: 1,
          name: 'Daily drafts',
          isStandingJournal: false,
          allowedEntryType: 5,
        },
      ],
    })
  if (url.pathname === '/journals/1/vouchers' && req.method === 'POST') {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > 32768) return json({}, 413)
      chunks.push(chunk)
    }
    const body = JSON.parse(Buffer.concat(chunks).toString())
    if (
      body.accountingYear?.year !== '2020' ||
      body.journal?.journalNumber !== 1 ||
      body.voucherNumber !== undefined ||
      !Array.isArray(body.entries?.financeVouchers) ||
      body.entries.financeVouchers.some(
        (row) =>
          row.entryType !== 'financeVoucher' ||
          row.currency?.code !== 'DKK' ||
          row.vatAccount?.vatCode !== 'Z0' ||
          row.voucher !== undefined,
      )
    )
      return json({}, 400)
    posts++
    entries = body.entries.financeVouchers.map((row, index) => ({
      ...row,
      voucher: { voucherNumber: mode === 'multiple' ? 42 + index : 42 },
    }))
    voucher = {
      ...body,
      voucherNumber: 42,
      entries: { financeVouchers: entries },
    }
    if (mode === 'lost') {
      req.socket.destroy()
      return
    }
    if (mode === 'malformed') return json({}, 201)
    return json(voucher, 201)
  }
  if (url.pathname === '/journals/1/vouchers/2020-42' && req.method === 'GET')
    return json(voucher)
  return json({ error: 'Unimplemented simulator endpoint' }, 404)
})
server.listen(3468, '127.0.0.1')
