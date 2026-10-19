/**
 * IL PERCORSO DELLA SCELTA (19/10/2026 sera, Rossi; prova a mano su Monza-Cagliari 4-0, Degerfors-Kalmar
 * 1-2 e Viborg-Midtjylland 1-2, tutte prese). Sostituisce la scelta di stamattina (coerenza 2 su 3,
 * mercati dell'incertezza, copertura).
 *  1. SCENARIO -> si valutano solo i suoi mercati, pagati da 1,40 a 1,60:
 *       Gap Tecnico: fisso della favorita, MG favorita 2-4, GG;
 *       Progressione: combo MG favorita 1-3 + MG sfavorita 0-2, MG favorita 1-3;
 *       Equilibrio: MG totali 3-6, GG + Over 2,5, Over 2,5, GG;
 *       Gap falso: si va subito al ripiego.
 *  2. AI con il dossier (notizie, assenti, ultime partite dello stesso tipo): direzione, risultati attesi,
 *     proposta.
 *  3. AI e BOOK allineati? Un mercato regge se il book lo conferma, vince in almeno 2 dei 3 risultati attesi
 *     dell'AI e lo storico lo da' almeno al 58% (come il vecchio "buona"). Se nessun mercato dello scenario regge -> RIPIEGO.
 *  4. RIPIEGO: MG totali 2-4, Under 3,5, 1X, X2 (1,40-1,60) e X o GG (1,62-1,90), con le stesse prove.
 *  5. Fra quelli che reggono vince il piu' probabile (storico, poi campionato, poi la quota piu' alta).
 *     Nessuno regge -> partita da lasciare.
 */
import { bookConferma, quotaMercato } from "./sceltaAI";
import { mercatiDelloScenario, MERCATI_RIPIEGO, evaluateMarketOutcome, normalizeMarket, type RigaGiocata, type VocePercorso, type Percorso } from "../../../frontend/src/api";

export type { VocePercorso, Percorso };

const q2 = (x: number | null | undefined) => (x == null || !(Number(x) > 1) ? "n/d" : Number(x).toFixed(2).replace(".", ","));
const pc = (x: number) => `${Math.round(x * 100)}%`;

