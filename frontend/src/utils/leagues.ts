// League acronym dictionary
// Parses codes like "ITA1", "AMINAZ", "CPSUDAM", "BRA1RS", "ARM1"

// 3-letter country codes (Italian convention provided by user)
const COUNTRY: Record<string, string> = {
  AFG: "Afghanistan",
  ALB: "Albania",
  ALG: "Algeria",
  AND: "Andorra",
  ANG: "Angola",
  ARA: "Arabia Saudita",
  ARG: "Argentina",
  ARM: "Armenia",
  AUS: "Australia",
  AUT: "Austria",
  AZE: "Azerbaigian",
  BEL: "Belgio",
  BOL: "Bolivia",
  BRA: "Brasile",
  BUL: "Bulgaria",
  CAM: "Camerun",
  CAN: "Canada",
  CHI: "Cile",
  CIN: "Cina",
  COL: "Colombia",
  COR: "Corea del Sud",
  COS: "Costa Rica",
  CRO: "Croazia",
  DAN: "Danimarca",
  ECU: "Ecuador",
  EGI: "Egitto",
  ESA: "El Salvador",
  EST: "Estonia",
  FIL: "Filippine",
  FIN: "Finlandia",
  FRA: "Francia",
  GAL: "Galles",
  GEO: "Georgia",
  GER: "Germania",
  GHA: "Ghana",
  GIA: "Giappone",
  GIO: "Giordania",
  GRE: "Grecia",
  GUA: "Guatemala",
  GUI: "Guinea",
  HON: "Honduras",
  IND: "India",
  ING: "Inghilterra",
  IRA: "Iran",
  IRL: "Irlanda",
  ISL: "Islanda",
  ISR: "Israele",
  ITA: "Italia",
  KAZ: "Kazakistan",
  KEN: "Kenya",
  LET: "Lettonia",
  LIT: "Lituania",
  LUX: "Lussemburgo",
  MAR: "Marocco",
  MEX: "Messico",
  MOL: "Moldavia",
  MON: "Montenegro",
  NIG: "Nigeria",
  NOR: "Norvegia",
  NUA: "Nuova Zelanda",
  OLA: "Olanda",
  PAN: "Panama",
  PAR: "Paraguay",
  PER: "Perù",
  POL: "Polonia",
  POR: "Portogallo",
  QAT: "Qatar",
  REP: "Repubblica Ceca",
  ROM: "Romania",
  RUS: "Russia",
  SCO: "Scozia",
  SEN: "Senegal",
  SER: "Serbia",
  SIN: "Singapore",
  SLO: "Slovenia",
  SPA: "Spagna",
  SRI: "Sri Lanka",
  SUD: "Sudafrica",
  SUR: "Suriname",
  SVE: "Svezia",
  SVI: "Svizzera",
  TAG: "Tagikistan",
  TAI: "Thailandia",
  TUN: "Tunisia",
  TUR: "Turchia",
  UCR: "Ucraina",
  UNG: "Ungheria",
  URU: "Uruguay",
  USA: "Stati Uniti",
  UZB: "Uzbekistan",
  VEN: "Venezuela",
  VIE: "Vietnam",
};

const CATEGORY: Record<string, string> = {
  "1": "Prima Lega",
  "2": "Seconda Lega",
  "3": "Terza Lega",
  "4": "Quarta Lega",
  "5": "Quinta Lega",
  "6": "Sesta Lega",
  F: "Femminile",
  U17: "Under 17",
  U19: "Under 19",
  U20: "Under 20",
  U21: "Under 21",
  U23: "Under 23",
  CP: "Coppa",
  CUP: "Coppa",
  RS: "Riserve",
  CH: "Champions League",
  EU: "Europa League",
  CONF: "Conference League",
};

