/**
 * Corrispondenza fra le manifestazioni PronoBlast (codici Sisal come "POR1", "ITA1", ...)
 * e i legaId numerici di FotMob (es. 61 = Liga Portugal, etc.).
 *
 * Generato automaticamente da scripts/trova-alias-fotmob.mts.
 */

let MAPPA_LEGHE: Record<string, number> = {
  "2201": 11017, // QSL Cup
  "2684": 9265, // ASEAN Championship
  "2715": 10705, // National League Cup Group A
  "2759": 11129, // UEFA Women's Europa Cup - 2nd Qualifying Round
  "2779": 9478, // Indian Super League
  "2817": 13287, // FIFA ASEAN Cup Premier Division
  "AFRCL": 10619, // CAF Champions League Qualification
  "AFRCP": 10608, // Africa Cup of Nations Qualification Grp. H
  "ALB1": 260, // Kategoria Superiore
  "ALG1": 516, // Ligue 1
  "AMECON": 9821, // CONCACAF Nations League C Grp. 1
  "AMELGCP": 10043, // Leagues Cup
  "AMI": 489, // Club Friendlies
  "AMINAZ": 114, // Friendlies
  "ARG1": 112, // Liga Profesional Clausura
  "ARG2": 8965, // Primera Nacional
  "ARG3": 9213, // Federal A Promotion Zona A
  "ARGCP": 9305, // Copa Argentina
  "ARGSCP": 10832, // Supercopa Internacional
  "ARM1": 118, // Premier League
  "ASIACL": 525, // AFC Champions League Elite West
  "ASIACPNG": 329, // Gulf Cup Grp. A
  "ASIAG": 9833, // Asian Games Grp. D
  "AUSCP": 9471, // Australia Cup
  "AUT1": 38, // Bundesliga
  "AUT2": 119, // 2. Liga
  "AZE1": 262, // Premier League
  "BANGL1": 10443, // Bangladesh Football League
  "BEL1": 40, // Belgian Pro League
  "BEL2": 264, // First Division B
  "BOL1": 144, // Primera División
  "BOSN1": 267, // Premier League
  "BRA1": 268, // Série A
  "BRA2": 8814, // Série B
  "BRA3": 8971, // Série C
  "BRA4": 9464, // Série D
  "BRACP": 9067, // Copa do Brasil
  "BRACPPA": 11646, // Copa Paulista
  "BUL1": 270, // First Professional League
  "BUL2": 9096, // Second Professional League
  "BULSCP": 272, // Super Cup
  "CANADA1": 9986, // Premier League
  "CASAFCC": 9469, // AFC Champions League Two - B
  "CIL1": 273, // Primera División
  "CIL2": 9126, // Primera B
  "CILCP": 9091, // Cup
  "CIN1": 120, // Super League
  "CIN2": 9137, // China League
  "CIP1": 136, // Cyprus League
  "COL1": 274, // Primera A
  "COL2": 9125, // Primera B
  "COLCP": 9490, // Cup
  "CPLIB": 45, // Copa Libertadores 8th Finals
  "CPSUDAM": 299, // Copa Sudamericana 8th Finals
  "CRC1": 121, // Primera Division Apertura
  "CRCCP": 260, // Kategoria Superiore
  "CRO1": 252, // HNL
  "CROCP": 275, // Croatian Cup
  "DAN1": 46, // Superligaen
  "DAN2": 85, // 1. Division
  "DAN3": 239, // 2. Division
  "DAN4": 240, // 3. Division
  "DANCP": 242, // DBU Pokalen
  "EAU1": 538, // Pro League
  "EAUCPL": 11027, // League Cup
  "ECU1": 246, // Serie A
  "EGI1": 519, // Premier League
  "EGICP": 10270, // League Cup Grp. C
  "ELS1": 335, // Primera Division - Apertura
  "EST1": 248, // Premium liiga
  "EUCONFL": 10615, // Conference League Qualification
  "EUROSCP": 74, // UEFA Super Cup
  "EUROU21": 10437, // EURO U21 Qualification Grp. B
  "EUUYL": 9741, // UEFA Youth League League Stage
  "FAOE1": 250, // Premier League
  "FIN1": 51, // Veikkausliiga
  "FIN2": 251, // Ykkösliiga
  "FIN3": 8969, // Ykkonen
  "FRA1": 53, // Ligue 1
  "FRA2": 110, // Ligue 2
  "FRA3": 8970, // Ligue 3
  "FRASCP": 207, // Super Cup
  "GAL1": 116, // Premier League
  "GEO1": 439, // Erovnuli Liga
  "GER1": 54, // Bundesliga
  "GER2": 146, // 2. Bundesliga
  "GER3": 208, // 3. Liga
  "GERCP": 209, // DFB Pokal
  "GHA1": 522, // Premier League
  "GIA1": 223, // J. League
  "GIA1F": 9500, // WE League
  "GIA2": 8974, // J. League 2
  "GIA3": 9136, // J. League 3
  "GIACP": 9011, // Cup
  "GIACPL": 224, // League Cup
  "GRE1": 135, // Super League
  "GRE2": 8815, // Super League 2
  "GRECP": 145, // Cup Preliminary Round
  "GUAT1": 336, // Liga Nacional Apertura
  "HND1": 337, // Liga Nacional - Apertura
  "INDO1": 8983, // Super League
  "ING1": 47, // Premier League
  "ING2": 48, // Championship
  "ING2F": 9294, // WSL 2
  "ING3": 108, // League One
  "ING4": 109, // League Two
  "ING5": 117, // National League
  "ING6": 8944, // National League South
  "ING7": 8947, // Northern Premier Division
  "INGCPL": 133, // EFL Cup
  "INGCS": 247, // Community Shield
  "INGJP": 142, // EFL Trophy Southern Grp. C
  "INGU21": 9084, // Premier League 2
  "IRL1": 126, // Premier Division
  "IRL2": 218, // First Division
  "IRLCP": 219, // FAI Cup
  "IRLN1": 129, // Premiership
  "ISL1": 215, // Besta deildin
  "ISL2": 216, // 1. Deild
  "ISL3": 10226, // 2. Deild
  "ISR1": 127, // Ligat ha'Al
  "ISR2": 128, // Leumit League
  "ITA1": 55, // Serie A
  "ITA2": 86, // Serie B
  "ITA3": 147, // Serie C Grp. A
  "ITACP": 141, // Coppa Italia
  "KAZ1": 225, // Premier League
  "LET1": 226, // Virsliga
  "LIT1": 228, // A Lyga
  "LUX1": 229, // National Division
  "MAR1": 530, // Botola Pro
  "MEX1": 230, // Liga MX
  "MEX2": 8976, // Liga de Expansion MX Apertura
  "MKD1": 249, // Prva Liga
  "MLY1": 8985, // Liga Super
  "MNTNG1": 232, // 1. CFL
  "MOLD1": 231, // Super Liga
  "MONDCL": 10703, // FIFA Intercontinental Cup
  "NGR1": 533, // NPFL
  "NOR1": 59, // Eliteserien
  "NOR2": 203, // 1. Divisjon
  "NOR3": 204, // 2. Divisjon Avd. 2
  "NOR4": 205, // 3. Divisjon Avd. 4
  "NORCP": 206, // Cup
  "OLA1": 57, // Eredivisie
  "OLA2": 111, // Eerste Divisie
  "OLA3": 9195, // Tweede Divisie
  "PAR1": 199, // Division Profesional
  "PARCP": 10230, // Cup
  "PER1": 131, // Liga 1
  "PNM1": 9039, // LPF Apertura
  "POL1": 196, // Ekstraklasa
  "POL2": 197, // I Liga
  "POL3": 8935, // II Liga
  "POR1": 61, // Liga Portugal
  "POR2": 185, // Liga Portugal 2
  "POR3": 9112, // Liga 3 Zona A
  "PORCP": 186, // Taca de Portugal
  "QTR1": 535, // Qatar Stars League
  "RCEC1": 122, // 1. Liga
  "RCEC2": 253, // FNL
  "RCECCP": 254, // Cup
  "ROM1": 189, // Superliga
  "ROM2": 9113, // Liga II
  "ROMCP": 190, // Cup Grp. B
  "SAF1": 537, // Premier Soccer League
  "SAFSCP": 9474, // MTN8
  "SAU1": 536, // Saudi Pro League
  "SAU2": 10721, // Saudi First Division
  "SAUCPK": 9942, // King's Cup
  "SCO1": 64, // Premiership
  "SCO2": 123, // Championship
  "SCO3": 124, // League One
  "SCO4": 125, // League Two
  "SCOCPCH": 179, // Challenge Cup
  "SCOCPL": 180, // League Cup
  "SER1": 182, // Super Liga
  "SING1": 461, // Premier League
  "SKOR1": 9080, // K-League 1
  "SKOR2": 9116, // K League 2
  "SKOR3": 9537, // K3 League
  "SKORCP": 9551, // Cup
  "SLVK1": 176, // 1. Liga
  "SLVK2": 8973, // 2. Liga
  "SLVKCP": 177, // FA Cup
  "SLVN1": 173, // Prva Liga
  "SPA1": 87, // LaLiga
  "SPA2": 140, // LaLiga2
  "SPA3": 8968, // Primera Federacion - Group 1
  "SPA4": 9138, // Segunda Federacion - Group 1
  "SVE1": 67, // Allsvenskan
  "SVE2": 168, // Superettan
  "SVE3": 169, // Ettan Soedra
  "SVI1": 69, // Super League
  "SVI2": 163, // Challenge League
  "TANZ1": 9066, // Premier League
  "THL1": 8984, // Thai League
  "THL2": 9498, // Thai League 2
  "THLCP": 11023, // FA Cup - 1st Round
  "TUN1": 544, // Ligue I
  "TUR1": 71, // Super Lig
  "TUR2": 165, // 1. Lig
  "UCR1": 441, // Premier League
  "UNG1": 212, // NB I
  "UNG2": 9117, // NB II
  "URU1": 161, // Liga AUF Uruguaya Clausura
  "URU2": 9122, // Segunda Division
  "URUCP": 10342, // Cup
  "USA1": 130, // Major League Soccer
  "USA2": 8972, // USL Championship
  "USA3": 9296, // USL League One
  "USACP": 9441, // US Open Cup
  "USACPUS": 10654, // USL Cup
  "USARS": 10282, // MLS Next Pro
  "UZB1": 540, // Superliga
  "VNM1": 9088, // V-League
  "VNZ1": 339, // Primera División
};

export function impostaMappaLeghe(mappa: Record<string, number>) {
  MAPPA_LEGHE = { ...MAPPA_LEGHE, ...mappa };
}

export function dammiMappaLeghe(): Record<string, number> {
  return { ...MAPPA_LEGHE };
}

export function legaIdPerManifestazione(manifestazione: string): number | null {
  if (!manifestazione) return null;
  const k = manifestazione.trim().toUpperCase();
  return MAPPA_LEGHE[k] ?? null;
}

export function legaCopertaDaFotmob(manifestazione: string): boolean {
  return legaIdPerManifestazione(manifestazione) !== null;
}
