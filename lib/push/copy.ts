import type { Locale } from '../i18n'

const copy: Record<
  Locale,
  { registered: string; sold: string; registeredBody: string; soldBody: string }
> = {
  sv: {
    registered: 'Vara registrerad',
    sold: 'Vara såld',
    registeredBody: '”{item}” har registrerats hos {store}.',
    soldBody: '”{item}” har sålts hos {store}.',
  },
  en: {
    registered: 'Item registered',
    sold: 'Item sold',
    registeredBody: '“{item}” has been registered at {store}.',
    soldBody: '“{item}” has been sold at {store}.',
  },
  no: {
    registered: 'Vare registrert',
    sold: 'Vare solgt',
    registeredBody: '«{item}» er registrert hos {store}.',
    soldBody: '«{item}» er solgt hos {store}.',
  },
  dk: {
    registered: 'Vare registreret',
    sold: 'Vare solgt',
    registeredBody: '»{item}« er registreret hos {store}.',
    soldBody: '»{item}« er solgt hos {store}.',
  },
  fi: {
    registered: 'Tuote rekisteröity',
    sold: 'Tuote myyty',
    registeredBody: '”{item}” on rekisteröity liikkeessä {store}.',
    soldBody: '”{item}” on myyty liikkeessä {store}.',
  },
  de: {
    registered: 'Artikel erfasst',
    sold: 'Artikel verkauft',
    registeredBody: '„{item}“ wurde bei {store} erfasst.',
    soldBody: '„{item}“ wurde bei {store} verkauft.',
  },
  es: {
    registered: 'Artículo registrado',
    sold: 'Artículo vendido',
    registeredBody: '«{item}» se ha registrado en {store}.',
    soldBody: '«{item}» se ha vendido en {store}.',
  },
  it: {
    registered: 'Articolo registrato',
    sold: 'Articolo venduto',
    registeredBody: '«{item}» è stato registrato presso {store}.',
    soldBody: '«{item}» è stato venduto presso {store}.',
  },
}
export function renderSellerPush(
  kind:
    | 'item_registered'
    | 'item_sold'
    | 'external_item_offered'
    | 'external_item_declined',
  locale: Locale,
  item: string,
  store: string,
) {
  if (kind === 'external_item_offered' || kind === 'external_item_declined') {
    const [offered, declined, body] = requestCopy[locale]
    return {
      title: kind === 'external_item_offered' ? offered : declined,
      body,
    }
  }
  const d = copy[locale]
  return {
    title: kind === 'item_registered' ? d.registered : d.sold,
    body: (kind === 'item_registered' ? d.registeredBody : d.soldBody).replace(
      /\{(item|store)\}/g,
      (_, key: string) =>
        (key === 'item' ? item : store).replace(/\s+/g, ' ').trim(),
    ),
  }
}

const requestCopy: Record<Locale, [string, string, string]> = {
  sv: [
    'Du har fått ett erbjudande',
    'Komisio kan inte ta emot din vara',
    'Öppna appen för att se beskedet.',
  ],
  en: [
    'You have an offer',
    'Komisio cannot accept your item',
    'Open the app to see the decision.',
  ],
  no: [
    'Du har fått et tilbud',
    'Komisio kan ikke ta imot varen',
    'Åpne appen for å se svaret.',
  ],
  dk: [
    'Du har fået et tilbud',
    'Komisio kan ikke modtage varen',
    'Åbn appen for at se svaret.',
  ],
  fi: [
    'Olet saanut tarjouksen',
    'Komisio ei voi vastaanottaa tuotettasi',
    'Avaa sovellus nähdäksesi vastauksen.',
  ],
  de: [
    'Du hast ein Angebot erhalten',
    'Komisio kann deinen Artikel nicht annehmen',
    'Öffne die App, um die Antwort zu sehen.',
  ],
  es: [
    'Has recibido una oferta',
    'Komisio no puede aceptar tu artículo',
    'Abre la app para ver la respuesta.',
  ],
  it: [
    'Hai ricevuto un’offerta',
    'Komisio non può accettare il tuo articolo',
    'Apri l’app per vedere la risposta.',
  ],
}
