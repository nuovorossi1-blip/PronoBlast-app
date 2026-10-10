import { pgGet } from "./supabaseRest";

/**
 * LAVORI AUTOMATICI SALTATI A PC SPENTO (10/10/2026).
 *
 * Gli orologi pg_cron chiamano il PC alle 6 e alle 13 (dossier) e alle 12
 * (quote). Se in quell'ora il PC era spento la chiamata va persa e il lavoro
 * non si rifaceva fino al turno dopo. All'avvio del server locale si guarda
 * l'ultimo turno passato di oggi: se non risulta fatto, lo si avvia ora,
 * esattamente come avrebbe fatto l'orologio.
 */
const ORE_DOSSIER = [6, 13];
const ORA_QUOTE = 12;

function oraRoma(): { giorno: string; ora: number } {
  const parti = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { giorno: `${parti.year}-${parti.month}-${parti.day}`, ora: Number(parti.hour) };
}

/** L'istante (ms) di "oggi alle hh:00" ora di Roma. */
function oggiAlle(ore: number): number {
  const { giorno } = oraRoma();
  const comeUtc = Date.parse(`${giorno}T${String(ore).padStart(2, "0")}:00:00Z`);
  // differenza fra Roma e UTC in questo momento (1 o 2 ore)
  const roma = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", hourCycle: "h23" }).format(new Date(comeUtc)));
  const scarto = (roma - ore + 24) % 24;
  return comeUtc - scarto * 3600_000;
}

async function valore(chiave: string): Promise<any | null> {
  const r = await pgGet(`settings?key=eq.${chiave}&select=value`).catch(() => []);
  return (Array.isArray(r) && r[0]?.value) || null;
}

export async function recuperaLavoriSaltati(base: string): Promise<string[]> {
  const fatti: string[] = [];
  const { ora } = oraRoma();

  // Dossier: l'ultimo turno passato (6 o 13) deve essere partito dopo il suo orario.
  const turno = [...ORE_DOSSIER].reverse().find((h) => ora >= h);
  if (turno !== undefined) {
    const s = await valore("dossier_giornata");
    const avviato = s?.avviato ? Date.parse(s.avviato) : 0;
    if (!(avviato >= oggiAlle(turno))) {
      const r = await fetch(`${base}/dossier-giornata?avvia=1`, { method: "POST" }).catch(() => null);
      fatti.push(`dossier delle ${turno}: ${r?.ok ? "avviato" : `non avviato (${r?.status ?? "nessuna risposta"})`}`);
    }
  }

  // Quote delle 12: una richiesta creata oggi dopo le 12 e non finita in
  // errore vale come fatta (in errore = il PC non rispondeva: si riprova).
  if (ora >= ORA_QUOTE) {
    const q = await valore("pc_quote_richiesta");
    const creata = q?.creata ? Date.parse(q.creata) : 0;
    if (!(creata >= oggiAlle(ORA_QUOTE)) || q?.stato === "errore") {
      const r = await fetch(`${base}/quote-pc`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ azione: "avvia" }),
      }).catch(() => null);
      fatti.push(`quote delle 12: ${r?.ok ? "avviate" : `non avviate (${r?.status ?? "nessuna risposta"})`}`);
    }
  }
  return fatti;
}
