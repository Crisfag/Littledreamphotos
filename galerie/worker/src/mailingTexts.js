// Textes par défaut des relances automatiques et des modèles de campagne,
// en français, anglais et néerlandais. Le photographe peut tout réécrire
// (onglet Relances) ; ces textes servent de point de départ.
//
// Variables : {prenom} (prénom du client, ou « Famille Martin »), {studio},
// {galerie} (titre de la galerie), {remise} (« 20 % »), {fin} (date de fin
// d'une offre), {occasion} (« les 6 mois de Léa », « Noël »…).
// Corps : paragraphes séparés par une ligne vide ; **gras** autorisé.

export const AUTOMATION_TEXTS = {
  // Galerie envoyée, aucun coup de cœur au bout de quelques jours.
  selection_nudge: {
    fr: {
      subject: "Vos photos vous attendent, {prenom}",
      body: "Bonjour {prenom},\n\nVotre galerie « {galerie} » est en ligne depuis quelques jours, et vos photos n'attendent que vous.\n\nPrenez un moment au calme, ouvrez-la et touchez le cœur de vos photos préférées : c'est tout ce qu'il faut pour faire votre sélection.\n\nÀ très vite,\n{studio}",
      cta: "Ouvrir ma galerie",
    },
    en: {
      subject: "Your photos are waiting for you, {prenom}",
      body: "Hello {prenom},\n\nYour gallery ‘{galerie}’ has been online for a few days now, and your photos are just waiting for you.\n\nFind a quiet moment, open it and tap the heart on your favourite photos: that's all it takes to make your selection.\n\nSpeak soon,\n{studio}",
      cta: "Open my gallery",
    },
    nl: {
      subject: "Je foto's wachten op je, {prenom}",
      body: "Dag {prenom},\n\nJe galerij ‘{galerie}’ staat al een paar dagen online, en je foto's wachten alleen nog op jou.\n\nNeem rustig even de tijd, open ze en tik op het hartje bij je favoriete foto's: meer is er niet nodig om je selectie te maken.\n\nTot snel,\n{studio}",
      cta: "Open mijn galerij",
    },
  },
  // À la première ouverture de la galerie : remise sur les tirages, 72 h.
  early_bird: {
    fr: {
      subject: "{remise} sur vos tirages, jusqu'au {fin}",
      body: "Bonjour {prenom},\n\nPour fêter l'arrivée de vos photos, profitez de **{remise} sur tous les tirages** de votre galerie « {galerie} », jusqu'au {fin}.\n\nTirages, toiles, cadres : choisissez vos photos préférées et recevez-les directement chez vous.\n\n{studio}",
      cta: "Voir les tirages",
    },
    en: {
      subject: "{remise} off your prints until {fin}",
      body: "Hello {prenom},\n\nTo celebrate the arrival of your photos, enjoy **{remise} off all prints** from your gallery ‘{galerie}’ until {fin}.\n\nPrints, canvases, frames: choose your favourite photos and have them delivered straight to your door.\n\n{studio}",
      cta: "See the prints",
    },
    nl: {
      subject: "{remise} korting op je afdrukken tot {fin}",
      body: "Dag {prenom},\n\nOm de komst van je foto's te vieren, krijg je tot {fin} **{remise} korting op alle afdrukken** uit je galerij ‘{galerie}’.\n\nAfdrukken, canvas, kaders: kies je favoriete foto's en ontvang ze gewoon bij je thuis.\n\n{studio}",
      cta: "Bekijk de afdrukken",
    },
  },
  // Un an après la séance.
  anniversary: {
    fr: {
      subject: "Il y a un an déjà, {prenom}",
      body: "Bonjour {prenom},\n\nIl y a un an, nous faisions ensemble la séance « {galerie} ». Le temps file, et les visages changent si vite !\n\nC'est le bon moment pour immortaliser cette nouvelle année : je serais ravie de vous retrouver devant l'objectif.\n\nÀ bientôt,\n{studio}",
      cta: "Réserver une séance",
    },
    en: {
      subject: "A year ago already, {prenom}",
      body: "Hello {prenom},\n\nA year ago, we did your ‘{galerie}’ session together. Time flies, and faces change so quickly!\n\nIt's the perfect moment to capture this new year: I'd love to see you in front of the camera again.\n\nSee you soon,\n{studio}",
      cta: "Book a session",
    },
    nl: {
      subject: "Al een jaar geleden, {prenom}",
      body: "Dag {prenom},\n\nEen jaar geleden deden we samen de fotoshoot ‘{galerie}’. De tijd vliegt, en gezichtjes veranderen zo snel!\n\nHet is het ideale moment om dit nieuwe jaar vast te leggen: ik zou het fijn vinden om je weer voor de lens te zien.\n\nTot binnenkort,\n{studio}",
      cta: "Boek een fotoshoot",
    },
  },
  // Quelques jours après la livraison en haute définition.
  review: {
    fr: {
      subject: "Un petit mot sur votre séance ?",
      body: "Bonjour {prenom},\n\nJ'espère que vous profitez de vos photos de « {galerie} » !\n\nSi vous avez aimé notre séance, quelques mots de votre part m'aideraient énormément : c'est grâce à vos avis que d'autres familles me trouvent.\n\nCela ne prend qu'une minute. Merci du fond du cœur,\n{studio}",
      cta: "Laisser un avis",
    },
    en: {
      subject: "A quick word about your session?",
      body: "Hello {prenom},\n\nI hope you're enjoying your photos from ‘{galerie}’!\n\nIf you loved our session, a few words from you would help me enormously: it's thanks to your reviews that other families find me.\n\nIt only takes a minute. Thank you from the bottom of my heart,\n{studio}",
      cta: "Leave a review",
    },
    nl: {
      subject: "Een woordje over je fotoshoot?",
      body: "Dag {prenom},\n\nIk hoop dat je volop geniet van je foto's van ‘{galerie}’!\n\nVond je onze fotoshoot fijn? Dan zouden een paar woorden van jou me enorm helpen: dankzij reviews zoals de jouwe vinden andere gezinnen de weg naar mij.\n\nHet duurt maar een minuutje. Van harte bedankt,\n{studio}",
      cta: "Schrijf een review",
    },
  },
  // Client sans séance depuis près d'un an.
  dormant: {
    fr: {
      subject: "Et si on se revoyait, {prenom} ?",
      body: "Bonjour {prenom},\n\nCela fait un moment que nous ne nous sommes pas vus, et je repense souvent à notre dernière séance.\n\nLes enfants grandissent, les saisons passent : si l'envie vous prend de nouvelles photos, mon agenda vous attend.\n\nBelle journée,\n{studio}",
      cta: "Voir les disponibilités",
    },
    en: {
      subject: "Shall we catch up, {prenom}?",
      body: "Hello {prenom},\n\nIt's been a while since we last saw each other, and I often think back to our last session.\n\nThe children are growing, the seasons are changing: if you fancy some new photos, my diary is open for you.\n\nHave a lovely day,\n{studio}",
      cta: "See availability",
    },
    nl: {
      subject: "Zien we elkaar nog eens, {prenom}?",
      body: "Dag {prenom},\n\nHet is alweer een tijdje geleden dat we elkaar zagen, en ik denk nog vaak terug aan onze laatste fotoshoot.\n\nDe kinderen worden groter, de seizoenen gaan voorbij: heb je zin in nieuwe foto's, dan staat mijn agenda voor je open.\n\nNog een fijne dag,\n{studio}",
      cta: "Bekijk de beschikbaarheid",
    },
  },
  // Date à retenir (anniversaire, étape de bébé, saison) : envoyé au client.
  dates: {
    fr: {
      subject: "{occasion} approche !",
      body: "Bonjour {prenom},\n\n{occasion} approche, et c'est un moment qui mérite d'être immortalisé.\n\nJe serais ravie de vous proposer une séance pour l'occasion : choisissez simplement le créneau qui vous convient.\n\nÀ très vite,\n{studio}",
      cta: "Réserver une séance",
    },
    en: {
      subject: "{occasion} is coming up!",
      body: "Hello {prenom},\n\n{occasion} is coming up, and it's a moment that deserves to be captured.\n\nI'd love to offer you a session for the occasion: simply choose the time slot that suits you.\n\nSpeak soon,\n{studio}",
      cta: "Book a session",
    },
    nl: {
      subject: "Binnenkort: {occasion}!",
      body: "Dag {prenom},\n\nBinnenkort is het zover: {occasion}. Zo'n moment verdient het om vastgelegd te worden.\n\nIk bied je graag een fotoshoot aan voor de gelegenheid: kies gewoon het moment dat jou het best past.\n\nTot snel,\n{studio}",
      cta: "Boek een fotoshoot",
    },
  },
};

