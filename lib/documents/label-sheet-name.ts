export function labelSheetDisposition(
  sellerName: string | null | undefined,
  download: boolean,
  now = new Date(),
) {
  const date = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  const name = Array.from(
    (sellerName ?? '')
      .normalize('NFC')
      .replace(
        /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>:"/\\|?*]/g,
        ' ',
      )
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[. ]+|[. ]+$/g, ''),
  )
    .slice(0, 100)
    .join('')
    .trim()
  const filename = `${name || 'komisio-labels'} ${date}.pdf`
  const ascii = filename
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  )
  return `${download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encoded}`
}