const AREA_BY_COUNTRY: Record<string, string> = {
  // Europa
  Italia: "Europa", Inghilterra: "Europa", Spagna: "Europa", Germania: "Europa",
  Francia: "Europa", Olanda: "Europa", Portogallo: "Europa", Belgio: "Europa",
  Svizzera: "Europa", Scozia: "Europa", Irlanda: "Europa", Norvegia: "Europa",
  Svezia: "Europa", Danimarca: "Europa", Finlandia: "Europa", Polonia: "Europa",
  "Repubblica Ceca": "Europa", Ungheria: "Europa", Romania: "Europa",
  Bulgaria: "Europa", Serbia: "Europa", Croazia: "Europa", Austria: "Europa",
  Russia: "Europa", Ucraina: "Europa", Turchia: "Europa", Grecia: "Europa",
  Galles: "Europa", Georgia: "Europa", Albania: "Europa", Andorra: "Europa",
  Armenia: "Europa", Azerbaigian: "Europa", Estonia: "Europa", Islanda: "Europa",
  Lettonia: "Europa", Lituania: "Europa", Lussemburgo: "Europa",
  Moldavia: "Europa", Montenegro: "Europa", Slovenia: "Europa",
  // America
  Brasile: "America", Argentina: "America", "Stati Uniti": "America",
  Messico: "America", Colombia: "America", Cile: "America", Uruguay: "America",
  Paraguay: "America", Bolivia: "America", Ecuador: "America", Perù: "America",
  Venezuela: "America", Canada: "America", "Costa Rica": "America",
  "El Salvador": "America", Guatemala: "America", Honduras: "America",
  Panama: "America", Suriname: "America",
  // Asia
  Giappone: "Asia", "Corea del Sud": "Asia", Cina: "Asia", India: "Asia",
  "Arabia Saudita": "Asia", Iran: "Asia", Kazakistan: "Asia", Qatar: "Asia",
  Giordania: "Asia", Singapore: "Asia", Tagikistan: "Asia", Thailandia: "Asia",
  Uzbekistan: "Asia", Vietnam: "Asia", "Sri Lanka": "Asia", Afghanistan: "Asia",
  Israele: "Asia",
  // Oceania
  Australia: "Oceania", "Nuova Zelanda": "Oceania",
  // Africa
  Egitto: "Africa", Marocco: "Africa", Tunisia: "Africa", Algeria: "Africa",
  Sudafrica: "Africa", Nigeria: "Africa", Ghana: "Africa", Camerun: "Africa",
  Senegal: "Africa", Kenya: "Africa", Angola: "Africa", Guinea: "Africa",
};

// Special tournament prefixes (not country-based)
// Can use a `build` function to construct the label dynamically from regex match groups
const SPECIAL: { match: RegExp; build: (m: RegExpMatchArray) => string; area: string }[] = [
  { match: /^AMIU(\d{2})/, build: (m) => `Amichevole Under ${m[1]}`, area: "Mondo" },
  { match: /^AMIF/, build: () => "Amichevole Femminile", area: "Mondo" },
  { match: /^AMINAZ/, build: () => "Amichevole Nazionali", area: "Mondo" },
  { match: /^AMICLUB/, build: () => "Amichevole Club", area: "Mondo" },
  { match: /^AMI/, build: () => "Amichevole", area: "Mondo" },
  // Competizioni UEFA per club. EUCHL ed EUEL non erano riconosciute da
  // nessuna regola (/^CHAM/ non cattura EUCHL, /^EUR(?!O)/ non cattura EUEL):
  // finivano in area "Mondo" col codice grezzo al posto del nome, quindi
  // invisibili nei filtri e non cercabili. Vanno PRIMA della regola generica
  // /^EU/ qui sotto.
  { match: /^EUCONFL/, build: () => "UEFA Conference League", area: "Europa" },
  { match: /^EUCHL/, build: () => "UEFA Champions League", area: "Europa" },
  { match: /^EUEL/, build: () => "UEFA Europa League", area: "Europa" },
  { match: /^EUNL/, build: () => "UEFA Nations League", area: "Europa" },
  { match: /^EUSC/, build: () => "Supercoppa UEFA", area: "Europa" },
  { match: /^EURO/, build: () => "Campionato Europeo", area: "Europa" },
  { match: /^CPSUDAM/, build: () => "Coppa Sudamerica", area: "America" },
  { match: /^CPLIB/, build: () => "Coppa Libertadores", area: "America" },
  { match: /^CPCAR/, build: () => "Coppa Caraibica", area: "America" },
  { match: /^CONCAF/, build: () => "Concacaf", area: "America" },
  { match: /^CHAM/, build: () => "Champions League", area: "Europa" },
  { match: /^EUR(?!O)/, build: () => "Europa League", area: "Europa" },
  { match: /^CONF/, build: () => "Conference League", area: "Europa" },
  { match: /^MOND/, build: () => "Mondiali", area: "Mondo" },
  // Rete di sicurezza: un codice UEFA che non conosciamo ancora finisce
  // comunque in Europa invece che in "Mondo". Da sostituire con la regola
  // giusta appena sappiamo il codice esatto.
  { match: /^EU/, build: () => "Competizione europea", area: "Europa" },
];

const leagueCache = new Map<string, any>();