// Modèles de campagne : point de départ, tout se réécrit.
// cta : booking (page de réservation) | gallery (sa dernière galerie) | none.
// printPromo : remise suggérée sur les tirages de ses galeries ouvertes.
export const CAMPAIGN_TEMPLATES = [
  {
    key: "noel",
    name: { fr: "Séances de Noël", en: "Christmas sessions", nl: "Kerstshoots" },
    cta: "booking",
    texts: {
      fr: {
        subject: "Les séances de Noël sont ouvertes ✨",
        body: "Bonjour {prenom},\n\nLes fêtes approchent, et avec elles mes **séances de Noël** : décor douillet, lumière chaude, et des photos prêtes à temps pour vos cartes de vœux et vos cadeaux.\n\nLes places partent vite : réservez la vôtre dès maintenant.\n\nÀ très vite,\n{studio}",
        cta: "Réserver ma séance de Noël",
      },
      en: {
        subject: "Christmas sessions are open ✨",
        body: "Hello {prenom},\n\nThe festive season is nearly here, and with it my **Christmas sessions**: a cosy setting, warm light, and photos ready in time for your Christmas cards and gifts.\n\nSpaces go quickly: book yours now.\n\nSpeak soon,\n{studio}",
        cta: "Book my Christmas session",
      },
      nl: {
        subject: "De kerstshoots zijn open ✨",
        body: "Dag {prenom},\n\nDe feestdagen komen eraan, en daarmee ook mijn **kerstshoots**: een gezellig decor, warm licht en foto's die op tijd klaar zijn voor je wenskaarten en cadeaus.\n\nDe plaatsen zijn snel volzet: reserveer de jouwe nu al.\n\nTot snel,\n{studio}",
        cta: "Reserveer mijn kerstshoot",
      },
    },
  },
  {
    key: "fete_meres",
    name: { fr: "Fête des mères", en: "Mother's Day", nl: "Moederdag" },
    cta: "booking",
    texts: {
      fr: {
        subject: "Un cadeau qui dure pour la fête des mères",
        body: "Bonjour {prenom},\n\nPour la fête des mères, offrez un souvenir qui ne prend pas la poussière : une **séance maman et enfants**, tout en douceur.\n\nLe bon cadeau peut aussi s'offrir en ligne, à imprimer ou à envoyer par e-mail.\n\n{studio}",
        cta: "Découvrir les séances",
      },
      en: {
        subject: "A lasting gift for Mother's Day",
        body: "Hello {prenom},\n\nThis Mother's Day, give a keepsake that won't gather dust: a gentle, relaxed **mum and children session**.\n\nGift vouchers can also be bought online, to print or to send by email.\n\n{studio}",
        cta: "Explore the sessions",
      },
      nl: {
        subject: "Een blijvend cadeau voor Moederdag",
        body: "Dag {prenom},\n\nGeef voor Moederdag een herinnering die geen stof vangt: een zachte, ontspannen **fotoshoot voor mama en de kinderen**.\n\nDe cadeaubon kan je ook online kopen, om zelf af te drukken of per e-mail te versturen.\n\n{studio}",
        cta: "Ontdek de fotoshoots",
      },
    },
  },
  {
    key: "mini",
    name: { fr: "Mini-séances", en: "Mini sessions", nl: "Minishoots" },
    cta: "booking",
    texts: {
      fr: {
        subject: "Mini-séances : quelques créneaux seulement",
        body: "Bonjour {prenom},\n\nJ'organise une journée de **mini-séances** : 20 minutes, quelques photos choisies, un prix doux.\n\nParfait pour un portrait de famille à jour ou un cadeau. Les créneaux sont limités : premier arrivé, premier servi !\n\n{studio}",
        cta: "Choisir mon créneau",
      },
      en: {
        subject: "Mini sessions: just a few slots",
        body: "Hello {prenom},\n\nI'm holding a day of **mini sessions**: 20 minutes, a few hand-picked photos, a very friendly price.\n\nPerfect for an up-to-date family portrait or a gift. Slots are limited: first come, first served!\n\n{studio}",
        cta: "Choose my slot",
      },
      nl: {
        subject: "Minishoots: maar enkele plaatsen vrij",
        body: "Dag {prenom},\n\nIk organiseer een dag vol **minishoots**: 20 minuten, een handvol uitgekozen foto's, een vriendelijk prijsje.\n\nIdeaal voor een actueel familieportret of als cadeau. De plaatsen zijn beperkt: wie eerst komt, eerst maalt!\n\n{studio}",
        cta: "Kies mijn moment",
      },
    },
  },
  {
    key: "tirages",
    name: { fr: "Vente flash tirages", en: "Print flash sale", nl: "Flashverkoop afdrukken" },
    cta: "gallery",
    printPromo: 20,
    texts: {
      fr: {
        subject: "{remise} sur vos tirages, jusqu'au {fin}",
        body: "Bonjour {prenom},\n\nVos photos méritent mieux qu'un écran : jusqu'au {fin}, profitez de **{remise} sur tous les tirages, toiles et cadres** de votre galerie.\n\nIls sont fabriqués par notre laboratoire et livrés chez vous.\n\n{studio}",
        cta: "Voir mes photos",
      },
      en: {
        subject: "{remise} off your prints until {fin}",
        body: "Hello {prenom},\n\nYour photos deserve more than a screen: until {fin}, enjoy **{remise} off all prints, canvases and frames** from your gallery.\n\nThey're made by our lab and delivered to your door.\n\n{studio}",
        cta: "See my photos",
      },
      nl: {
        subject: "{remise} korting op je afdrukken tot {fin}",
        body: "Dag {prenom},\n\nJe foto's verdienen meer dan een scherm: tot {fin} krijg je **{remise} korting op alle afdrukken, canvas en kaders** uit je galerij.\n\nZe worden gemaakt door ons labo en bij je thuis geleverd.\n\n{studio}",
        cta: "Bekijk mijn foto's",
      },
    },
  },
  {
    key: "rentree",
    name: { fr: "Rentrée", en: "Back to school", nl: "Terug naar school" },
    cta: "booking",
    texts: {
      fr: {
        subject: "Une photo de rentrée qui leur ressemble",
        body: "Bonjour {prenom},\n\nNouvelle année, nouveau cartable, nouvelles dents en moins : la rentrée est le moment idéal pour un **portrait des enfants**.\n\nQuelques créneaux sont ouverts en septembre, réservez celui qui vous convient.\n\n{studio}",
        cta: "Réserver",
      },
      en: {
        subject: "A back-to-school photo that's truly them",
        body: "Hello {prenom},\n\nNew year, new school bag, a few more gaps in their smiles: back to school is the perfect time for a **portrait of the children**.\n\nA few slots are open in September, so book the one that suits you.\n\n{studio}",
        cta: "Book now",
      },
      nl: {
        subject: "Een schoolfoto die echt bij hen past",
        body: "Dag {prenom},\n\nNieuw schooljaar, nieuwe boekentas, weer een paar tandjes minder: de start van het schooljaar is het ideale moment voor een **portret van de kinderen**.\n\nIn september heb ik nog enkele plaatsen vrij, reserveer gerust degene die jou het best past.\n\n{studio}",
        cta: "Reserveer",
      },
    },
  },
  {
    key: "valentin",
    name: { fr: "Saint-Valentin", en: "Valentine's Day", nl: "Valentijn" },
    cta: "booking",
    texts: {
      fr: {
        subject: "Une séance à deux pour la Saint-Valentin",
        body: "Bonjour {prenom},\n\nEt si cette année, vous offriez **une séance photo à deux** ? Un moment complice, des images qui vous ressemblent.\n\nÀ réserver pour vous, ou à offrir en bon cadeau.\n\n{studio}",
        cta: "Réserver une séance couple",
      },
      en: {
        subject: "A session for two this Valentine's Day",
        body: "Hello {prenom},\n\nWhat if this year you treated yourselves to **a photo session for two**? A moment together, and pictures that are truly you.\n\nBook it for yourselves, or give it as a gift voucher.\n\n{studio}",
        cta: "Book a couples session",
      },
      nl: {
        subject: "Een shoot met z'n tweetjes voor Valentijn",
        body: "Dag {prenom},\n\nWat als je dit jaar eens kiest voor **een fotoshoot met z'n tweetjes**? Een moment samen, met beelden die echt bij jullie passen.\n\nBoek hem voor jullie samen, of schenk hem als cadeaubon.\n\n{studio}",
        cta: "Boek een koppelshoot",
      },
    },
  },
  {
    key: "nouvelles",
    name: { fr: "Nouvelles du studio", en: "Studio news", nl: "Nieuws van de studio" },
    cta: "none",
    texts: {
      fr: {
        subject: "Des nouvelles du studio",
        body: "Bonjour {prenom},\n\nQuelques nouvelles du studio : …\n\nMerci de votre fidélité,\n{studio}",
        cta: "",
      },
      en: {
        subject: "News from the studio",
        body: "Hello {prenom},\n\nA little news from the studio: …\n\nThank you for your continued support,\n{studio}",
        cta: "",
      },
      nl: {
        subject: "Nieuws uit de studio",
        body: "Dag {prenom},\n\nEven wat nieuws uit de studio: …\n\nBedankt om me trouw te blijven,\n{studio}",
        cta: "",
      },
    },
  },
];

