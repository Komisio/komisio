import type { Locale } from './i18n'
import type { GuideKey } from './engine/store-guide'

const copy = {
  sv: {
    single:
      'Säljaren kommer in med till exempel en jacka som ni tar emot för försäljning åt säljaren.',
    bags: 'Säljaren lämnar till exempel en kasse kläder som ni går igenom och registrerar vara för vara.',
    owned:
      'Butiken köper till exempel en begagnad stol av säljaren och säljer den sedan som en egen vara.',
    new: 'Ni köper till exempel nya accessoarer från en leverantör för att sälja i butiken.',
    pickup:
      'Ni hämtar till exempel möbler hos säljaren innan ni tar emot dem i butiken.',
    space: 'Säljaren hyr till exempel en hylla eller ett bås för sina varor.',
    other:
      'Välj detta om inget av de andra alternativen beskriver ert arbetssätt.',
    clothes: 'Till exempel jackor, skor, väskor och smycken.',
    kids: 'Till exempel barnkläder, leksaker och babyartiklar.',
    home: 'Till exempel porslin, lampor, tavlor och annan inredning.',
    furniture: 'Till exempel bord, stolar, soffor och skåp.',
    hobby:
      'Till exempel cyklar, sportutrustning, spel och material för hobbyer.',
    mixed:
      'Ni har ett blandat sortiment, till exempel både kläder, möbler och husgeråd.',
    store:
      'Personalen bestämmer försäljningspriset, till exempel efter att ha bedömt varans skick.',
    together:
      'Ni och säljaren kommer överens om priset innan varan läggs ut till försäljning.',
    seller: 'Säljaren anger vilket pris varan ska säljas för.',
    suggestion:
      'Ni vill ha hjälp att bedöma ett pris och granskar förslaget innan ni bestämmer er. Valet aktiverar ingen automatisk prissättning.',
    both: 'Arbetssättet varierar, till exempel beroende på säljare eller försäljningstillfälle.',
    later: 'Ni kan fortsätta guiden och komma tillbaka till frågan senare.',
    collect:
      'Säljaren hämtar till exempel en osåld jacka när den avtalade försäljningstiden har gått ut.',
    donate:
      'Ni vill kunna skänka en osåld vara enligt överenskommelsen med säljaren. Valet ger inte i sig tillåtelse att skänka varor.',
    extend:
      'En osåld vara får ligga kvar längre enligt överenskommelsen med säljaren.',
    individual:
      'Ni kontaktar säljaren och kommer överens om vad som ska hända med den osålda varan.',
    zettle:
      'Välj om ni använder eller planerar att använda PayPal POS i kassan. Kopplingen ställs in separat.',
    shopify:
      'Välj om ni använder eller planerar att använda Shopify POS i kassan. Kopplingen ställs in separat.',
    shop: 'Kunden kommer in i butiken och handlar på plats.',
    web: 'Ni säljer via er egen webbshop. Eventuella integrationer ställs in separat.',
    social:
      'Ni visar och säljer till exempel varor via Instagram eller Facebook. Valet kopplar inte några konton.',
    market: 'Ni säljer via externa marknadsplatser på nätet.',
    checkoutStore:
      'Butikens personal tar betalt även för varorna på säljarens hyrda plats.',
    checkoutSeller:
      'Säljaren tar själv betalt av kunderna vid sin hyrda plats.',
    checkoutBoth:
      'Ibland tar butiken betalt och ibland säljaren, beroende på upplägget.',
    info: 'Information om',
  },
  en: {
    single:
      'A seller brings in, for example, a jacket for your store to sell on their behalf.',
    bags: 'A seller brings a bag of clothes that you inspect and register one item at a time.',
    owned:
      'The store buys, for example, a used chair and then sells it as its own stock.',
    new: 'You buy new accessories from a supplier to sell in the store, for example.',
    pickup:
      'You collect furniture from the seller before receiving it in store, for example.',
    space: 'A seller rents a shelf or booth for their items, for example.',
    other: 'Choose this if none of the other options describes how you work.',
    clothes: 'For example, jackets, shoes, bags and jewellery.',
    kids: "For example, children's clothes, toys and baby items.",
    home: 'For example, tableware, lamps, pictures and home accessories.',
    furniture: 'For example, tables, chairs, sofas and cupboards.',
    hobby: 'For example, bicycles, sports equipment, games and hobby supplies.',
    mixed:
      'You carry a mixed range, such as clothes, furniture and household items.',
    store:
      "Staff set the selling price, for example after checking the item's condition.",
    together:
      'You and the seller agree on a price before offering the item for sale.',
    seller: "The seller sets the item's selling price.",
    suggestion:
      'You want help estimating a price and review the suggestion before deciding. This does not enable automatic pricing.',
    both: 'The approach varies, for example by seller or sales occasion.',
    later: 'Continue the guide and come back to this question later.',
    collect:
      'The seller collects an unsold jacket when the agreed selling period ends, for example.',
    donate:
      'You want to donate unsold items as agreed with the seller. This choice does not itself authorize donations.',
    extend: 'An unsold item stays on sale longer as agreed with the seller.',
    individual:
      'You contact the seller and agree what happens to the unsold item.',
    zettle:
      'Choose if you use or plan to use PayPal POS at checkout. Set up the connection separately.',
    shopify:
      'Choose if you use or plan to use Shopify POS at checkout. Set up the connection separately.',
    shop: 'Customers visit your physical store and buy there.',
    web: 'You sell through your own online store. Set up any integrations separately.',
    social:
      'You show and sell items through Instagram or Facebook, for example. This does not connect any accounts.',
    market: 'You sell through external online marketplaces.',
    checkoutStore:
      "Store staff take payment for items in the seller's rented space too.",
    checkoutSeller:
      'The seller takes payment from customers at their rented space.',
    checkoutBoth:
      'Sometimes the store takes payment and sometimes the seller, depending on the arrangement.',
    info: 'Information about',
  },
  no: {
    single:
      'Selgeren kommer inn med for eksempel en jakke som butikken skal selge på deres vegne.',
    bags: 'Selgeren leverer en pose klær som dere går gjennom og registrerer én vare om gangen.',
    owned:
      'Butikken kjøper for eksempel en brukt stol og selger den videre som sin egen vare.',
    new: 'Dere kjøper for eksempel nytt tilbehør fra en leverandør for å selge i butikken.',
    pickup: 'Dere henter for eksempel møbler hos selgeren.',
    space: 'Selgeren leier for eksempel en hylle eller stand.',
    other:
      'Velg dette hvis ingen andre alternativer beskriver hvordan dere arbeider.',
    clothes: 'For eksempel jakker, sko, vesker og smykker.',
    kids: 'For eksempel barneklær, leker og babyutstyr.',
    home: 'For eksempel servise, lamper, bilder og interiør.',
    furniture: 'For eksempel bord, stoler, sofaer og skap.',
    hobby: 'For eksempel sykler, sportsutstyr, spill og hobbyutstyr.',
    mixed:
      'Dere har et blandet utvalg, som klær, møbler og husholdningsartikler.',
    store:
      'Personalet bestemmer salgsprisen, for eksempel etter å ha vurdert varens tilstand.',
    together:
      'Dere og selgeren blir enige om prisen før varen legges ut for salg.',
    seller: 'Selgeren bestemmer varens salgspris.',
    suggestion:
      'Dere ønsker hjelp til å vurdere prisen og gjennomgår forslaget før dere bestemmer dere. Valget aktiverer ikke automatisk prising.',
    both: 'Arbeidsmåten varierer, for eksempel etter selger eller salgstilfelle.',
    later: 'Fortsett guiden og kom tilbake til spørsmålet senere.',
    collect:
      'Selgeren henter for eksempel en usolgt jakke når avtalt salgstid er over.',
    donate:
      'Dere vil kunne donere usolgte varer etter avtale med selgeren. Valget gir ikke i seg selv tillatelse til å donere.',
    extend: 'En usolgt vare får mer salgstid etter avtale med selgeren.',
    individual:
      'Dere kontakter selgeren og avtaler hva som skal skje med varen.',
    zettle:
      'Velg hvis dere bruker eller planlegger å bruke PayPal POS. Tilkoblingen settes opp separat.',
    shopify:
      'Velg hvis dere bruker eller planlegger å bruke Shopify POS. Tilkoblingen settes opp separat.',
    shop: 'Kunden besøker butikken og handler der.',
    web: 'Dere selger i egen nettbutikk. Integrasjoner settes opp separat.',
    social:
      'Dere viser og selger varer via for eksempel Instagram eller Facebook. Ingen kontoer kobles til her.',
    market: 'Dere selger via eksterne markedsplasser på nettet.',
    checkoutStore:
      'Butikkens personale tar også betalt for varene på selgerens leide plass.',
    checkoutSeller: 'Selgeren tar selv betalt av kundene på sin leide plass.',
    checkoutBoth:
      'Noen ganger tar butikken betalt, andre ganger selgeren, avhengig av avtalen.',
    info: 'Informasjon om',
  },
  dk: {
    single:
      'Sælgeren kommer med for eksempel en jakke, som butikken skal sælge på sælgerens vegne.',
    bags: 'Sælgeren afleverer en pose tøj, som I gennemgår og registrerer én vare ad gangen.',
    owned:
      'Butikken køber for eksempel en brugt stol og sælger den videre som sin egen vare.',
    new: 'I køber for eksempel nyt tilbehør fra en leverandør til salg i butikken.',
    pickup: 'I henter for eksempel møbler hos sælgeren.',
    space: 'Sælgeren lejer for eksempel en hylde eller stand.',
    other:
      'Vælg dette, hvis ingen af de andre muligheder beskriver jeres arbejdsgang.',
    clothes: 'For eksempel jakker, sko, tasker og smykker.',
    kids: 'For eksempel børnetøj, legetøj og babyudstyr.',
    home: 'For eksempel service, lamper, billeder og boligtilbehør.',
    furniture: 'For eksempel borde, stole, sofaer og skabe.',
    hobby: 'For eksempel cykler, sportsudstyr, spil og hobbyartikler.',
    mixed:
      'I har et blandet sortiment, som tøj, møbler og husholdningsartikler.',
    store:
      'Personalet fastsætter salgsprisen, for eksempel efter at have vurderet varens stand.',
    together: 'I og sælgeren aftaler prisen, før varen sættes til salg.',
    seller: 'Sælgeren fastsætter varens salgspris.',
    suggestion:
      'I ønsker hjælp til at vurdere prisen og gennemgår forslaget først. Valget aktiverer ikke automatisk prissætning.',
    both: 'Arbejdsgangen varierer, for eksempel efter sælger eller salgssituation.',
    later: 'Fortsæt guiden og vend tilbage til spørgsmålet senere.',
    collect:
      'Sælgeren henter for eksempel en usolgt jakke, når den aftalte salgsperiode slutter.',
    donate:
      'I vil kunne donere usolgte varer efter aftale med sælgeren. Valget giver ikke i sig selv tilladelse til at donere.',
    extend: 'En usolgt vare får længere salgstid efter aftale med sælgeren.',
    individual: 'I kontakter sælgeren og aftaler, hvad der skal ske med varen.',
    zettle:
      'Vælg, hvis I bruger eller planlægger at bruge PayPal POS. Forbindelsen sættes op separat.',
    shopify:
      'Vælg, hvis I bruger eller planlægger at bruge Shopify POS. Forbindelsen sættes op separat.',
    shop: 'Kunden besøger butikken og handler der.',
    web: 'I sælger i jeres egen webshop. Integrationer sættes op separat.',
    social:
      'I viser og sælger varer via for eksempel Instagram eller Facebook. Ingen konti forbindes her.',
    market: 'I sælger via eksterne markedspladser på nettet.',
    checkoutStore:
      'Butikkens personale tager også imod betaling for varer på sælgerens lejede plads.',
    checkoutSeller:
      'Sælgeren tager selv imod betaling fra kunder på sin lejede plads.',
    checkoutBoth:
      'Nogle gange tager butikken imod betaling, andre gange sælgeren, afhængigt af aftalen.',
    info: 'Information om',
  },
  fi: {
    single: 'Myyjä tuo esimerkiksi takin, jonka liike myy hänen puolestaan.',
    bags: 'Myyjä tuo kassillisen vaatteita, jotka tarkastatte ja kirjaatte yksi kerrallaan.',
    owned:
      'Liike ostaa esimerkiksi käytetyn tuolin ja myy sen omana tavaranaan.',
    new: 'Ostatte esimerkiksi uusia asusteita toimittajalta myytäväksi liikkeessä.',
    pickup: 'Noudatte esimerkiksi huonekaluja myyjältä.',
    space: 'Myyjä vuokraa esimerkiksi hyllyn tai myyntipaikan.',
    other: 'Valitse tämä, jos muut vaihtoehdot eivät kuvaa toimintaanne.',
    clothes: 'Esimerkiksi takit, kengät, laukut ja korut.',
    kids: 'Esimerkiksi lastenvaatteet, lelut ja vauvatarvikkeet.',
    home: 'Esimerkiksi astiat, valaisimet, taulut ja sisustustavarat.',
    furniture: 'Esimerkiksi pöydät, tuolit, sohvat ja kaapit.',
    hobby:
      'Esimerkiksi polkupyörät, urheiluvälineet, pelit ja harrastustarvikkeet.',
    mixed:
      'Valikoimanne on monipuolinen: esimerkiksi vaatteita, huonekaluja ja taloustavaroita.',
    store:
      'Henkilökunta määrittää myyntihinnan esimerkiksi tavaran kunnon perusteella.',
    together:
      'Sovitte hinnan myyjän kanssa ennen tavaran laittamista myyntiin.',
    seller: 'Myyjä määrittää tavaran myyntihinnan.',
    suggestion:
      'Haluatte apua hinnan arviointiin ja tarkistatte ehdotuksen ennen päätöstä. Valinta ei ota automaattista hinnoittelua käyttöön.',
    both: 'Toimintatapa vaihtelee esimerkiksi myyjän tai myyntitilanteen mukaan.',
    later: 'Jatkakaa opasta ja palatkaa kysymykseen myöhemmin.',
    collect:
      'Myyjä noutaa esimerkiksi myymättä jääneen takin sovitun myyntiajan päätyttyä.',
    donate:
      'Haluatte lahjoittaa myymättä jääneitä tavaroita myyjän kanssa sovitusti. Valinta ei itsessään anna lupaa lahjoittamiseen.',
    extend:
      'Myymättä jääneen tavaran myyntiaikaa pidennetään myyjän kanssa sovitusti.',
    individual: 'Otatte yhteyttä myyjään ja sovitte, mitä tavaralle tehdään.',
    zettle:
      'Valitse, jos käytätte tai aiotte käyttää PayPal POS -kassaa. Yhteys määritetään erikseen.',
    shopify:
      'Valitse, jos käytätte tai aiotte käyttää Shopify POS -kassaa. Yhteys määritetään erikseen.',
    shop: 'Asiakas tulee liikkeeseen ja ostaa paikan päällä.',
    web: 'Myytte omassa verkkokaupassanne. Integraatiot määritetään erikseen.',
    social:
      'Esittelette ja myytte tavaroita esimerkiksi Instagramissa tai Facebookissa. Valinta ei yhdistä tilejä.',
    market: 'Myytte ulkopuolisilla verkkomarkkinapaikoilla.',
    checkoutStore:
      'Liikkeen henkilökunta vastaanottaa maksut myös myyjän vuokraaman paikan tavaroista.',
    checkoutSeller:
      'Myyjä vastaanottaa itse maksut asiakkailta vuokraamallaan paikalla.',
    checkoutBoth: 'Maksun vastaanottaa tilanteen mukaan joko liike tai myyjä.',
    info: 'Tietoa vaihtoehdosta',
  },
  de: {
    single:
      'Eine Person bringt zum Beispiel eine Jacke, die Ihr Laden in ihrem Auftrag verkauft.',
    bags: 'Eine Person bringt eine Tasche Kleidung, die Sie Stück für Stück prüfen und erfassen.',
    owned:
      'Der Laden kauft zum Beispiel einen gebrauchten Stuhl und verkauft ihn als eigene Ware weiter.',
    new: 'Sie kaufen zum Beispiel neue Accessoires von einem Lieferanten für den Weiterverkauf.',
    pickup: 'Sie holen zum Beispiel Möbel bei der einliefernden Person ab.',
    space: 'Eine Person mietet zum Beispiel ein Regal oder einen Stand.',
    other:
      'Wählen Sie dies, wenn keine andere Option Ihre Arbeitsweise beschreibt.',
    clothes: 'Zum Beispiel Jacken, Schuhe, Taschen und Schmuck.',
    kids: 'Zum Beispiel Kinderkleidung, Spielzeug und Babyartikel.',
    home: 'Zum Beispiel Geschirr, Lampen, Bilder und Wohnaccessoires.',
    furniture: 'Zum Beispiel Tische, Stühle, Sofas und Schränke.',
    hobby: 'Zum Beispiel Fahrräder, Sportgeräte, Spiele und Hobbybedarf.',
    mixed:
      'Sie haben ein gemischtes Sortiment, etwa Kleidung, Möbel und Haushaltswaren.',
    store:
      'Das Personal legt den Verkaufspreis fest, etwa nach Prüfung des Zustands.',
    together:
      'Sie vereinbaren den Preis mit der einliefernden Person, bevor der Artikel angeboten wird.',
    seller: 'Die einliefernde Person legt den Verkaufspreis fest.',
    suggestion:
      'Sie möchten Hilfe bei der Preiseinschätzung und prüfen den Vorschlag vor der Entscheidung. Dies aktiviert keine automatische Preisgestaltung.',
    both: 'Die Arbeitsweise variiert, etwa je nach Person oder Verkaufssituation.',
    later: 'Fahren Sie fort und beantworten Sie diese Frage später.',
    collect:
      'Die einliefernde Person holt etwa eine unverkaufte Jacke nach Ablauf der vereinbarten Verkaufszeit ab.',
    donate:
      'Sie möchten unverkaufte Artikel nach Vereinbarung spenden können. Diese Auswahl erteilt selbst keine Erlaubnis zum Spenden.',
    extend:
      'Ein unverkaufter Artikel bleibt nach Vereinbarung länger im Verkauf.',
    individual:
      'Sie kontaktieren die einliefernde Person und vereinbaren das weitere Vorgehen.',
    zettle:
      'Wählen Sie dies, wenn Sie PayPal POS nutzen oder nutzen möchten. Die Verbindung wird separat eingerichtet.',
    shopify:
      'Wählen Sie dies, wenn Sie Shopify POS nutzen oder nutzen möchten. Die Verbindung wird separat eingerichtet.',
    shop: 'Kunden besuchen Ihr Geschäft und kaufen vor Ort.',
    web: 'Sie verkaufen im eigenen Onlineshop. Integrationen werden separat eingerichtet.',
    social:
      'Sie zeigen und verkaufen Artikel etwa auf Instagram oder Facebook. Hier werden keine Konten verbunden.',
    market: 'Sie verkaufen auf externen Online-Marktplätzen.',
    checkoutStore:
      'Ihr Personal kassiert auch für Artikel auf den vermieteten Verkaufsflächen.',
    checkoutSeller: 'Die mietende Person kassiert selbst an ihrem Stand.',
    checkoutBoth:
      'Je nach Vereinbarung kassiert entweder der Laden oder die mietende Person.',
    info: 'Informationen zu',
  },
  es: {
    single:
      'Una persona trae, por ejemplo, una chaqueta para que la tienda la venda en su nombre.',
    bags: 'Una persona trae una bolsa de ropa que revisáis y registráis artículo por artículo.',
    owned:
      'La tienda compra, por ejemplo, una silla usada y la revende como mercancía propia.',
    new: 'Compráis, por ejemplo, accesorios nuevos a un proveedor para venderlos en la tienda.',
    pickup: 'Recogéis, por ejemplo, muebles en casa del vendedor.',
    space: 'El vendedor alquila, por ejemplo, una estantería o un puesto.',
    other:
      'Elegid esto si ninguna otra opción describe vuestra forma de trabajar.',
    clothes: 'Por ejemplo, chaquetas, zapatos, bolsos y joyas.',
    kids: 'Por ejemplo, ropa infantil, juguetes y artículos para bebés.',
    home: 'Por ejemplo, vajilla, lámparas, cuadros y decoración.',
    furniture: 'Por ejemplo, mesas, sillas, sofás y armarios.',
    hobby:
      'Por ejemplo, bicicletas, material deportivo, juegos y artículos para aficiones.',
    mixed:
      'Tenéis un surtido variado, como ropa, muebles y artículos del hogar.',
    store:
      'El personal fija el precio de venta, por ejemplo tras comprobar el estado del artículo.',
    together:
      'Acordáis el precio con el vendedor antes de poner el artículo a la venta.',
    seller: 'El vendedor fija el precio de venta del artículo.',
    suggestion:
      'Queréis ayuda para estimar el precio y revisar la sugerencia antes de decidir. Esto no activa precios automáticos.',
    both: 'La forma de trabajar varía, por ejemplo según el vendedor o la ocasión.',
    later: 'Continuad la guía y volved a esta pregunta más adelante.',
    collect:
      'El vendedor recoge, por ejemplo, una chaqueta no vendida al terminar el plazo acordado.',
    donate:
      'Queréis poder donar artículos no vendidos según lo acordado con el vendedor. Esta opción no autoriza por sí sola la donación.',
    extend:
      'Un artículo no vendido permanece a la venta más tiempo según lo acordado con el vendedor.',
    individual:
      'Contactáis con el vendedor y acordáis qué hacer con el artículo.',
    zettle:
      'Elegid esto si usáis o pensáis usar PayPal POS. La conexión se configura por separado.',
    shopify:
      'Elegid esto si usáis o pensáis usar Shopify POS. La conexión se configura por separado.',
    shop: 'Los clientes visitan la tienda física y compran allí.',
    web: 'Vendéis en vuestra propia tienda online. Las integraciones se configuran por separado.',
    social:
      'Mostráis y vendéis artículos, por ejemplo, en Instagram o Facebook. Aquí no se conectan cuentas.',
    market: 'Vendéis en mercados online externos.',
    checkoutStore:
      'El personal de la tienda cobra también los artículos del espacio alquilado al vendedor.',
    checkoutSeller:
      'El vendedor cobra directamente a los clientes en su espacio alquilado.',
    checkoutBoth:
      'Según lo acordado, unas veces cobra la tienda y otras el vendedor.',
    info: 'Información sobre',
  },
  it: {
    single:
      'Una persona porta, ad esempio, una giacca che il negozio venderà per suo conto.',
    bags: 'Una persona porta una borsa di vestiti che controllate e registrate uno alla volta.',
    owned:
      'Il negozio compra, ad esempio, una sedia usata e la rivende come merce propria.',
    new: 'Acquistate, ad esempio, accessori nuovi da un fornitore per venderli in negozio.',
    pickup: 'Ritirate, ad esempio, mobili a casa del venditore.',
    space: 'Il venditore affitta, ad esempio, uno scaffale o uno stand.',
    other:
      'Scegliete questa opzione se le altre non descrivono il vostro modo di lavorare.',
    clothes: 'Ad esempio giacche, scarpe, borse e gioielli.',
    kids: 'Ad esempio abbigliamento per bambini, giocattoli e articoli per neonati.',
    home: 'Ad esempio stoviglie, lampade, quadri e decorazioni.',
    furniture: 'Ad esempio tavoli, sedie, divani e armadi.',
    hobby:
      'Ad esempio biciclette, attrezzature sportive, giochi e articoli per hobby.',
    mixed: 'Avete un assortimento misto, come vestiti, mobili e casalinghi.',
    store:
      "Il personale stabilisce il prezzo di vendita, ad esempio dopo aver valutato le condizioni dell'articolo.",
    together:
      "Concordate il prezzo con il venditore prima di mettere l'articolo in vendita.",
    seller: "Il venditore stabilisce il prezzo di vendita dell'articolo.",
    suggestion:
      'Volete aiuto per stimare il prezzo e valutate la proposta prima di decidere. Questo non attiva prezzi automatici.',
    both: "Il metodo varia, ad esempio in base al venditore o all'occasione.",
    later: 'Proseguite nella guida e tornate a questa domanda più tardi.',
    collect:
      'Il venditore ritira, ad esempio, una giacca invenduta al termine del periodo concordato.',
    donate:
      'Volete poter donare articoli invenduti come concordato con il venditore. Questa scelta non autorizza di per sé le donazioni.',
    extend:
      'Un articolo invenduto resta in vendita più a lungo come concordato con il venditore.',
    individual:
      "Contattate il venditore e concordate cosa fare con l'articolo invenduto.",
    zettle:
      'Scegliete questa opzione se usate o intendete usare PayPal POS. La connessione si configura separatamente.',
    shopify:
      'Scegliete questa opzione se usate o intendete usare Shopify POS. La connessione si configura separatamente.',
    shop: 'I clienti visitano il negozio fisico e acquistano sul posto.',
    web: 'Vendete nel vostro negozio online. Le integrazioni si configurano separatamente.',
    social:
      'Mostrate e vendete articoli, ad esempio, su Instagram o Facebook. Qui non vengono collegati account.',
    market: 'Vendete su marketplace esterni.',
    checkoutStore:
      'Il personale del negozio incassa anche per gli articoli nello spazio affittato al venditore.',
    checkoutSeller:
      'Il venditore incassa direttamente dai clienti nel proprio spazio affittato.',
    checkoutBoth:
      "A seconda dell'accordo, incassa a volte il negozio e a volte il venditore.",
    info: 'Informazioni su',
  },
} satisfies Record<Locale, Record<string, string>>

