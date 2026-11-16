import type { Locale } from '@/lib/i18n'
const en = {
  title: 'Account deletion',
  intro:
    'Handle requests from the app. Respond within one month. Starting or completing a case does not itself erase data or close financial obligations.',
  empty: 'No deletion requests.',
  requested: 'Received',
  processing: 'In progress',
  completed: 'Completed',
  due: 'Respond by',
  start: 'Start handling',
  complete: 'Record completed deletion',
  refresh: 'Reload',
  failed:
    'The result could not be confirmed. Reload the case before continuing.',
  incomplete:
    'Deletion is not complete. Resolve the checks below before recording completion.',
  stores: 'Linked seller accounts',
  balance: 'Unsettled balance',
  items: 'Open items',
  review: 'Review privacy in this store with its owner/admin',
  photos: 'Photos to review',
  requests: 'Item requests to review',
  checks: 'Verified system checks',
  authRemoved: 'Login removed',
  identitiesRemoved: 'Sign-in identities removed',
  sessionsRemoved: 'Sessions revoked',
  membershipsRemoved: 'Store access removed',
  profileRemoved: 'Account profile removed',
  pushRemoved: 'Push tokens removed',
  sellerContactsClosed: 'Seller contacts closed',
  personal:
    'Personal data and files reviewed; removed unless retention is justified.',
  external: 'External copies and processors reviewed.',
  confirmation: 'Completion confirmation delivered to the account holder.',
  reason: 'Retained evidence and reasons (no personal data)',
  reference: 'Confirmation reference (no contact details)',
  apple: 'Apple handling',
  revoked: 'Tokens revoked',
  manual: 'Manual revocation instructions supplied (tokens unavailable)',
  notApplicable: 'No Apple identity',
  notice:
    'Use the approved operator procedure. This form only records the outcome; checking boxes never deletes an account.',
  previous: 'Previous',
  next: 'Next',
}
type Copy = typeof en
const sv: Copy = {
  title: 'Kontoradering',
  intro:
    'Handlägg begäran från appen. Återkom inom en månad. Att påbörja eller slutföra ett ärende här raderar inte i sig några uppgifter och avslutar inga ekonomiska åtaganden.',
  empty: 'Inga begäranden om kontoradering.',
  requested: 'Mottagen',
  processing: 'Handläggs',
  completed: 'Slutförd',
  due: 'Återkom senast',
  start: 'Påbörja handläggning',
  complete: 'Registrera slutförd radering',
  refresh: 'Läs in på nytt',
  failed:
    'Resultatet kunde inte bekräftas. Läs in ärendet igen innan du fortsätter.',
  incomplete:
    'Raderingen är inte klar. Åtgärda kontrollerna nedan innan du registrerar slutförandet.',
  stores: 'Kopplade säljarkonton',
  balance: 'Oreglerat saldo',
  items: 'Pågående varor',
  review: 'Granska integritet i denna butik med butikens ägare/administratör',
  photos: 'Bilder att granska',
  requests: 'Varuförfrågningar att granska',
  checks: 'Kontroller i systemet',
  authRemoved: 'Inloggning borttagen',
  identitiesRemoved: 'Inloggningssätt borttagna',
  sessionsRemoved: 'Sessioner avslutade',
  membershipsRemoved: 'Butiksåtkomst borttagen',
  profileRemoved: 'Kontoprofil borttagen',
  pushRemoved: 'Push-token borttagna',
  sellerContactsClosed: 'Säljarnas kontaktuppgifter raderade',
  personal:
    'Personuppgifter och filer granskade och raderade där det saknas skäl att spara dem.',
  external: 'Externa kopior och personuppgiftsbiträden granskade.',
  confirmation:
    'Bekräftelse på slutförd radering levererad till kontoinnehavaren.',
  reason: 'Bevarade underlag och skäl (inga personuppgifter)',
  reference: 'Referens för bekräftelsen (inga kontaktuppgifter)',
  apple: 'Apple-koppling',
  revoked: 'Token återkallade',
  manual: 'Instruktioner för manuell återkallelse lämnade (token saknas)',
  notApplicable: 'Ingen Apple-inloggning',
  notice:
    'Följ den godkända operatörsrutinen. Formuläret registrerar endast resultatet; kryssrutorna raderar aldrig ett konto.',
  previous: 'Föregående',
  next: 'Nästa',
}
// Host operations use the same complete English fallback as fixed operator messages.
export function accountDeletionCopy(locale: Locale): Copy {
  return locale === 'sv' ? sv : en
}
