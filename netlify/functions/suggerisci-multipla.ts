import { pgGet, jsonResponse } from "./lib/supabaseRest";
import { inizioPartitaMs } from "../../frontend/src/api";
import buildMultipla from "./build-multipla";

/**
 * POST /suggerisci-multipla — "suggeriscimi una multipla" dal bot Telegram
 * (13/10/2026, Rossi: "5 partite quota 10, con i migliori consigliati dopo
 * la ricerca web").
 *
 * 1. "Genera multipla" (build-multipla, SENZA scrivere la Schedina): le N
 *    partite di oggi non ancora iniziate, solo consigliati, quota totale >= Q.
 * 2. Per ogni gamba il dossier del giorno (ricerca web delle 6 e delle 13:
 *    FotMob + notizie) e la lettura: assenze pesanti, forma e quote in
 *    disaccordo, lettura AI che va nella direzione opposta alla giocata.
 * 3. Le gambe con un avviso SERIO (disaccordo o direzione opposta) si
 *    escludono e si rifa' la multipla, fino a 2 volte; se non si riesce a
 *    comporla senza, si tengono e l'avviso si vede. Gli avvisi non sono
 *    ancora misurati: per questo escludono solo se c'e' un'alternativa.
 *
 * Body: { events: 5, minTotalOdd: 10, day?: "YYYY-MM-DD" }
 * Header: X-Schedina-Segreto (stesso segreto di /controlla-schedina).
 */

const oggi = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());
const q2 = (q: number | null | undefined) => (q == null ? "n/d" : q.toFixed(2).replace(".", ","));
const pct = (p: number | null | undefined) => (p == null ? "n/d" : `${Math.round(p * 100)}%`);

/** Il segno su cui punta una giocata: "1", "2", "X" o null (giocate sui gol). */
function segnoDi(market: string): string | null {
  const m = market.toUpperCase().replace(/^DC\s+/, "");
  if (/^(1|1X)(\s|$|\+)/.test(m)) return "1";
  if (/^(2|X2)(\s|$|\+)/.test(m)) return "2";
  if (/^X(\s|$|\+)/.test(m)) return "X";
  return null;
}

async function avvisiDi(ids: string[]): Promise<Map<string, { avvisi: string[]; seri: string[]; notizia: string | null }>> {
  const out = new Map<string, any>();
  if (!ids.length) return out;
  const lista = ids.map((x) => `"${x}"`).join(",");
  const righe = await pgGet(`dossier_web?match_id=in.(${lista})&select=match_id,numeri`).catch(() => []);
  for (const r of righe) out.set(r.match_id, r.numeri || {});
  return out;
}