export function percorsoScelta(x: {
  m: any;
  scenario: string;
  righe: RigaGiocata[];
  ai: { direzione?: string | null; giocata?: string | null; mercato?: string | null; risultati_probabili?: string[] | null; notizia?: string | null } | null;
  campionato: { n: number; ris: string[] } | null;
}): Percorso {
  const { m, scenario } = x;
  const favCasa = Number(m.odd_1) <= Number(m.odd_2);
  const casa = m.squadra1, ospite = m.squadra2;
  const nomeDi = (c: string) => c.replace(/\bcasa\b/gi, casa).replace(/\bospite\b/gi, ospite)
    .replace(/^1$/, `1 (vince ${casa})`).replace(/^2$/, `2 (vince ${ospite})`)
    .replace(/^1X$/, `1X (${casa} non perde)`).replace(/^X2$/, `X2 (${ospite} non perde)`)
    .replace(/^O2\.5$/, "Over 2,5").replace(/^U3\.5$/, "Under 3,5").replace(/^GG \+ O2\.5$/, "GG + Over 2,5")
    .replace(/^X oppure GG$/, "X o GG");
  const ris = (x.ai?.risultati_probabili || []).map((r) => String(r).replace(/\s/g, "")).filter((r) => /^\d+-\d+$/.test(r)).slice(0, 3);
  const dirAI = String(x.ai?.direzione || "").trim().toLowerCase();
  const camp = x.campionato && x.campionato.n >= 30 ? x.campionato : null;
  const riga = (c: string) => x.righe.find((r) => normalizeMarket(r.market) === normalizeMarket(c));

  const voce = (codice: string, gruppo: "scenario" | "ripiego"): VocePercorso => {
    const q = quotaMercato(m, codice);
    const xogg = codice === "X oppure GG";
    const nelRange = !!q && (xogg ? q.quota >= 1.62 && q.quota <= 1.9 : q.quota >= 1.4 && q.quota <= 1.6 + 1e-9);
    const book = bookConferma(codice, m);
    let viteAI: number | null = ris.length === 3 ? ris.filter((r) => evaluateMarketOutcome(codice, r) === true).length : null;
    let ai: boolean | null = viteAI == null ? null : viteAI >= 2;
    // Il segno fisso solo se l'AI dice quel vincitore (Juve-Lazio: "se avesse detto 1 fisso allora si'").
    if ((codice === "1" || codice === "2") && dirAI && dirAI !== codice) ai = false;
    const r = riga(codice);
    const pStorico = r ? (r.misurata ? Math.min(r.misurata.pA, r.misurata.pB) : r.stima) : null;
    const pCampionato = camp ? camp.ris.filter((s) => evaluateMarketOutcome(codice, s) === true).length / camp.n : null;
    const pRif = pStorico ?? pCampionato;
    // Regge come il vecchio "buona" (almeno 58% nel caso peggiore: MG 2-4 al 61% / 59% su Monza e Kalmar).
    const storico = pRif == null ? null : pRif >= 0.58;
    const regge = nelRange && book && ai !== false && storico === true;
    const manca = !q ? "nessuna quota"
      : !nelRange ? (xogg ? `pagato ${q2(q.quota)}, serve da 1,62 a 1,90` : `pagato ${q2(q.quota)}, fuori da 1,40-1,60`)
      : [!book ? "il book non lo conferma" : null, ai === false ? (viteAI != null && viteAI < 2 ? `l'AI: vince solo in ${viteAI} dei 3 risultati attesi` : "l'AI non vede questo vincitore") : null,
        storico === false ? `lo storico lo da' solo al ${pc(pRif!)}` : storico == null ? "nessun dato di storico" : null].filter(Boolean).join("; ");
    const perche = (r?.perche || "").replace(/^★ consigliato:\s*/, "");
    return { codice, nome: nomeDi(codice), quota: q?.quota ?? null, stimata: !!q?.stimata, gruppo, nelRange, book, viteAI, ai, pStorico, nStorico: r?.misurata?.n ?? null, pCampionato, storico, regge, perche, manca };
  };
  const migliore = (v: VocePercorso[]) => v.filter((o) => o.regge).sort((a, b) =>
    ((b.pStorico ?? b.pCampionato ?? 0) - (a.pStorico ?? a.pCampionato ?? 0)) || ((b.pCampionato ?? 0) - (a.pCampionato ?? 0)) || ((b.quota ?? 0) - (a.quota ?? 0)))[0] ?? null;

  const passi: Percorso["passi"] = [];
  const gapFalso = scenario === "Gap falso";
  const scen = mercatiDelloScenario(scenario, m).map((c) => voce(c, "scenario"));
  const quote1x2 = `1 ${q2(m.odd_1)} · X ${q2(m.odd_x)} · 2 ${q2(m.odd_2)}`;
  const inRange = scen.filter((v) => v.nelRange);
  passi.push({
    titolo: `Scenario: ${scenario}`,
    testo: gapFalso
      ? `${quote1x2}. Non è un gap vero (anche l'avversario sta sotto 4): si va direttamente al ripiego.`
      : `${quote1x2}. Si valutano solo ${scen.map((v) => v.nome).join(", ") || "nessun mercato"}. ` +
        (inRange.length ? `Pagati da 1,40 a 1,60: ${inRange.map((v) => `${v.nome} ${q2(v.quota)}`).join(", ")}.` : "Nessuno è pagato da 1,40 a 1,60."),
  });
  const proposta = String(x.ai?.giocata || x.ai?.mercato || "").trim();
  const dirNome = dirAI === "1" ? casa : dirAI === "2" ? ospite : dirAI === "x" ? "pareggio" : "nessun vincitore chiaro";
  passi.push({
    titolo: "L'AI con il dossier",
    testo: x.ai
      ? `Direzione: ${dirNome}. Risultati attesi: ${ris.join(", ") || "n/d"}.${proposta ? ` Proposta: ${proposta}.` : ""}${x.ai.notizia ? ` Notizia: ${x.ai.notizia}.` : ""}`
      : "Valutazione AI non ancora disponibile: contano solo book e storico.",
  });
  const dirBook = Number(m.odd_1x) > 1 && Number(m.odd_x2) > 1 ? (Number(m.odd_1x) <= Number(m.odd_x2) ? "1" : "2") : null;
  const sc = gapFalso ? null : migliore(scen);
  let ripiego = gapFalso;
  if (!gapFalso) {
    const contro = dirBook && (dirAI === "1" || dirAI === "2") && dirAI !== dirBook
      ? ` Sulla direzione non sono d'accordo: l'AI dice ${dirAI === "1" ? casa : ospite}, il book pende per ${dirBook === "1" ? casa : ospite} (${dirBook === "1" ? `1X ${q2(m.odd_1x)} contro X2 ${q2(m.odd_x2)}` : `X2 ${q2(m.odd_x2)} contro 1X ${q2(m.odd_1x)}`}).`
      : "";
    if (sc) {
      passi.push({ titolo: "AI e book sono allineati", testo: `${sc.nome}: il book lo conferma, l'AI lo vince in ${sc.viteAI ?? "–"} dei 3 risultati attesi, lo storico lo dà al ${pc(sc.pStorico ?? sc.pCampionato ?? 0)}.${contro}` });
    } else {
      ripiego = true;
      // Dove l'AI dice si' e il book no (Monza: risultati tutti GG, ma GG pagato 1,80).
      const aiSiBookNo = scen.filter((v) => v.ai === true && !v.book && v.quota)
        .sort((a, b) => (b.viteAI ?? 0) - (a.viteAI ?? 0)).slice(0, 1)
        .map((v) => `l'AI dice ${v.nome} (vince ${v.viteAI} dei 3 risultati attesi), il book lo paga ${q2(v.quota)} e non lo conferma`);
      const motivi = inRange.filter((v) => !v.regge).map((v) => `${v.nome}: ${v.manca}`);
      const testo = [
        inRange.length ? null : "Nessun pronostico dello scenario è pagato da 1,40 a 1,60.",
        ...motivi, ...aiSiBookNo,
      ].filter(Boolean).map((t) => t!.charAt(0).toUpperCase() + t!.slice(1).replace(/\.$/, "")).join(". ") + "." + contro;
      passi.push({ titolo: aiSiBookNo.length || contro ? "AI e book non sono allineati: ripiego" : "Nessun pronostico dello scenario regge: ripiego", testo });
    }
  }
  // Il ripiego si valuta sempre, per il perche' si' / perche' no di tutti; conta solo se serve.
  const rip = MERCATI_RIPIEGO.filter((c) => !scen.some((v) => v.codice === c)).map((c) => voce(c, "ripiego"));
  const voci = [...scen, ...rip];
  const scelta = ripiego ? migliore(rip) : sc;
  const riga5 = (v: VocePercorso) => `${v.nome}${v.quota ? ` ${q2(v.quota)}` : ""}: ${v.regge ? "regge" : v.manca}`;
  if (ripiego) passi.push({ titolo: "Ripiego, valutato con lo storico", testo: rip.map(riga5).join(". ") + "." });
  else if (inRange.length > 1) passi.push({ titolo: "Seconda valutazione", testo: inRange.map(riga5).join(". ") + "." });
  let lascia: string | null = null;
  if (scelta) {
    const altre = (ripiego ? rip : scen).filter((v) => v.regge && v !== scelta);
    passi.push({
      titolo: "Scelta",
      testo: `${scelta.nome} @${q2(scelta.quota)}: book ✓, AI ${scelta.ai == null ? "–" : `✓ (${scelta.viteAI} su 3)`}, storico ✓ (${pc(scelta.pStorico ?? scelta.pCampionato ?? 0)}${scelta.pCampionato != null ? `, campionato ${pc(scelta.pCampionato)}` : ""}).` +
        (altre.length ? ` È la più probabile fra quelle che reggono (${altre.map((v) => `${v.nome} ${pc(v.pStorico ?? v.pCampionato ?? 0)}`).join(", ")}).` : ""),
    });
  } else {
    lascia = ripiego ? "nessun mercato di ripiego regge (book, AI e storico): partita da lasciare" : "nessun mercato regge: partita da lasciare";
    passi.push({ titolo: "Da lasciare", testo: lascia.charAt(0).toUpperCase() + lascia.slice(1) + "." });
  }
  return { scenario, ripiego, passi, voci, scelta: scelta?.codice ?? null, lascia };
}
