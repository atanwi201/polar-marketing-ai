// Example bot configurations and a blank template for new clients.
import type { Bot, Faq } from "./receptionist-engine";

type BotData = Omit<Bot, "id" | "createdAt" | "example">;

const whaleFaq: Faq[] = [
  {
    id: "f1", q: "Will we see whales or dolphins?",
    keys: "guarantee,guaranteed,see whales,see dolphins,sighting,garantie,garantiert,sichtung,garantito,avvistamento,garantizado,avistamiento,veremos",
    a: {
      en: "We see pilot whales or dolphins on over 95% of trips. If we see none, your next trip is free.",
      de: "Wir sehen auf über 95 % der Fahrten Grindwale oder Delfine. Sehen wir keine, ist Ihre nächste Fahrt gratis.",
      it: "Vediamo globicefali o delfini in oltre il 95% delle uscite. Se non ne vediamo, la prossima uscita è gratis.",
      es: "Vemos calderones o delfines en más del 95 % de las salidas. Si no vemos ninguno, la próxima salida es gratis.",
    },
  },
  {
    id: "f2", q: "What is included?",
    keys: "included,include,drinks,snack,swim,snorkel,inklusive,inbegriffen,getranke,schwimmen,schnorcheln,incluso,inclusa,bevande,nuotare,incluido,incluye,bebidas,banarse,esnorquel",
    a: {
      en: "Soft drinks, a light snack and a swim stop with snorkel gear are included.",
      de: "Softdrinks, ein kleiner Snack und ein Badestopp mit Schnorchelausrüstung sind inklusive.",
      it: "Bibite, uno snack e una sosta per il bagno con maschera e boccaglio sono inclusi.",
      es: "Incluye refrescos, un pequeño aperitivo y una parada para bañarse con equipo de esnórquel.",
    },
  },
  {
    id: "f3", q: "I get seasick. Is it rough?",
    keys: "seasick,sea sick,seekrank,mal di mare,mareo,mareado,me mareo",
    a: {
      en: "The catamaran is very stable. If you get seasick easily, take a tablet one hour before departure.",
      de: "Der Katamaran liegt sehr ruhig. Wer leicht seekrank wird, nimmt eine Stunde vorher eine Tablette.",
      it: "Il catamarano è molto stabile. Se soffrite il mal di mare, prendete una pastiglia un'ora prima.",
      es: "El catamarán es muy estable. Si os mareáis con facilidad, tomad una pastilla una hora antes.",
    },
  },
  {
    id: "f4", q: "Do babies pay?",
    keys: "baby,babies,infant,toddler,under 3,kleinkind,saugling,unter 3,neonato,neonati,sotto i 3,bebe,bebes,menores de 3",
    a: {
      en: "Children under 3 travel free on a parent's lap. Ages 3 to 11 pay the child price.",
      de: "Kinder unter 3 fahren gratis auf dem Schoß mit. Von 3 bis 11 Jahren gilt der Kinderpreis.",
      it: "I bambini sotto i 3 anni viaggiano gratis in braccio. Dai 3 agli 11 anni pagano il prezzo bambino.",
      es: "Los menores de 3 años viajan gratis en brazos. De 3 a 11 años pagan precio de niño.",
    },
  },
  {
    id: "f5", q: "What should we bring?",
    keys: "bring,sunscreen,towel,mitbringen,sonnencreme,handtuch,portare,crema solare,asciugamano,llevar,crema,toalla",
    a: {
      en: "Bring sunscreen, a hat, a towel and swimwear.",
      de: "Bringen Sie Sonnencreme, Hut, Handtuch und Badesachen mit.",
      it: "Portate crema solare, cappello, asciugamano e costume.",
      es: "Traed crema solar, gorra, toalla y bañador.",
    },
  },
  {
    id: "f6", q: "How do we pay?",
    keys: "pay,payment,card,cash,bezahlen,zahlung,karte,bargeld,pagare,pagamento,carta,contanti,pagar,pago,tarjeta,efectivo,bizum",
    a: {
      en: "You pay online with the secure link we send after booking. Card, Apple Pay or Bizum.",
      de: "Sie zahlen online über den sicheren Link nach der Buchung. Karte, Apple Pay oder Bizum.",
      it: "Pagate online con il link sicuro che inviamo dopo la prenotazione. Carta, Apple Pay o Bizum.",
      es: "Pagáis online con el enlace seguro que enviamos tras reservar. Tarjeta, Apple Pay o Bizum.",
    },
  },
];