function giudica(leg: any, n: any) {
  const avvisi: string[] = [], seri: string[] = [];
  for (const f of n?.programma?.frasi || []) {
    if (/NON d'accordo/i.test(f)) seri.push("forma e quote non sono d'accordo");
    else if (/⚠/.test(f)) avvisi.push(String(f).replace(/^⚠\s*/, ""));
  }
  const ai = n?.lettura_pro || n?.lettura_ai;
  const segno = segnoDi(leg.market);
  if (ai?.direzione && segno && ["1", "2"].includes(segno) && ["1", "2"].includes(ai.direzione) && ai.direzione !== segno) {
    seri.push(`la lettura AI vede favorita l'altra squadra (${ai.direzione})`);
  }
  const notizia = (n?.lettura_pro?.notizia || n?.lettura_ai?.notizia || "").trim() || null;
  return { avvisi, seri, notizia };
}

async function multipla(day: string, events: number, minTotalOdd: number, escluse: string[]) {
  const r = await buildMultipla(new Request("http://interno/build-multipla", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ day, events, minTotalOdd, apply: false, excludeMatches: escluse }),
  }));
  return r.json() as Promise<any>;
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return jsonResponse({ error: "Usa POST" }, 405);
  const segreto = (process.env.SCHEDINA_SEGRETO || "").trim();
  if (!segreto || req.headers.get("x-schedina-segreto") !== segreto) return jsonResponse({ error: "Non autorizzato" }, 401);
  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: "Body JSON non valido" }, 400); }
  const events = Math.round(Number(body?.events));
  const minTotalOdd = Number(String(body?.minTotalOdd ?? "").replace(",", "."));
  if (!(events >= 2 && events <= 8)) return jsonResponse({ error: "Partite: da 2 a 8" }, 400);
  if (!(minTotalOdd >= 1.5 && minTotalOdd <= 500)) return jsonResponse({ error: "Quota totale: da 1,5 a 500" }, 400);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(body?.day || "") ? body.day : oggi();

  const escluse: string[] = [];
  const scartate: string[] = [];
  let ris: any = null, info = new Map<string, any>();
  for (let giro = 0; giro < 3; giro++) {
    const r = await multipla(day, events, minTotalOdd, escluse);
    if (!r?.legs?.length || (r.total_odd ?? 0) < minTotalOdd) { if (!ris) ris = r; break; }
    const numeri = await avvisiDi(r.legs.map((l: any) => l.match_id));
    const giudizi = new Map(r.legs.map((l: any) => [l.match_id, giudica(l, numeri.get(l.match_id))]));
    ris = r; info = giudizi;
    // Partite che iniziano entro 15 minuti: non si fa in tempo a giocarle.
    const tardi = (l: any) => (inizioPartitaMs(day, l.time) ?? Infinity) < Date.now() + 15 * 60000;
    for (const l of r.legs) if (tardi(l)) giudizi.get(l.match_id)!.seri.push("inizia tra meno di 15 minuti");
    const daTogliere = r.legs.filter((l: any) => giudizi.get(l.match_id)!.seri.length);
    if (!daTogliere.length || giro === 2) break;
    for (const l of daTogliere) { escluse.push(l.match_id); scartate.push(`${l.squadra1} - ${l.squadra2} (${giudizi.get(l.match_id)!.seri.join("; ")})`); }
  }

  const righe: string[] = [];
  if (!ris?.legs?.length) {
    righe.push(`Oggi non riesco a comporre ${events} partite a quota ${q2(minTotalOdd)}: ${ris?.reason || ris?.error || "poche partite ancora da giocare con un consigliato"}.`);
    righe.push("Prova con meno partite o una quota piu' bassa (es. 4 partite quota 6).");
    return jsonResponse({ ok: false, testo: righe.join("\n"), dettaglio: ris });
  }
  const totale = ris.total_odd;
  righe.push(`🎯 Multipla ${day.split("-").reverse().slice(0, 2).join("/")} · ${ris.legs.length} partite · quota ${ris.total_estimated ? "circa " : ""}${q2(totale)}`, "");
  ris.legs.sort((a: any, b: any) => String(a.time).localeCompare(String(b.time)));
  ris.legs.forEach((l: any, i: number) => {
    const g = info.get(l.match_id) || { avvisi: [], seri: [], notizia: null };
    righe.push(`${i + 1}. ${l.time} ${l.squadra1} - ${l.squadra2} (${l.manifestazione})`);
    righe.push(`   👉 ${l.market} @${q2(l.odd)}${l.odd_estimated ? " (quota stimata)" : ""} · motore ${pct(l.prob)}`);
    if (g.notizia) righe.push(`   📰 ${g.notizia}`);
    for (const a of g.avvisi) righe.push(`   ⚠ ${a}`);
    for (const s of g.seri) righe.push(`   ⚠️ ${s} (tenuta: senza di lei non si arrivava alla quota)`);
  });
  righe.push("");
  if (totale < minTotalOdd) righe.push(`⚠ Quota ${q2(totale)}, sotto ${q2(minTotalOdd)}: oggi non ci sono abbastanza partite solide.`);
  if (scartate.length) righe.push(`Scartate per gli avvisi: ${scartate.join(" · ")}`);
  righe.push(`Probabilita' che vincano tutte (motore): ${pct(ris.total_prob)}. La quota ne chiede ${pct(1 / totale)}.`);
  righe.push("Notizie e avvisi dal dossier di oggi (FotMob + ricerca web). E' un parere, non una garanzia.");
  return jsonResponse({ ok: true, testo: righe.join("\n"), legs: ris.legs, total_odd: totale, scartate });
};
