import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// User metadata selects presentation only. It never grants authority.
export const confirmationCopy = {
  en: [
    'Confirm your email address',
    'Welcome to Komisio! Confirm your email address to finish creating your account.',
    'Confirm email address',
    'If you did not create this account, you can ignore this email.',
  ],
  sv: [
    'Verifiera din e-postadress',
    'Välkommen till Komisio! Verifiera din e-postadress för att slutföra registreringen.',
    'Verifiera e-postadress',
    'Om du inte har skapat kontot kan du bortse från det här mailet.',
  ],
  no: [
    'Bekreft e-postadressen din',
    'Velkommen til Komisio! Bekreft e-postadressen din for å fullføre registreringen.',
    'Bekreft e-postadresse',
    'Hvis du ikke har opprettet kontoen, kan du se bort fra denne e-posten.',
  ],
  dk: [
    'Bekræft din e-mailadresse',
    'Velkommen til Komisio! Bekræft din e-mailadresse for at afslutte oprettelsen af din konto.',
    'Bekræft e-mailadresse',
    'Hvis du ikke har oprettet kontoen, kan du se bort fra denne e-mail.',
  ],
  fi: [
    'Vahvista sähköpostiosoitteesi',
    'Tervetuloa Komisioon! Vahvista sähköpostiosoitteesi viimeistelläksesi tilin luomisen.',
    'Vahvista sähköpostiosoite',
    'Jos et luonut tätä tiliä, voit jättää tämän viestin huomiotta.',
  ],
  de: [
    'Bestätige deine E-Mail-Adresse',
    'Willkommen bei Komisio! Bestätige deine E-Mail-Adresse, um die Registrierung abzuschließen.',
    'E-Mail-Adresse bestätigen',
    'Wenn du dieses Konto nicht erstellt hast, kannst du diese E-Mail ignorieren.',
  ],
  es: [
    'Confirma tu dirección de correo electrónico',
    '¡Te damos la bienvenida a Komisio! Confirma tu dirección de correo electrónico para terminar de crear tu cuenta.',
    'Confirmar correo electrónico',
    'Si no has creado esta cuenta, puedes ignorar este correo.',
  ],
  it: [
    'Conferma il tuo indirizzo email',
    'Ti diamo il benvenuto su Komisio! Conferma il tuo indirizzo email per completare la registrazione.',
    'Conferma indirizzo email',
    'Se non hai creato questo account, puoi ignorare questa email.',
  ],
}
const locales = Object.keys(confirmationCopy).filter((x) => x !== 'en')
const language = '{{ $locale := printf "%v" .Data.locale }}'
function select(render) {
  return (
    language +
    locales
      .map(
        (locale, i) =>
          `{{ ${i ? 'else if' : 'if'} eq $locale "${locale}" }}${render(locale)}`,
      )
      .join('') +
    `{{ else }}${render('en')}{{ end }}`
  )
}
const escape = (text) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
export function confirmationConfig() {
  return {
    mailer_subjects_confirmation: select(
      (locale) => `Komisio – ${confirmationCopy[locale][0]}`,
    ),
    mailer_templates_confirmation_content: select((locale) => {
      const [title, intro, button, note] = confirmationCopy[locale].map(escape)
      const tag = locale === 'dk' ? 'da' : locale === 'no' ? 'nb' : locale
      return `<!doctype html><html lang="${tag}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:24px;background:#f4f7f2;color:#163f35;font-family:Arial,sans-serif"><table role="presentation" style="max-width:560px;width:100%;margin:auto;background:#ffffff;border-radius:16px"><tr><td style="padding:32px"><p style="font-size:24px;font-weight:bold">komisio.</p><h1 style="font-size:24px">${title}</h1><p style="line-height:1.6">${intro}</p><p style="margin:28px 0"><a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 22px;background:#163f35;color:#ffffff;border-radius:8px;text-decoration:none">${button}</a></p><p style="line-height:1.6">${note}</p></td></tr></table></body></html>`
    }),
  }
}
// The same generated templates are used by local Auth and hosted deployments.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const config = confirmationConfig()
  mkdirSync('supabase/templates', { recursive: true })
  writeFileSync(
    'supabase/templates/confirmation.html',
    config.mailer_templates_confirmation_content + '\n',
  )
  const path = 'supabase/config.toml'
  let toml = readFileSync(path, 'utf8')
  const section = `[auth.email.template.confirmation]\nsubject = '''${config.mailer_subjects_confirmation}'''\ncontent_path = "./supabase/templates/confirmation.html"\n`
  if (toml.includes('[auth.email.template.confirmation]'))
    toml = toml.replace(
      /\[auth\.email\.template\.confirmation\][\s\S]*?(?=\n\[|$)/,
      section + '\n',
    )
  else toml = toml.replace('[auth.sms]', section + '\n[auth.sms]')
  writeFileSync(path, toml)
}
