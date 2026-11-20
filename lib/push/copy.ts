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
    | 'external_item_declined'
    | 'external_item_purchased',
  locale: Locale,
  item: string,
  store: string,
  approved = false,
) {
  if (kind === 'external_item_purchased') {
    const [title, body] = purchaseCopy[locale]
    return { title, body }
  }
  if (kind === 'external_item_offered' || kind === 'external_item_declined') {
    const [offered, declined, body] = requestCopy[locale]
    return {
      title:
        kind === 'external_item_offered'
          ? approved
            ? approvedCopy[locale]
            : offered
          : declined,
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

const purchaseCopy: Record<Locale, [string, string]> = {
  sv: [
    'Ka-ching! Komisio har köpt din vara',
    'Det avtalade beloppet har lagts till på ditt saldo.',
  ],
  en: [
    'Ka-ching! Komisio bought your item',
    'The agreed amount has been credited to your balance.',
  ],
  no: [
    'Ka-ching! Komisio har kjøpt varen din',
    'Det avtalte beløpet er lagt til saldoen din.',
  ],
  dk: [
    'Ka-ching! Komisio har købt din vare',
    'Det aftalte beløb er sat ind på din saldo.',
  ],
  fi: [
    'Ka-ching! Komisio osti tuotteesi',
    'Sovittu summa on lisätty saldoosi.',
  ],
  de: [
    'Ka-ching! Komisio hat deinen Artikel gekauft',
    'Der vereinbarte Betrag wurde deinem Guthaben gutgeschrieben.',
  ],
  es: [
    '¡Ka-ching! Komisio ha comprado tu artículo',
    'El importe acordado se ha añadido a tu saldo.',
  ],
  it: [
    'Ka-ching! Komisio ha acquistato il tuo articolo',
    'L’importo concordato è stato accreditato sul tuo saldo.',
  ],
}

const approvedCopy: Record<Locale, string> = {
  sv: 'Komisio har godkänt din vara',
  en: 'Komisio has approved your item',
  no: 'Komisio har godkjent varen din',
  dk: 'Komisio har godkendt din vare',
  fi: 'Komisio on hyväksynyt tuotteesi',
  de: 'Komisio hat deinen Artikel angenommen',
  es: 'Komisio ha aceptado tu artículo',
  it: 'Komisio ha approvato il tuo articolo',
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
