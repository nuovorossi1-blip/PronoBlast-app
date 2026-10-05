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
 * COME SI PARLANO APP E PC. Il PC sta dietro il router di casa: non lo si puo'
 * chiamare. E' lui che chiama noi, ogni 15 secondi ("battito"):
 *  - `settings.pc_quote_battito`   -> l'ultimo battito. Vecchio = PC spento.
 *  - `settings.pc_quote_richiesta` -> la richiesta del tasto e il suo stato.
 * Il tasto crea la richiesta (solo se il PC e' acceso); al battito dopo il PC
 * la prende, scrive le fasi mentre lavora e alla fine l'esito.
 *
 *   GET  /quote-pc                         -> { acceso, ultimo_battito, richiesta }
 *   POST /quote-pc { azione: "avvia" }     -> crea la richiesta (409 se PC spento)
 *   POST /quote-pc { azione: "battito" }   -> (PC) battito; risponde con la richiesta in attesa
 *   POST /quote-pc { azione: "prendi", id }-> (PC) in_attesa -> in_corso, una volta sola
 *   POST /quote-pc { azione: "stato", id, stato, fase, esito, errore } -> (PC) avanzamento
 */

const BATTITO = "pc_quote_battito";
const RICHIESTA = "pc_quote_richiesta";
/** Il PC batte ogni 15 s: senza battiti da 60 s lo consideriamo spento. */
const SPENTO_DOPO_MS = 60_000;
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

async function stato(): Promise<QuotePcStato> {
  const [b, r] = await Promise.all([
    leggi<{ ultimo: string }>(BATTITO),
    leggi<QuotePcRichiesta>(RICHIESTA),
  ]);
  const ultimo = b?.ultimo || null;
  return {
    acceso: !!ultimo && Date.now() - Date.parse(ultimo) < SPENTO_DOPO_MS,
    ultimo_battito: ultimo,
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

    switch (body?.azione) {
      case "avvia": {
        const s = await stato();
        if (!s.acceso) {
          return jsonResponse({
            error: "Server spento: il PC di casa non risponde. Accendilo (o controlla che sia connesso) e riprova.",
            spento: true, ...s,
          }, 409);
        }
        if (attiva(s.richiesta)) {
          return jsonResponse({ error: "C'e' gia' un aggiornamento quote in corso.", ...s }, 409);
        }
        const richiesta: QuotePcRichiesta = {
          id: crypto.randomUUID(), stato: "in_attesa", creata: ora, aggiornato: ora,
          fase: "In attesa del PC…", esito: null, errore: null,
        };
        await scrivi(RICHIESTA, richiesta);
        return jsonResponse({ ok: true, richiesta });
      }

      case "battito": {
        await scrivi(BATTITO, { ultimo: ora, versione: String(body.versione || "") });
        const r = await leggi<QuotePcRichiesta>(RICHIESTA);
        return jsonResponse({ ok: true, richiesta: r && r.stato === "in_attesa" && attiva(r) ? r : null });
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