export const WHALE_BOT: BotData = {
  clientId: "ex-whale",
  active: true,
  trips: [
    { id: "whale", name: "Whale & dolphin trip", times: ["10:00", "14:00"], durationH: 3, capacity: 24, priceAdult: 45, priceChild: 25, childAge: "3-11",
      keywords: "whale,dolphin,wal,wale,delfin,delfine,balena,balene,delfini,ballena,ballenas,delfines,catamaran" },
  ],
  zones: [
    { name: "Los Cristianos", fee: 0, note: "free" },
    { name: "Playa de las Américas", fee: 0, note: "free" },
    { name: "Costa Adeje", fee: 5, note: "" },
    { name: "Los Gigantes", fee: 10, note: "" },
  ],
  meetingPoint: "Los Cristianos harbour, pier 2, 30 min before departure",
  faq: whaleFaq,
  weatherRule: {
    en: "The harbour master decides on the day. If we cancel for wind or waves, you choose a new date or a full refund.",
    de: "Die Hafenbehörde entscheidet am Tag selbst. Sagen wir wegen Wind oder Wellen ab, wählen Sie einen neuen Termin oder volle Erstattung.",
    it: "Decide la capitaneria il giorno stesso. Se annulliamo per vento o mare mosso, scegliete una nuova data o il rimborso completo.",
    es: "Decide Capitanía el mismo día. Si cancelamos por viento u olas, elegís otra fecha o el reembolso completo.",
  },
  cancellationRule: {
    en: "Free cancellation up to 24 hours before departure. Later cancellations are not refunded.",
    de: "Kostenlose Stornierung bis 24 Stunden vor Abfahrt. Spätere Stornierungen werden nicht erstattet.",
    it: "Cancellazione gratuita fino a 24 ore prima della partenza. Dopo non è previsto rimborso.",
    es: "Cancelación gratuita hasta 24 horas antes de la salida. Después no hay reembolso.",
  },
  languages: ["en", "es", "de", "it"],
  handoffPhone: "+34 622 000 102",
  handoffHours: "9:00-19:00",
  reminderHours: [24, 2],
  reviewRequest: true,
  channels: { whatsapp: "connected", instagram: "connected", web: "connected", google: "pending" },
  baselineResponseMin: 95,
};

export const DIVE_BOT: BotData = {
  clientId: "ex-dive",
  active: true,
  trips: [
    { id: "dsd", name: "Discover Scuba", times: ["09:30", "14:00"], durationH: 3, capacity: 6, priceAdult: 85, priceChild: 70, childAge: "10-14",
      keywords: "discover,try dive,try diving,first dive,first time,never dived,beginner,beginners,nie getaucht,erstes mal,prima volta,primera vez,schnuppertauchen,anfanger,battesimo,principiante,bautismo,primera inmersion,proefduik" },
    { id: "fun", name: "Guided fun dive", times: ["09:00", "12:00"], durationH: 2, capacity: 8, priceAdult: 45, priceChild: 45, childAge: "12+",
      keywords: "fun dive,guided dive,certified,open water,padi,tauchgang,immersione guidata,inmersion guiada,duik" },
  ],
  zones: [
    { name: "Puerto de la Cruz", fee: 0, note: "free" },
    { name: "La Orotava", fee: 5, note: "" },
  ],
  meetingPoint: "the dive centre, Calle San Felipe, Puerto de la Cruz",
  faq: [
    {
      id: "d1", q: "Do I need a licence?",
      keys: "licence,license,certificate,certified,padi,brevet,tauchschein,brevetto,licencia,titulacion,duikbrevet",
      a: {
        en: "Discover Scuba needs no licence. Guided fun dives need PADI Open Water or equivalent.",
        de: "Für Discover Scuba brauchen Sie keinen Schein. Geführte Tauchgänge brauchen PADI Open Water oder gleichwertig.",
        es: "Para Discover Scuba no hace falta titulación. Las inmersiones guiadas requieren PADI Open Water o equivalente.",
      },
    },
    {
      id: "d2", q: "What will we see?",
      keys: "see,turtles,rays,schildkroten,rochen,tartarughe,razze,tortugas,rayas,schildpadden",
      a: { en: "Angel sharks, rays, octopus and, on most days, turtles near the old pier.", es: "Angelotes, rayas, pulpos y casi siempre tortugas junto al muelle viejo." },
    },
  ],
  weatherRule: { en: "If the swell is too high we move the dive to the sheltered bay or offer a new date.", es: "Si hay mucho mar de fondo cambiamos a la bahía resguardada u ofrecemos otra fecha." },
  cancellationRule: { en: "Free cancellation up to 48 hours before. Later, 50% is charged.", es: "Cancelación gratuita hasta 48 horas antes. Después se cobra el 50 %." },
  languages: ["en", "es", "de", "nl"],
  handoffPhone: "+34 622 000 103",
  handoffHours: "8:30-18:00",
  reminderHours: [24],
  reviewRequest: false,
  channels: { whatsapp: "connected", instagram: "off", web: "connected", google: "off" },
  baselineResponseMin: 140,
};

export function blankBot(clientId: string): BotData {
  return {
    clientId,
    active: false,
    trips: [{ id: "trip1", name: "Main trip", times: ["10:00"], durationH: 2, capacity: 12, priceAdult: 40, priceChild: 20, childAge: "3-11", keywords: "" }],
    zones: [],
    meetingPoint: "",
    faq: [],
    weatherRule: { en: "" },
    cancellationRule: { en: "Free cancellation up to 24 hours before departure." },
    languages: ["en", "es"],
    handoffPhone: "",
    handoffHours: "9:00-19:00",
    reminderHours: [24],
    reviewRequest: false,
    channels: { whatsapp: "off", instagram: "off", web: "off", google: "off" },
    baselineResponseMin: 120,
  };
}
