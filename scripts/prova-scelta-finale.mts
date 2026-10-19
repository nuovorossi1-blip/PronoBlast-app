/**
 * PROVA DELLA "SCELTA FINALE" (19/10/2026, Rossi: "ok prova"). SOLA LETTURA sul database.
 *
 * Regola da provare (scheda semplificata: scenario + campionato + dossier):
 *  - opzioni: i mercati pagati da 1,40 a 1,60 (quota vera, altrimenti stimata dall'app);
 *  - percentuale di ogni opzione = media fra scenario (cella: fascia Over 3,5 x forza della favorita) e
 *    campionato (se ha almeno 40 partite), misurate SOLO sulle partite giocate prima di quella provata;
 *  - favorita con 5+ assenti, o lettura AI senza vincitore / contro la favorita -> niente giocate sul segno;
 *  - campionato da tanti gol (media 3,3+) -> niente Under; da pochi gol (2,5 o meno) -> niente Over 2,5,
 *    GG + Over 2,5 e MG 2-4 della favorita;
 *  - scelta = l'opzione con la percentuale piu' alta.
 * Confronto sulle stesse partite: il consigliato salvato prima del via e la scelta col solo scenario.
 *
 * Uso (dalla cartella server-locale, per avere le variabili):
 *   npx tsx --env-file=.env ../scripts/prova-scelta-finale.mts
 */
import { pgGetAll, rowToOdds } from "../netlify/functions/lib/supabaseRest";
import { quoteCatalogo, quotaXoppureGG, estimateMarketOdd } from "../netlify/functions/lib/clusterEngine";
import { vinceRegole } from "../netlify/functions/lib/regolePronostico";
import { getScenarioNote, normalizeMarket } from "../frontend/src/api";

const COLONNE = "id,squadra1,squadra2,day,time,manifestazione,odd_1,odd_x,odd_2,odd_1x,odd_x2,odd_12,odd_o15,odd_u15,odd_o25,odd_u25,odd_o35,odd_u35,odd_gg,odd_ng,result";

// Mercati descritti rispetto alla favorita (f = gol favorita, s = gol sfavorita).
type Gen = { id: string; segno: boolean; esito: (f: number, s: number) => boolean; nome: (fav: "1" | "2") => string };
const lato = (fav: "1" | "2") => (fav === "1" ? "casa" : "ospite");
const altro = (fav: "1" | "2") => (fav === "1" ? "ospite" : "casa");
const dc = (fav: "1" | "2") => (fav === "1" ? "1X" : "X2");
const MERCATI: Gen[] = [
  { id: "fisso", segno: true, esito: (f, s) => f > s, nome: (v) => v },
  { id: "dc", segno: true, esito: (f, s) => f >= s, nome: (v) => dc(v) },
  { id: "dc+o15", segno: true, esito: (f, s) => f >= s && f + s >= 2, nome: (v) => `DC ${dc(v)} + O1.5` },
  { id: "dc+gg", segno: true, esito: (f, s) => f >= s && f > 0 && s > 0, nome: (v) => `DC ${dc(v)} + GG` },
  { id: "dc+u35", segno: true, esito: (f, s) => f >= s && f + s <= 3, nome: (v) => `DC ${dc(v)} + U3.5` },
  { id: "mgfav13", segno: false, esito: (f) => f >= 1 && f <= 3, nome: (v) => `MG 1-3 ${lato(v)}` },
  { id: "mgfav24", segno: false, esito: (f) => f >= 2 && f <= 4, nome: (v) => `MG 2-4 ${lato(v)}` },
  { id: "combo", segno: false, esito: (f, s) => f >= 1 && f <= 3 && s <= 2, nome: (v) => (v === "1" ? "MG 1-3 casa + MG 0-2 ospite" : "MG 0-2 casa + MG 1-3 ospite") },
  { id: "mg24t", segno: false, esito: (f, s) => f + s >= 2 && f + s <= 4, nome: () => "MG 2-4 totali" },
  { id: "mg36t", segno: false, esito: (f, s) => f + s >= 3 && f + s <= 6, nome: () => "MG 3-6 totali" },
  { id: "o25", segno: false, esito: (f, s) => f + s >= 3, nome: () => "O2.5" },
  { id: "u35", segno: false, esito: (f, s) => f + s <= 3, nome: () => "U3.5" },
  { id: "u25", segno: false, esito: (f, s) => f + s <= 2, nome: () => "U2.5" },
  { id: "gg", segno: false, esito: (f, s) => f > 0 && s > 0, nome: () => "GG" },
  { id: "ng", segno: false, esito: (f, s) => f === 0 || s === 0, nome: () => "NG" },
  { id: "gg+o25", segno: false, esito: (f, s) => f > 0 && s > 0 && f + s >= 3, nome: () => "GG + O2.5" },
  { id: "xogg", segno: false, esito: (f, s) => f === s || (f > 0 && s > 0), nome: () => "X oppure GG" },
];
void altro;
const REALI: Record<string, string> = { "1": "odd_1", "2": "odd_2", "1X": "odd_1x", X2: "odd_x2", "O2.5": "odd_o25", "U2.5": "odd_u25", "U3.5": "odd_u35", GG: "odd_gg", NG: "odd_ng" };