const agreementCopy = {
  sv: [
    'Måste säljaren signera eller acceptera avtal före försäljning?',
    'Ja',
    'Nej',
    'Inte bestämt än',
    'Säljaren ska till exempel godkänna butikens villkor innan jackan läggs ut till försäljning. Svaret aktiverar inget avtalskrav; det hanteras separat under Säljaravtal och butikens inställningar.',
    'Ni kräver inte att säljaren signerar eller accepterar ett avtal före försäljning. Svaret ändrar inte era nuvarande avtalsinställningar.',
    'Ni har inte bestämt hur ni vill arbeta med avtal ännu. Ni kan ändra svaret senare.',
    'Ej besvarat',
  ],
  en: [
    'Must the seller sign or accept an agreement before sale?',
    'Yes',
    'No',
    'Not decided yet',
    'For example, the seller accepts your terms before a jacket is offered for sale. This answer does not enable an agreement requirement; manage that separately in Seller agreements and store settings.',
    'You do not require the seller to sign or accept an agreement before sale. This does not change your current agreement settings.',
    'You have not decided how to handle agreements yet. You can change this answer later.',
    'Unanswered',
  ],
  no: [
    'Må selgeren signere eller godta en avtale før salg?',
    'Ja',
    'Nei',
    'Ikke bestemt ennå',
    'Selgeren skal for eksempel godta vilkårene før jakken legges ut for salg. Svaret aktiverer ikke noe avtalekrav; dette håndteres separat under selgeravtaler og butikkinnstillinger.',
    'Dere krever ikke signering eller aksept før salg. Svaret endrer ikke gjeldende avtaleinnstillinger.',
    'Dere har ikke bestemt hvordan dere vil håndtere avtaler ennå. Svaret kan endres senere.',
    'Ikke besvart',
  ],
  dk: [
    'Skal sælgeren underskrive eller acceptere en aftale før salg?',
    'Ja',
    'Nej',
    'Ikke besluttet endnu',
    'Sælgeren skal for eksempel acceptere vilkårene, før jakken sættes til salg. Svaret aktiverer ikke et aftalekrav; dette håndteres separat under sælgeraftaler og butiksindstillinger.',
    'I kræver ikke underskrift eller accept før salg. Svaret ændrer ikke de aktuelle aftaleindstillinger.',
    'I har endnu ikke besluttet, hvordan I vil håndtere aftaler. Svaret kan ændres senere.',
    'Ikke besvaret',
  ],
  fi: [
    'Onko myyjän allekirjoitettava tai hyväksyttävä sopimus ennen myyntiä?',
    'Kyllä',
    'Ei',
    'Ei vielä päätetty',
    'Myyjä hyväksyy esimerkiksi ehdot ennen takin laittamista myyntiin. Vastaus ei ota sopimusvaatimusta käyttöön; se määritetään erikseen myyjäsopimuksissa ja liikkeen asetuksissa.',
    'Ette vaadi allekirjoitusta tai hyväksyntää ennen myyntiä. Vastaus ei muuta nykyisiä sopimusasetuksia.',
    'Ette ole vielä päättäneet sopimuskäytäntöä. Voitte muuttaa vastausta myöhemmin.',
    'Ei vastattu',
  ],
  de: [
    'Muss die einliefernde Person vor dem Verkauf einen Vertrag unterschreiben oder akzeptieren?',
    'Ja',
    'Nein',
    'Noch nicht entschieden',
    'Die Person akzeptiert beispielsweise Ihre Bedingungen, bevor eine Jacke angeboten wird. Die Antwort aktiviert keine Vertragspflicht; diese wird separat unter Verträgen und Geschäftseinstellungen verwaltet.',
    'Sie verlangen vor dem Verkauf keine Unterschrift oder Zustimmung. Die Antwort ändert keine bestehenden Vertragseinstellungen.',
    'Sie haben noch nicht entschieden, wie Sie mit Verträgen arbeiten möchten. Die Antwort lässt sich später ändern.',
    'Unbeantwortet',
  ],
  es: [
    '¿Debe el vendedor firmar o aceptar un contrato antes de la venta?',
    'Sí',
    'No',
    'Aún no decidido',
    'Por ejemplo, el vendedor acepta las condiciones antes de poner una chaqueta a la venta. La respuesta no activa ningún requisito; se configura por separado en contratos de vendedores y ajustes de la tienda.',
    'No exigís firma ni aceptación antes de vender. La respuesta no cambia la configuración actual de contratos.',
    'Aún no habéis decidido cómo gestionar los contratos. Podéis cambiar la respuesta más adelante.',
    'Sin responder',
  ],
  it: [
    'Il venditore deve firmare o accettare un contratto prima della vendita?',
    'Sì',
    'No',
    'Non ancora deciso',
    'Ad esempio, il venditore accetta le condizioni prima di mettere in vendita una giacca. La risposta non attiva alcun obbligo; si configura separatamente nei contratti dei venditori e nelle impostazioni del negozio.',
    'Non richiedete firma o accettazione prima della vendita. La risposta non modifica le impostazioni attuali dei contratti.',
    'Non avete ancora deciso come gestire i contratti. Potete cambiare la risposta in seguito.',
    'Senza risposta',
  ],
} satisfies Record<Locale, string[]>

