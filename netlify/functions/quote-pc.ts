import { pgGet, pgPatch, pgPost, jsonResponse } from "./lib/supabaseRest";
import type { QuotePcRichiesta, QuotePcStato } from "../../frontend/src/api";

/**
 * AGGIORNA QUOTE DAL PC DI CASA (05/10/2026) — /quote-pc
 *
 * PERCHE'. Il PDF delle quote Sisal non si scarica da un server: Sisal ha una
 * protezione anti-bot che risponde 403 (o chiude la connessione) a tutto cio'
 * che non e' un browser vero con la finestra aperta. Dal PC di casa invece si:
 * un programma (pc-quote-sisal/, nel repo) apre Edge, scarica il PDF, lo
 * converte in .xlsx SENZA OCR (il PDF contiene testo vero) e lo manda a
 * /upload-excel come farebbe Rossi a mano.
 *
 * COME SI PARLANO APP E PC (06/10/2026). Niente piu' battito: ogni 15 s
 * esauriva la CPU gratuita di Vercel. Ora e' il server a chiamare il PC, e
 * SOLO quando si preme il tasto: l'agente aspetta su PC_AGENTE_URL (in locale
 * http://127.0.0.1:47815; da Vercel l'indirizzo Tailscale Funnel del PC), con
 * il segreto condiviso PC_AGENTE_SEGRETO. Se la chiamata fallisce, PC spento.
 *  - `settings.pc_quote_richiesta` -> la richiesta del tasto e il suo stato.
 * Il PC la prende, scrive le fasi mentre lavora e alla fine l'esito.
 *
 *   GET  /quote-pc                         -> { acceso, ultimo_battito: null, richiesta }
 *   POST /quote-pc { azione: "avvia" }     -> crea la richiesta e sveglia il PC (409 se spento)
 *   POST /quote-pc { azione: "prendi", id }-> (PC) in_attesa -> in_corso, una volta sola
 *   POST /quote-pc { azione: "stato", id, stato, fase, esito, errore } -> (PC) avanzamento
 */

const RICHIESTA = "pc_quote_richiesta";
const AGENTE = (process.env.PC_AGENTE_URL || "").replace(/\/$/, "");
const SEGRETO = process.env.PC_AGENTE_SEGRETO || "";
/** Una richiesta senza aggiornamenti da 10 minuti e' abbandonata (PC spento a
 *  meta' lavoro): se ne puo' avviare un'altra. Il lavoro normale dura 1-2 min. */
const ABBANDONATA_DOPO_MS = 10 * 60_000;

async function leggi<T>(chiave: string): Promise<T | null> {
  const r = await pgGet(`settings?key=eq.${chiave}&select=value`);
  return (Array.isArray(r) && r[0]?.value) || null;
}

async function scrivi(chiave: string, value: unknown) {
  await pgPost("settings", { key: chiave, value }, "resolution=merge-duplicates,return=minimal");
}

function attiva(r: QuotePcRichiesta | null): boolean {
  return !!r && (r.stato === "in_attesa" || r.stato === "in_corso")
    && Date.now() - Date.parse(r.aggiornato) < ABBANDONATA_DOPO_MS;
}