type P = {
  row: any; day: string; lega: string; h: number; a: number; fav: "1" | "2"; f: number; s: number;
  cella: string; scenario: string; odds: any; cat?: any;
};

function prepara(row: any): P | null {
  const m = /^(\d+)-(\d+)$/.exec(String(row.result || "").trim());
  if (!m || !(row.odd_1 > 1 && row.odd_x > 1 && row.odd_2 > 1)) return null;
  const odds: any = rowToOdds(row);
  const nota = getScenarioNote(odds);
  if (!nota) return null;
  const h = +m[1], a = +m[2];
  const fav: "1" | "2" = row.odd_1 <= row.odd_2 ? "1" : "2";
  const fq = Math.min(row.odd_1, row.odd_2), o35 = row.odd_o35 ?? null;
  const fo = o35 == null ? "?" : o35 < 1.6 ? "<1,60" : o35 < 2 ? "1,60-1,99" : o35 < 2.3 ? "2,00-2,29" : o35 < 2.6 ? "2,30-2,59" : o35 < 3 ? "2,60-2,99" : "3,00+";
  const ff = fq < 1.4 ? "<1,40" : fq < 1.6 ? "1,40-1,59" : fq < 1.8 ? "1,60-1,79" : fq < 2 ? "1,80-1,99" : fq < 2.5 ? "2,00-2,49" : "2,50+";
  return { row, day: row.day, lega: String(row.manifestazione || "").toUpperCase().trim(), h, a, fav, f: fav === "1" ? h : a, s: fav === "1" ? a : h,
    cella: `${nota.scenario}|${fo}|${ff}`, scenario: nota.scenario, odds };
}

function quota(p: P, nome: string): { q: number; stimata: boolean } | null {
  const k = REALI[nome];
  if (k) { const v = Number(p.row[k]); return v > 1 ? { q: v, stimata: false } : null; }
  if (nome === "X oppure GG") { const v = quotaXoppureGG(p.odds); return v ? { q: v, stimata: true } : null; }
  p.cat ??= quoteCatalogo(p.odds);
  const v = p.cat[nome]?.odd ?? estimateMarketOdd(nome, p.odds);
  return v ? { q: v, stimata: true } : null;
}

