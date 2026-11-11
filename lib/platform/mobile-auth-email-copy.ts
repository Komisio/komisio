import type { Locale } from '../i18n'

const copies: Record<Locale, { subject: string; intro: string; note: string }> =
  {
    sv: {
      subject: 'Din kod till Komisio',
      intro:
        'Ange koden i Komisio-appen för att logga in eller skapa ditt konto.',
      note: 'Dela inte koden med någon. Om du inte begärde den kan du ignorera detta mejl.',
    },
    en: {
      subject: 'Your Komisio code',
      intro:
        'Enter this code in the Komisio app to sign in or create your account.',
      note: 'Do not share this code. If you did not request it, you can ignore this email.',
    },
    no: {
      subject: 'Din kode til Komisio',
      intro:
        'Skriv inn koden i Komisio-appen for å logge inn eller opprette kontoen din.',
      note: 'Ikke del koden med noen. Hvis du ikke ba om den, kan du se bort fra denne e-posten.',
    },
    dk: {
      subject: 'Din kode til Komisio',
      intro:
        'Indtast koden i Komisio-appen for at logge ind eller oprette din konto.',
      note: 'Del ikke koden med andre. Hvis du ikke har bedt om den, kan du ignorere denne mail.',
    },
    fi: {
      subject: 'Komisio-koodisi',
      intro:
        'Kirjoita koodi Komisio-sovellukseen kirjautuaksesi sisään tai luodaksesi tilin.',
      note: 'Älä jaa koodia muille. Jos et pyytänyt koodia, voit jättää viestin huomiotta.',
    },
    de: {
      subject: 'Dein Komisio-Code',
      intro:
        'Gib den Code in der Komisio-App ein, um dich anzumelden oder ein Konto zu erstellen.',
      note: 'Teile den Code mit niemandem. Wenn du ihn nicht angefordert hast, kannst du diese E-Mail ignorieren.',
    },
    es: {
      subject: 'Tu código de Komisio',
      intro:
        'Introduce el código en la app de Komisio para iniciar sesión o crear tu cuenta.',
      note: 'No compartas este código. Si no lo has solicitado, puedes ignorar este correo.',
    },
    it: {
      subject: 'Il tuo codice Komisio',
      intro:
        'Inserisci il codice nell’app Komisio per accedere o creare il tuo account.',
      note: 'Non condividere il codice. Se non lo hai richiesto, puoi ignorare questa email.',
    },
  }
export const mobileAuthEmailCopy = (locale: Locale) => copies[locale]