/** Chiama l'agente sul PC. Errore (o PC non configurato) = PC spento. */
async function agente(percorso: string, corpo?: unknown): Promise<Response | null> {
  if (!AGENTE || !SEGRETO) return null;
  try {
    return await fetch(`${AGENTE}${percorso}`, {
      method: corpo ? "POST" : "GET",
      headers: { "Content-Type": "application/json", "X-Segreto": SEGRETO },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return null;
  }
}

async function stato(): Promise<QuotePcStato> {
  const [ping, r] = await Promise.all([
    agente("/ping"),
    leggi<QuotePcRichiesta>(RICHIESTA),
  ]);
  return {
    acceso: !!ping?.ok,
    ultimo_battito: null,
    richiesta: r && !attiva(r) && (r.stato === "in_attesa" || r.stato === "in_corso")
      ? { ...r, stato: "errore", errore: "Il PC ha smesso di rispondere a meta' lavoro." }
      : r,
  };
}

export default async (req: Request): Promise<Response> => {
  try {
    if (req.method === "GET") return jsonResponse({ ok: true, ...(await stato()) });
    if (req.method !== "POST") return jsonResponse({ error: "Metodo non supportato" }, 405);

    const body = await req.json().catch(() => ({}));
    const ora = new Date().toISOString();

    // "prendi" e "stato" arrivano dal PC: solo con il segreto giusto.
    if (body?.azione !== "avvia" && (!SEGRETO || req.headers.get("x-segreto") !== SEGRETO)) {
      return jsonResponse({ error: "Non autorizzato" }, 403);
    }

    switch (body?.azione) {
      case "avvia": {
        const attuale = await leggi<QuotePcRichiesta>(RICHIESTA);
        if (attiva(attuale)) {
          return jsonResponse({ error: "C'e' gia' un aggiornamento quote in corso.", acceso: true, ultimo_battito: null, richiesta: attuale }, 409);
        }
        const richiesta: QuotePcRichiesta = {
          id: crypto.randomUUID(), stato: "in_attesa", creata: ora, aggiornato: ora,
          fase: "Sveglio il PC di casa…", esito: null, errore: null,
        };
        await scrivi(RICHIESTA, richiesta);
        const ritorno = process.env.PC_AGENTE_RITORNO || new URL(req.url).origin;
        const r = await agente("/avvia", { richiesta, ritorno });
        if (!r?.ok) {
          const errore = r?.status === 409
            ? "Il PC sta gia' aggiornando le quote."
            : "Server spento: il PC di casa non risponde. Accendilo (o controlla che sia connesso) e riprova.";
          const fallita = { ...richiesta, stato: "errore" as const, fase: "Errore", errore, aggiornato: new Date().toISOString() };
          await scrivi(RICHIESTA, fallita);
          return jsonResponse({ error: errore, spento: r?.status !== 409, acceso: !!r, ultimo_battito: null, richiesta: fallita }, 409);
        }
        return jsonResponse({ ok: true, richiesta });
      }

      case "prendi": {
        // Passa solo se la richiesta e' ancora QUELLA e ancora in attesa: due
        // programmi aperti per sbaglio non la lavorano mai entrambi.
        const r = await leggi<QuotePcRichiesta>(RICHIESTA);
        if (!r || r.id !== body.id || r.stato !== "in_attesa") return jsonResponse({ ok: false });
        const nuova = { ...r, stato: "in_corso", aggiornato: ora, fase: "Il PC ha preso la richiesta" };
        const res = await pgPatch(
          `settings?key=eq.${RICHIESTA}&value->>id=eq.${r.id}&value->>stato=eq.in_attesa`,
          { value: nuova },
        );
        return jsonResponse({ ok: Array.isArray(res) && res.length > 0 });
      }

      case "stato": {
        const r = await leggi<QuotePcRichiesta>(RICHIESTA);
        if (!r || r.id !== body.id) return jsonResponse({ error: "Richiesta sconosciuta" }, 404);
        const nuovoStato = ["in_corso", "fatto", "errore"].includes(body.stato) ? body.stato : r.stato;
        await pgPatch(`settings?key=eq.${RICHIESTA}&value->>id=eq.${r.id}`, {
          value: {
            ...r, stato: nuovoStato, aggiornato: ora,
            fase: body.fase != null ? String(body.fase) : r.fase,
            esito: body.esito ?? r.esito,
            errore: body.errore != null ? String(body.errore) : r.errore,
          },
        });
        return jsonResponse({ ok: true });
      }

      default:
        return jsonResponse({ error: "azione sconosciuta" }, 400);
    }
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 500);
  }
};