async function main() {
  const righe = await pgGetAll(`matches?select=${COLONNE}&result=not.is.null`, "day.asc");
  const tutte = righe.map(prepara).filter((p): p is P => !!p).sort((x, y) => x.day.localeCompare(y.day));
  const dossier = await pgGetAll(
    "dossier_web?select=match_id,ac:numeri->programma->>assenti_casa,ao:numeri->programma->>assenti_ospite,dir:numeri->lettura_ai->>direzione,cons:numeri->consigliato->>market,consq:numeri->consigliato->>quota",
    "match_id.asc");
  const dos = new Map<string, any>(dossier.map((d: any) => [d.match_id, d]));
  const prova = tutte.filter((p) => dos.has(p.row.id) && p.scenario !== "Gap falso");
  console.log(`Archivio: ${tutte.length} partite. Prova: ${prova.length} partite con dossier (${prova[0]?.day} - ${prova[prova.length - 1]?.day}).\n`);

  const pct = (lista: P[], g: Gen) => lista.reduce((n, p) => n + (g.esito(p.f, p.s) ? 1 : 0), 0) / lista.length;
  const tot = { regola: { g: 0, v: 0, r: 0, stim: 0 }, scenario: { g: 0, v: 0, r: 0, stim: 0 }, cons: { g: 0, v: 0, r: 0, stim: 0 } };
  const perMercato = new Map<string, { g: number; v: number }>();
  const conta = (k: keyof typeof tot, ok: boolean, q: number, stimata: boolean) => { const t = tot[k]; t.g++; if (ok) t.v++; t.r += ok ? q - 1 : -1; if (stimata) t.stim++; };

  for (const p of prova) {
    const prima = tutte.filter((x) => x.day < p.day);
    const cella = prima.filter((x) => x.cella === p.cella);
    if (cella.length < 30) continue;
    const lega = prima.filter((x) => x.lega === p.lega);
    const mediaGol = lega.length >= 40 ? lega.reduce((n, x) => n + x.h + x.a, 0) / lega.length : null;
    const d = dos.get(p.row.id);
    const assFav = Number(p.fav === "1" ? d.ac : d.ao);
    const dir = String(d.dir || "").trim().toLowerCase();
    const noSegno = (Number.isFinite(assFav) && assFav >= 5) || (dir !== "" && dir !== p.fav);
    const opzioni: { g: Gen; nome: string; q: number; stimata: boolean; pS: number; p: number }[] = [];
    for (const g of MERCATI) {
      const nome = g.nome(p.fav);
      const qq = quota(p, nome);
      if (!qq || qq.q < 1.4 || qq.q > 1.6) continue;
      const pS = pct(cella, g);
      const pL = lega.length >= 40 ? pct(lega.map((x) => x), g) : null;
      opzioni.push({ g, nome, q: qq.q, stimata: qq.stimata, pS, p: pL == null ? pS : (pS + pL) / 2 });
    }
    // solo scenario: la piu' probabile per lo scenario, senza filtri
    const sS = [...opzioni].sort((x, y) => y.pS - x.pS)[0];
    if (sS) conta("scenario", sS.g.esito(p.f, p.s), sS.q, sS.stimata);
    // regola completa
    const valide = opzioni.filter((o) => !(noSegno && o.g.segno)
      && !(mediaGol != null && mediaGol >= 3.3 && (o.g.id === "u35" || o.g.id === "u25"))
      && !(mediaGol != null && mediaGol <= 2.5 && (o.g.id === "o25" || o.g.id === "gg+o25" || o.g.id === "mgfav24")));
    const s = valide.sort((x, y) => y.p - x.p)[0];
    if (s) {
      const ok = s.g.esito(p.f, p.s);
      conta("regola", ok, s.q, s.stimata);
      const e = perMercato.get(s.g.id) ?? { g: 0, v: 0 }; e.g++; if (ok) e.v++; perMercato.set(s.g.id, e);
    }
    // consigliato salvato prima del via
    if (d.cons && Number(d.consq) > 1) {
      const ok = vinceRegole(d.cons, p.row.fav === undefined ? p.h : p.h, p.a);
      if (ok !== null) conta("cons", ok, Number(d.consq), false);
    }
  }
  const riga = (k: keyof typeof tot, t: string) => {
    const x = tot[k];
    console.log(`${t.padEnd(34)} ${String(x.g).padStart(5)} giocate · vinte ${(100 * x.v / Math.max(1, x.g)).toFixed(1)}% · resa ${(100 * x.r / Math.max(1, x.g)).toFixed(1)}%${x.stim ? ` (quote stimate in ${x.stim})` : ""}`);
  };
  riga("regola", "SCELTA FINALE (scenario+campionato+dossier)");
  riga("scenario", "Solo scenario (1,40-1,60)");
  riga("cons", "Consigliato salvato prima del via");
  console.log("\nMercati scelti dalla regola:");
  for (const [k, e] of [...perMercato].sort((a, b) => b[1].g - a[1].g)) console.log(`  ${k.padEnd(8)} ${String(e.g).padStart(4)} · ${(100 * e.v / e.g).toFixed(0)}%`);
  void normalizeMarket;
}

main().catch((e) => { console.error(e?.message || e); process.exit(1); });
