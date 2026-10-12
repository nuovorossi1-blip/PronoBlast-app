import { jsonResponse } from "./lib/supabaseRest";
import { analizzaPartita } from "./analisi-partita";
import { esc } from "./lib/telegramTabella";

/**
 * POST /domanda-bot — l'agente del bot Telegram (13/10/2026, Rossi: "gli
 * chiedo perche' hai scelto questo, perche' hai cambiato questo pronostico,
 * e Gemini mi risponde").
 *
 * Il modello NON inventa: riceve le regole con cui PronoBlast decide, le
 * ultime risposte del bot (memoria corta tenuta da n8n per chat) e la scheda
 * completa delle partite citate (stessi dati di /analisi-partita), e spiega.
 *
 * Body: { domanda: string, storico?: [{ ruolo: "utente"|"bot", testo }] }
 * Header: X-Schedina-Segreto (come le altre rotte del bot).
 */

const MODELLO = "google/gemini-2.5-flash";

const REGOLE = `Sei l'assistente del bot PronoBlast su Telegram. Rispondi in italiano semplice, breve (massimo 12 righe), senza markdown (niente asterischi o #), puoi usare emoji.
Non salutare e non ripetere la domanda: vai subito al punto.
Usa SOLO i dati qui sotto. Se un dato non c'e', dillo ("non ho questo dato"). Non inventare quote, percentuali, notizie o risultati.
Non promettere vincite: e' un parere, non una garanzia.

COME DECIDE PRONOBLAST (per spiegare i "perche'"):
- Motore: probabilita' di ogni giocata calcolate dalle quote del bookmaker (modello di Poisson sui gol attesi).
- Archivio: per partite con quote e scenario simili, quante volte ogni giocata ha vinto davvero. Una giocata "regge" se vince almeno il 58%.
- CONSIGLIATO: la giocata che regge meglio in archivio nella fascia di quota scelta. Il Pronostico AI puo' cambiarlo solo se trova una notizia verificata nei dati.
- DA LASCIARE: quando forma recente (pesata con la forza degli avversari) e quote NON sono d'accordo sui gol: partita incerta. In quel caso si indica cosa giocare se la si vuole giocare lo stesso.
- CONTROLLO SCHEDINA: ok se la giocata e' il consigliato o regge in archivio; cambia se non regge (si propone il consigliato); togli se PronoBlast lascia la partita (si propone una partita del giorno con consigliato a quota simile); senza consigliato decide il motore. Un cambio di allenatore nelle notizie rende la partita "da valutare".
- MULTIPLA DEL GIORNO: solo consigliati di partite non iniziate; si scartano le partite con avvisi seri (forma e quote in disaccordo, lettura AI contraria, cambio di allenatore, inizio entro 15 minuti) se la multipla si compone lo stesso.
- Notizie: Google News per squadra (allenatore, infortuni, squalifiche, ultimi 7 giorni) + FotMob (assenti, formazioni, forma).`;

const togliTag = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Le partite di cui si parla: nella domanda, altrimenti nell'ultima risposta del bot. */
function partiteCitate(domanda: string, ultima: string): string[] {
  const out: string[] = [];
  const re = /([A-Z][\p{L}0-9.'’ ]{1,30}?) - ([A-Z][\p{L}0-9.'’ ]{1,30}?)(?=\s*[·:(\n]|\s+\d|$)/gmu;
  const dalBot = [...togliTag(ultima).matchAll(re)].map((m) => `${m[1].trim()} - ${m[2].trim()}`);
  const parole = domanda.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const numero = parole.match(/\b(?:la|il|partita|numero|n\.?)\s*(\d)\b/);
  for (const p of dalBot) {
    const nomi = p.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/\s+-\s+|\s+/).filter((w) => w.length >= 4);
    if (nomi.some((w) => parole.includes(w))) out.push(p);
  }
  if (numero) { const i = Number(numero[1]) - 1; const unici = [...new Set(dalBot)]; if (unici[i]) out.push(unici[i]); }
  if (!out.length) out.push(domanda);   // magari la domanda nomina una partita ("e Inter Napoli?")
  return [...new Set(out)].slice(0, 3);
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return jsonResponse({ error: "Usa POST" }, 405);
  const segreto = (process.env.SCHEDINA_SEGRETO || "").trim();
  if (!segreto || req.headers.get("x-schedina-segreto") !== segreto) return jsonResponse({ error: "Non autorizzato" }, 401);
  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: "Body JSON non valido" }, 400); }
  const domanda = String(body?.domanda || "").replace(/^\/(ai|agent-llm|agente)\s*/i, "").trim();
  if (!domanda) return jsonResponse({ html: "Fammi una domanda, per esempio: <b>perche' hai cambiato la 2?</b>" });
  const storico: { ruolo: string; testo: string }[] = Array.isArray(body?.storico) ? body.storico.slice(-6) : [];
  const ultimaBot = [...storico].reverse().find((s) => s.ruolo === "bot")?.testo || "";

  // Dati veri delle partite citate
  const schede: string[] = [];
  for (const p of partiteCitate(domanda, ultimaBot)) {
    try {
      const a = await analizzaPartita(p);
      if (a.trovata) schede.push(togliTag(a.html));
    } catch { /* una scheda in meno */ }
  }

  const key = (process.env.OPENROUTER_API_KEY || "").trim();
  if (!key) return jsonResponse({ html: "Agente non disponibile: manca la chiave OpenRouter sul server." });
  const contesto = [
    storico.length ? `ULTIMI MESSAGGI (dal piu' vecchio):\n${storico.map((s) => `[${s.ruolo}] ${togliTag(s.testo).slice(0, 2500)}`).join("\n---\n")}` : "",
    schede.length ? `DATI PRONOBLAST DELLE PARTITE CITATE:\n${schede.join("\n=====\n")}` : "Nessuna partita trovata nella domanda o nell'ultima risposta.",
  ].filter(Boolean).join("\n\n");
  let risposta = "";
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "PronoBlast bot agente" },
      body: JSON.stringify({ model: MODELLO, temperature: 0.2, max_tokens: 900, messages: [
        { role: "system", content: REGOLE },
        { role: "user", content: `${contesto}\n\nDOMANDA: ${domanda}\n\n(Rispondi senza saluti iniziali.)` },
      ] }),
      signal: AbortSignal.timeout(90000),
    });
    const j: any = await r.json();
    risposta = String(j?.choices?.[0]?.message?.content || "").replace(/\*\*/g, "").trim()
      .replace(/^(ciao|salve|buongiorno|buonasera)[^\n.!]*[.!]?\s*/i, "");   // niente saluti
    if (!r.ok || !risposta) throw new Error(j?.error?.message || `OpenRouter ${r.status}`);
  } catch (e: any) {
    return jsonResponse({ html: `Non riesco a rispondere adesso (${esc(e?.message || e)}). Riprova tra poco.` });
  }
  return jsonResponse({ html: `🧠 ${esc(risposta)}\n\n<i>Gemini su dati PronoBlast${schede.length ? ` (${schede.length} ${schede.length === 1 ? "partita" : "partite"})` : ""}</i>`, testo: risposta, partite: schede.length });
};