export function parseLeagueCode(code: string): {
  country?: string;
  category?: string;
  area: string;
  label: string;       // human readable e.g. "Argentina · Massima Serie"
  shortLabel: string;  // compact e.g. "ARG1 (Argentina)"
  isTop: boolean;
} {
  if (!code) return { area: "Mondo", label: "—", shortLabel: "—", isTop: false };
  const raw = code.trim();
  const c = raw.toUpperCase();
  const hit = leagueCache.get(c);
  if (hit) return hit;

  // 1) SPECIAL tournaments
  for (const s of SPECIAL) {
    const mm = c.match(s.match);
    if (mm) {
      const label = s.build(mm);
      const res = {
        area: s.area,
        label,
        shortLabel: `${raw} (${label})`,
        isTop: false,
      };
      leagueCache.set(c, res);
      return res;
    }
  }

  // 2) Country 3-letter prefix
  let country: string | undefined;
  let category: string | undefined;
  let area = "Mondo";
  const parts: string[] = [];

  for (const [prefix, name] of Object.entries(COUNTRY)) {
    if (c.startsWith(prefix)) {
      country = name;
      parts.push(name);
      area = AREA_BY_COUNTRY[name] || "Mondo";
      const rest = c.slice(prefix.length);
      // Special case: if "CP" appears anywhere in the rest → it's a Coppa
      // Examples: AUSQCP → Australia Coppa, ECUCP → Ecuador Coppa
      if (/CP/.test(rest)) {
        category = "Coppa";
        parts.push("Coppa");
        // Also check for Femminile/Riserve suffix
        if (rest.endsWith("F")) parts.push("Femminile");
        if (rest.endsWith("RS")) parts.push("Riserve");
        break;
      }
      const catMatch = rest.match(/^(U\d{2}|F|CP|CUP|RS|CH|EU|CONF)/);
      if (catMatch) {
        category = CATEGORY[catMatch[1]] || catMatch[1];
        parts.push(category);
      } else {
        const numMatch = rest.match(/^(\d+)/);
        if (numMatch) {
          category = CATEGORY[numMatch[1]] || `Serie ${numMatch[1]}`;
          parts.push(category);
          const tail = rest.slice(numMatch[1].length);
          if (tail) {
            const tailLabel = CATEGORY[tail] || "";
            if (tailLabel) parts.push(tailLabel);
          }
        }
      }
      break;
    }
  }

  const isTop = !!country && /^[A-Z]+1(?!\d)/.test(c);
  const label = parts.join(" · ") || c;
  // Build shortLabel with country + category (+ tail suffix like Riserve/Femminile/Coppa)
  // Examples: "ITA1 (Italia Prima Lega)", "ECUCP (Ecuador Coppa)", "ARG2RS (Argentina Seconda Lega Riserve)"
  const shortLabel = country
    ? `${raw} (${parts.join(" ")})`
    : raw;
  const res = { country, category, area, label, shortLabel, isTop };
  leagueCache.set(c, res);
  return res;
}


// ============================================================
// COMPETIZIONI "PRINCIPALI" (14/09/2026)
// ============================================================
// Il tasto PRINCIPALI usava `isTop`, cioe' "prima divisione di QUALSIASI
// nazione": in una giornata piena uscivano decine di campionati. Rossi vuole
// un elenco ristretto e deciso da lui.
export const MAIN_LEAGUE_CODES = [
  "GER1", "ING1", "SPA1", "ITA1", "FRA1", "OLA1",
  "NOR1", "POR1", "USA1", "SVE1", "DAN1",
];

/** Prima divisione vera: ITA1 si', ITA1F (femminile) e BRA1RS (riserve) no.
 *  `isTop` usa /^[A-Z]+1(?!\d)/, che invece li accetta entrambi. */
export function isFirstDivision(code: string): boolean {
  const c = (code || "").toUpperCase().trim();
  return /^[A-Z]{2,4}1$/.test(c) && !!parseLeagueCode(c).country;
}

/** Cosa mostra PRINCIPALI quando NON c'e' nessuna nazione selezionata:
 *  l'elenco fisso qui sopra piu' tutte le competizioni europee per club
 *  (EUCHL, EUEL, EUCONFL...), che non hanno una nazione e quindi non
 *  sarebbero raggiungibili in nessun altro modo. */
export function isMainLeague(code: string): boolean {
  const c = (code || "").toUpperCase().trim();
  return MAIN_LEAGUE_CODES.includes(c) || /^EU/.test(c);
}