// « Les 6 mois de Léa », « Noël »… dans la langue du client.
const SEASON_NAMES = {
  noel: ["Noël", "Christmas", "Kerstmis"],
  valentin: ["La Saint-Valentin", "Valentine's Day", "Valentijnsdag"],
  paques: ["Pâques", "Easter", "Pasen"],
  meres: ["La fête des mères", "Mother's Day", "Moederdag"],
  peres: ["La fête des pères", "Father's Day", "Vaderdag"],
  rentree: ["La rentrée", "Back to school", "Het nieuwe schooljaar"],
  halloween: ["Halloween", "Halloween", "Halloween"],
};

export function occasionText(lang, { kind, label, years, months }) {
  const i = lang === "en" ? 1 : lang === "nl" ? 2 : 0;
  const name = String(label || "").trim();
  if (kind === "season") return (SEASON_NAMES[name] || [name, name, name])[i];
  if (kind === "baby" && months) {
    return [`Les ${months} mois de ${name}`, `${name}'s ${months}-month milestone`, `${name} wordt ${months} maanden`][i];
  }
  if (kind === "birthday" || kind === "baby") {
    if (years) return [`Les ${years} ans de ${name}`, `${name}'s ${years}${ordinalEn(years)} birthday`, `${name} wordt ${years}`][i];
    return [`L'anniversaire de ${name}`, `${name}'s birthday`, `De verjaardag van ${name}`][i];
  }
  if (kind === "wedding") {
    if (years) return [`Vos ${years} ans de mariage`, `Your ${years}${ordinalEn(years)} wedding anniversary`, `Jullie ${years}-jarig huwelijk`][i];
    return ["Votre anniversaire de mariage", "Your wedding anniversary", "Jullie huwelijksverjaardag"][i];
  }
  return name || ["Une date importante", "An important date", "Een belangrijke datum"][i];
}

function ordinalEn(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return "th";
  return { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th";
}

// Textes d'une relance pour une langue : ceux du photographe, sinon les
// textes par défaut (la langue demandée, sinon le français).
export function automationTexts(key, lang, custom) {
  const defaults = AUTOMATION_TEXTS[key] || {};
  const own = custom && custom[lang];
  const base = defaults[lang] && defaults[lang].subject ? defaults[lang] : defaults.fr || { subject: "", body: "", cta: "" };
  return {
    subject: own?.subject || base.subject,
    body: own?.body || base.body,
    cta: own?.cta !== undefined && own?.cta !== "" ? own.cta : base.cta,
    custom: Boolean(own?.subject || own?.body),
  };
}