const otherGoodsCopy = {
  sv: [
    'Andra varor',
    'Till exempel böcker eller vinylskivor, om ert sortiment inte passar någon av kategorierna ovan.',
  ],
  en: [
    'Other items',
    'For example, books or vinyl records, if your range does not fit the categories above.',
  ],
  no: [
    'Andre varer',
    'For eksempel bøker eller vinylplater, hvis sortimentet ikke passer i kategoriene ovenfor.',
  ],
  dk: [
    'Andre varer',
    'For eksempel bøger eller vinylplader, hvis sortimentet ikke passer i kategorierne ovenfor.',
  ],
  fi: [
    'Muut tavarat',
    'Esimerkiksi kirjat tai vinyylilevyt, jos valikoimanne ei sovi yllä oleviin luokkiin.',
  ],
  de: [
    'Andere Waren',
    'Zum Beispiel Bücher oder Schallplatten, wenn Ihr Sortiment in keine der obigen Kategorien passt.',
  ],
  es: [
    'Otros artículos',
    'Por ejemplo, libros o discos de vinilo, si vuestro surtido no encaja en las categorías anteriores.',
  ],
  it: [
    'Altri articoli',
    'Ad esempio libri o dischi in vinile, se il vostro assortimento non rientra nelle categorie precedenti.',
  ],
} satisfies Record<Locale, string[]>

