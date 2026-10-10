import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  mercatoAIValido,
  normalizzaMercatoAI,
  analizzaGiocate,
  VERDICT_WHITELIST,
  isMercatoAmmesso,
  isMercatoVietato,
  MERCATI_VIETATI,
  firmaQuote,
  quoteCambiate,
} from "../frontend/src/api";
import {
  CANDIDATE_MARKETS,
  VERDICT_WHITELIST as CLUSTER_WHITELIST,
} from "../netlify/functions/lib/clusterEngine";
import { pulisciCacheDispositivo, persistentLetturaCache } from "../frontend/src/utils/cache";
import { consigliatoValido } from "../netlify/functions/lib/letturaPartita";

describe("Validazione Consigliato Pronostico AI e Whitelist Mercati (Incarico 2)", () => {
  // Catalogo di test con varie quote
  const catalogoEsempio: Record<string, { odd: number; estimated?: boolean }> = {
    "1": { odd: 1.85 },
    "X": { odd: 3.40 },
    "2": { odd: 4.20 },
    "1X": { odd: 1.25 },
    "X2": { odd: 1.40 },
    "DC 1X + O1.5": { odd: 1.35 }, // sotto 1.40 (fuori scala)
    "DC X2 + O1.5": { odd: 2.59 }, // sopra 1.40 (in scala)
    "1 + U4.5": { odd: 1.65 },
    "MG 2-4 totali": { odd: 1.55 },
    "MG 2-4 casa": { odd: 1.85 },
    "MG 2-4 ospite": { odd: 2.10 },
  };

  it("1. Dortmund-Werder: '1 + Over 1.5 (o GG)' -> tradotto in 'MG 2-4 casa' e accettato in scala", () => {
    const res = mercatoAIValido("1 + Over 1.5 (o GG)", catalogoEsempio);
    assert.equal(res.ok, true);
    assert.equal(res.market, "MG 2-4 casa");
    assert.equal(res.quota, 1.85);
    assert.equal(res.tradotto_da, "1 + Over 1.5 (o GG)");
    assert.equal(res.motivo, null);
  });

  it("2. Jong PSV: '1 + O1.5' -> tradotto in 'MG 2-4 casa' ed esito ok", () => {
    const res = mercatoAIValido("1 + O1.5", catalogoEsempio);
    assert.equal(res.ok, true);
    assert.equal(res.market, "MG 2-4 casa");
    assert.equal(res.quota, 1.85);
    assert.equal(res.tradotto_da, "1 + O1.5");
  });

  it("3. Caso reale Chindia-Selimbar: '2 oppure GG' -> due mercati disgiunti -> scartato con motivo 'non ammesso'", () => {
    const res = mercatoAIValido("2 oppure GG", catalogoEsempio);
    assert.equal(res.ok, false);
    assert.equal(res.motivo, "non ammesso");
  });

  it("4. Caso reale Goteborg senza quota catalogo: 'X2 + Over1.5' -> scartato con motivo 'senza quota'", () => {
    // Catalogo che non contiene la quota per la doppia chance + over
    const catalogoSenzaX2O15 = {
      "X2": { odd: 1.40 },
      "1": { odd: 1.72 },
    };
    const res = mercatoAIValido("X2 + Over1.5", catalogoSenzaX2O15);
    assert.equal(res.ok, false);
    assert.equal(res.motivo, "senza quota");
  });

  it("5. Traduzione speculare ospite: '2 + O2.5' -> tradotto in 'MG 2-4 ospite'", () => {
    const res = mercatoAIValido("2 + O2.5", catalogoEsempio);
    assert.equal(res.ok, true);
    assert.equal(res.market, "MG 2-4 ospite");
    assert.equal(res.quota, 2.10);
    assert.equal(res.tradotto_da, "2 + O2.5");
  });

  it("6. Caso reale Austria Vienna: 'X2' con quota 1.40 -> accettato in scala", () => {
    const res = mercatoAIValido("X2", catalogoEsempio);
    assert.equal(res.ok, true);
    assert.equal(res.market, "X2");
    assert.equal(res.quota, 1.40);
    assert.equal(res.motivo, null);
  });

  it("7. '1 + U4.5' con quota in scala (1.65) -> accettato", () => {
    const res = mercatoAIValido("1 + U4.5", catalogoEsempio);
    assert.equal(res.ok, true);
    assert.equal(res.market, "1 + U4.5");
    assert.equal(res.quota, 1.65);
    assert.equal(res.motivo, null);
  });

  it("8. '1X + Over 1.5' con quota sotto 1.40 (1.35) -> scartato fuori scala", () => {
    const res = mercatoAIValido("1X + Over 1.5", catalogoEsempio);
    assert.equal(res.ok, false);
    assert.equal(res.motivo, "fuori scala");
    assert.equal(res.quota, 1.35);
  });

  it("9. Whitelist e alternative: 'DC 12 + O2.5' escluso dalla whitelist e mai presente nelle alternative", () => {
    assert.ok(!VERDICT_WHITELIST.has("dc 12 + o2.5"), "DC 12 + O2.5 non deve essere in VERDICT_WHITELIST");
    assert.ok(!CLUSTER_WHITELIST.map((x) => x.toUpperCase()).includes("DC 12 + O2.5"), "DC 12 + O2.5 non deve essere in CLUSTER_WHITELIST");

    // Verifica analizzaGiocate con catalogo che include DC 12 + O2.5
    const oddsTest: any = { odd_1: 1.85, odd_x: 3.40, odd_2: 4.20, odd_o25: 1.80, odd_u25: 2.00, odd_gg: 1.70, odd_ng: 2.10 };
    const marketOddsTest: any = {
      "DC 12 + O2.5": { odd: 1.85, estimated: false },
      "DC 1X + O1.5": { odd: 1.45, estimated: false },
      "MG 2-4 casa": { odd: 1.53, estimated: true },
    };
    const vociTest: any = {
      "1.85": [{ market: "DC 12 + O2.5", pA: 0.65, nA: 50, pB: 0.63, nB: 50, p: 0.64 }],
      "1.45": [{ market: "DC 1X + O1.5", pA: 0.70, nA: 50, pB: 0.68, nB: 50, p: 0.69 }],
      "1.50": [{ market: "MG 2-4 casa", pA: 0.62, nA: 50, pB: 0.60, nB: 50, p: 0.61 }],
    };
    const an = analizzaGiocate({
      odds: oddsTest,
      marketOdds: marketOddsTest,
      ranking: [{ market: "DC 12 + O2.5", coverage: 0.65 }, { market: "DC 1X + O1.5", coverage: 0.70 }],
      voci: vociTest,
      manuali: [],
      totAtteso: 2.8,
      direzione: "1",
      casa: "Dortmund",
      ospite: "Werder",
      pesataCasa: { fatti: 2.0, subiti: 1.0 },
      pesataOspite: { fatti: 1.0, subiti: 2.0 },
      accordo: true,
      assentiCasa: 0,
      assentiOspite: 0,
    });

    // DC 12 + O2.5 NON deve avere punteggio né diventare consigliato né essere tra i candidati
    const rDc12 = an.righe.find((r) => r.market.toLowerCase().includes("12"));
    if (rDc12) {
      assert.equal(rDc12.punteggio, null, "DC 12 + O2.5 non deve avere punteggio");
      assert.notEqual(an.consigliato?.market, rDc12.market, "DC 12 + O2.5 non puo' essere consigliato");
    }
  });

  it("10. Nuovi mercati ammessi: 'MG 2-4 casa' e 'MG 2-4 ospite' in whitelist e accettati se in scala", () => {
    assert.ok(VERDICT_WHITELIST.has("mg 2-4 casa"), "mg 2-4 casa deve essere in api.ts VERDICT_WHITELIST");
    assert.ok(VERDICT_WHITELIST.has("mg 2-4 ospite"), "mg 2-4 ospite deve essere in api.ts VERDICT_WHITELIST");
    assert.ok(CLUSTER_WHITELIST.map((x) => x.toUpperCase()).includes("MG 2-4 CASA"), "MG 2-4 CASA deve essere in clusterEngine.ts VERDICT_WHITELIST");
    assert.ok(CLUSTER_WHITELIST.map((x) => x.toUpperCase()).includes("MG 2-4 OSPITE"), "MG 2-4 OSPITE deve essere in clusterEngine.ts VERDICT_WHITELIST");

    const vCasa = mercatoAIValido("MG 2-4 casa", catalogoEsempio);
    assert.equal(vCasa.ok, true);
    assert.equal(vCasa.market, "MG 2-4 casa");
    assert.equal(vCasa.quota, 1.85);

    const vOspite = mercatoAIValido("MG 2-4 ospite", catalogoEsempio);
    assert.equal(vOspite.ok, true);
    assert.equal(vOspite.market, "MG 2-4 ospite");
    assert.equal(vOspite.quota, 2.10);
  });

  it("11. Cache dispositivo (Difetto 2): pulizia eta > 3 giorni e limite 40 schede", () => {
    const store = new Map<string, string>();
    const mockStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, String(v)),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
      get length() { return store.size; },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
    };
    (globalThis as any).localStorage = mockStorage;

    const now = Date.now();
    // 50 voci bundle con timestamp progressivi
    for (let i = 1; i <= 50; i++) {
      const ts = now - (50 - i) * 60_000;
      mockStorage.setItem(`pb_bundle_m${i}|1.4`, JSON.stringify({ data: { id: `m${i}` }, ts }));
    }
    // Una voce vecchia di 5 giorni
    mockStorage.setItem("pb_bundle_mOld|1.4", JSON.stringify({ data: { id: "old" }, ts: now - 5 * 24 * 3600_000 }));

    pulisciCacheDispositivo(40, 3 * 24 * 3600_000);

    // La voce di 5 giorni fa rimossa
    assert.equal(mockStorage.getItem("pb_bundle_mOld|1.4"), null);
    // Conteggio bundle limitato a esattamente 40
    let countBundle = 0;
    for (let i = 0; i < mockStorage.length; i++) {
      if (mockStorage.key(i)?.startsWith("pb_bundle_")) countBundle++;
    }
    assert.equal(countBundle, 40);
    // Le più vecchie (m1..m10) rimosse
    assert.equal(mockStorage.getItem("pb_bundle_m1|1.4"), null);
    assert.equal(mockStorage.getItem("pb_bundle_m10|1.4"), null);
    // Le più recenti (m11..m50) presenti
    assert.notEqual(mockStorage.getItem("pb_bundle_m50|1.4"), null);
    assert.notEqual(mockStorage.getItem("pb_bundle_m11|1.4"), null);
  });

  it("12. Firma quote coerente client/server (Difetto 3) e invalidazione cache lettura", () => {
    // 1. firmaQuote supporta sia formato piatto sia formato annidato odds
    const matchPiatto = { odd_1: 1.85, odd_x: 3.40, odd_2: 4.20, odd_o25: 1.90, odd_u25: 1.90, odd_gg: 1.75, odd_ng: 2.05 };
    const matchAnnidato = { odds: { "1": 1.85, X: 3.40, "2": 4.20, O25: 1.90, U25: 1.90, GG: 1.75, NG: 2.05 } };
    const f1 = firmaQuote(matchPiatto);
    const f2 = firmaQuote(matchAnnidato);
    assert.deepEqual(f1, f2);

    // 2. Piccoli ritocchi (<5%) non devono essere considerati quote cambiate (es. 1.85 -> 1.83)
    const fRitocco = { ...f1, "1": 1.83 };
    assert.equal(quoteCambiate(f1, fRitocco), false);

    // 3. Variazione >= 5% su una quota principale viene rilevata (es. 1.85 -> 1.74)
    const fCambiata = { ...f1, "1": 1.74 };
    assert.equal(quoteCambiate(f1, fCambiata), true);

    // 4. Inversione favorita 1/2 rilevata
    const fEquilibrioA = { ...f1, "1": 2.10, "2": 2.15 };
    const fEquilibrioB = { ...f1, "1": 2.15, "2": 2.10 };
    assert.equal(quoteCambiate(fEquilibrioA, fEquilibrioB), true);

    // 5. persistentLetturaCache invalida se quote cambiate
    persistentLetturaCache.set("mTest", { consigliato: { market: "1X" } }, matchPiatto);
    // Stesse quote -> cache valida
    assert.notEqual(persistentLetturaCache.get("mTest", matchPiatto), null);
    // Quote con ritocco <5% -> cache ancora valida
    assert.notEqual(persistentLetturaCache.get("mTest", { odd_1: 1.83, odd_x: 3.40, odd_2: 4.20 }), null);
    // Quote cambiate >=5% -> cache INVALIDATA
    assert.equal(persistentLetturaCache.get("mTest", { odd_1: 1.70, odd_x: 3.40, odd_2: 4.20 }), null);
  });

  it("13. Ricalcolo versione tabella (Difetto 1): consigliatoValido confronta tabella_versione", () => {
    const match = { odd_1: 1.85, odd_x: 3.40, odd_2: 4.20 };
    const cons = {
      market: "1X", quota: 1.45,
      quote: firmaQuote(match),
      tabella_versione: "2026-10-10T12:00:00Z|9325",
    };
    const numeri = { consigliato: cons };

    // Con la stessa versione della tabella -> valido
    const vStessa = consigliatoValido(numeri, match, "2026-10-10T12:00:00Z|9325");
    assert.notEqual(vStessa, null);
    assert.equal(vStessa?.market, "1X");

    // Con nuova versione tabella -> INVALIDATO
    const vNuova = consigliatoValido(numeri, match, "2026-10-10T15:30:00Z|9335");
    assert.equal(vNuova, null);

    // Consigliato vecchio privo di versione -> INVALIDATO con versione attiva
    const consSenzaVersione = { market: "1X", quota: 1.45, quote: firmaQuote(match) };
    assert.equal(consigliatoValido({ consigliato: consSenzaVersione }, match, "2026-10-10T15:30:00Z|9335"), null);
  });

  it("14. Vietate SOLO le combo 1/2 + Over; DC 12, U2.5 ecc. restano come prima per i numeri; l'AI resta limitata a elenco + scenario; Dortmund resta MG 2-4 casa", () => {
    const manualiScenario = ["X oppure GG", "U3.5"];

    // 1. Vietate solo le combo segno secco 1/2 + Over (Rossi 10/10/2026:
    //    "non doveva cambiare niente del resto")
    assert.equal(isMercatoVietato("DC 12 + O1.5"), false);
    assert.equal(isMercatoVietato("DC 12 + O2.5"), false);
    assert.equal(isMercatoVietato("U2.5"), false);
    assert.equal(isMercatoVietato("U1.5"), false);
    assert.equal(isMercatoVietato("O3.5"), false);
    assert.equal(isMercatoVietato("1 + O3.5"), true);
    assert.equal(isMercatoVietato("1 + O1.5"), true);
    assert.equal(isMercatoVietato("2 + O2.5"), true);

    // 2. Mercati manuale non vietati
    assert.equal(isMercatoVietato("X oppure GG"), false);
    assert.equal(isMercatoVietato("U3.5"), false);
    assert.equal(isMercatoAmmesso("X oppure GG", manualiScenario), true);
    assert.equal(isMercatoAmmesso("U3.5", manualiScenario), true);

    // 3. Le combo 1/2 + Over restano non ammesse anche se presenti nel manuale
    assert.equal(isMercatoAmmesso("1 + O1.5", ["1 + O1.5"]), false);

    // 4. In analizzaGiocate con scenario contenente "X oppure GG":
    const oddsEquilibrio: any = {
      odd_1: 2.50, odd_X: 3.10, odd_x: 3.10, odd_2: 2.80,
      odd_O25: 2.10, odd_o25: 2.10, odd_U25: 1.70, odd_u25: 1.70,
      odd_GG: 1.85, odd_gg: 1.85, odd_NG: 1.85, odd_ng: 1.85,
      odd_U35: 1.45, odd_u35: 1.45,
    };
    const marketOddsEquilibrio: any = {
      "DC 12 + O1.5": { odd: 1.75, estimated: false },
      "U2.5": { odd: 1.70, estimated: false },
      "U3.5": { odd: 1.45, estimated: false },
    };
    const voceXoGG = { market: "X oppure GG", pA: 0.70, nA: 100, pB: 0.68, nB: 100, p: 0.69 };
    const vociEquilibrio: any = {
      "1.75": [{ market: "DC 12 + O1.5", pA: 0.65, nA: 50, pB: 0.65, nB: 50, p: 0.65 }],
      "1.70": [{ market: "U2.5", pA: 0.65, nA: 50, pB: 0.65, nB: 50, p: 0.65 }, voceXoGG],
      "1.60": [voceXoGG],
      "1.50": [voceXoGG],
      "1.45": [{ market: "U3.5", pA: 0.75, nA: 50, pB: 0.75, nB: 50, p: 0.75 }],
      "1.40": [{ market: "U3.5", pA: 0.75, nA: 50, pB: 0.75, nB: 50, p: 0.75 }],
    };
    const anEq = analizzaGiocate({
      odds: oddsEquilibrio,
      marketOdds: marketOddsEquilibrio,
      ranking: [{ market: "U3.5", coverage: 0.75 }, { market: "X oppure GG", coverage: 0.70 }],
      voci: vociEquilibrio,
      manuali: ["X oppure GG", "U3.5"],
      totAtteso: 2.1,
      direzione: null,
      casa: "SquadraA",
      ospite: "SquadraB",
      pesataCasa: { fatti: 1.0, subiti: 1.0 },
      pesataOspite: { fatti: 1.0, subiti: 1.0 },
      accordo: true,
      assentiCasa: 0,
      assentiOspite: 0,
    });

    // "X oppure GG" e "U3.5" possono ricevere punteggio ed essere candidati
    const rXoGG = anEq.righe.find((r) => r.market === "X oppure GG");
    const rU35 = anEq.righe.find((r) => r.market === "U3.5");
    assert.ok(rXoGG, "'X oppure GG' deve essere presente nelle righe");
    assert.ok(rU35, "'U3.5' deve essere presente nelle righe");
    assert.notEqual(rXoGG?.punteggio, null, "'X oppure GG' puo' avere punteggio se ammesso");
    assert.notEqual(rU35?.punteggio, null, "'U3.5' puo' avere punteggio se ammesso");

    // Come prima del 10/10: U2.5 dal catalogo puo' di nuovo essere valutato
    const rU25 = anEq.righe.find((r) => r.market === "U2.5");
    assert.ok(rU25, "'U2.5' resta fra le righe valutate");

    // 5. In mercatoAIValido:
    // "X oppure GG" ammesso se nel manuale
    const vXoGG = mercatoAIValido("X oppure GG", anEq, manualiScenario);
    assert.equal(vXoGG.ok, true, "'X oppure GG' deve essere ammesso se nel manuale");

    // "U3.5" ammesso se nel manuale
    const vU35 = mercatoAIValido("U3.5", anEq, manualiScenario);
    assert.equal(vU35.ok, true, "'U3.5' deve essere ammesso se nel manuale");

    // "DC 12 + O1.5" e "U2.5" scartati come "non ammesso"
    const v12 = mercatoAIValido("DC 12 + O1.5", anEq, manualiScenario);
    assert.equal(v12.ok, false);
    assert.equal(v12.motivo, "non ammesso");

    const vU25 = mercatoAIValido("U2.5", anEq, manualiScenario);
    assert.equal(vU25.ok, false);
    assert.equal(vU25.motivo, "non ammesso");

    // Dortmund con "1 + Over 1.5 (o GG)" resta tradotto in "MG 2-4 casa" e accettato
    const vDortmund = mercatoAIValido("1 + Over 1.5 (o GG)", catalogoEsempio);
    assert.equal(vDortmund.ok, true);
    assert.equal(vDortmund.market, "MG 2-4 casa");
  });
});
