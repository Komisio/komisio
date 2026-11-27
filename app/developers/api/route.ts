export function GET() {
  return new Response(
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Store API reference · Komisio</title>
<link rel="stylesheet" href="/developers/api/assets/swagger-ui.css">
</head><body><main id="swagger-ui"></main><noscript>Enable JavaScript for the interactive reference or <a href="/store-api/v1/openapi.json">download the OpenAPI specification</a>.</noscript>
<script defer src="/developers/api/assets/swagger-ui-bundle.js"></script>
<script defer src="/store-api/reference.js"></script></body></html>`,
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy':
          "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        'Referrer-Policy': 'no-referrer',
      },
    },
  )
}