export function guideOptionHelp(locale: Locale) {
  const c = copy[locale]
  const a = agreementCopy[locale]
  return {
    label: c.info,
    otherGoodsLabel: otherGoodsCopy[locale][0],
    agreementQuestion: a[0],
    agreementLabels: { yes: a[1], no: a[2], later: a[3] },
    unanswered: a[7],
    descriptions: {
      agreement: { yes: a[4], no: a[5], later: a[6] },
      intake: {
        single: c.single,
        bags: c.bags,
        owned: c.owned,
        new: c.new,
        pickup: c.pickup,
        space: c.space,
        other: c.other,
      },
      goods: {
        clothes: c.clothes,
        kids: c.kids,
        home: c.home,
        furniture: c.furniture,
        hobby: c.hobby,
        mixed: c.mixed,
        other: otherGoodsCopy[locale][1],
      },
      pricing: {
        store: c.store,
        together: c.together,
        seller: c.seller,
        suggestion: c.suggestion,
        both: c.both,
        later: c.later,
      },
      period: {
        collect: c.collect,
        donate: c.donate,
        extend: c.extend,
        individual: c.individual,
        later: c.later,
      },
      pos: {
        zettle: c.zettle,
        shopify: c.shopify,
        other: c.other,
        later: c.later,
      },
      channels: {
        shop: c.shop,
        web: c.web,
        social: c.social,
        market: c.market,
        later: c.later,
      },
    } satisfies Record<GuideKey, Record<string, string>>,
    checkout: {
      store: c.checkoutStore,
      seller: c.checkoutSeller,
      both: c.checkoutBoth,
      later: c.later,
    },
  }
}
export type GuideOptionHelp = ReturnType<typeof guideOptionHelp>
