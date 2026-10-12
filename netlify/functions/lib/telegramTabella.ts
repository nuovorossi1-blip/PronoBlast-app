/**
 * Messaggi del bot Telegram in tabella (13/10/2026, Rossi: "formato
 * tabellare facilmente intuibile"). Telegram non ha tabelle vere: si usa un
 * blocco <pre> a caratteri tutti uguali, largo al massimo ~34 caratteri per
 * stare sul telefono in verticale; i dettagli vanno sotto, numerati.
 * Va inviato con parse_mode HTML.
 */

export const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const SIGLE = /^(fc|cf|sc|ac|as|ssc|ss|us|cd|ud|sd|ca|afc|bk|if|fk|sk|ik|kv|krc|rsc|sv|vfl|vfb|tsg|real|club|sporting|atletico|athletic|deportivo|dinamo|dynamo|olympique|ogc|rc|1\.)$/i;
/** "Ludogorets Razgrad" -> "Ludogorets"; "Fc Arda Kardzhali" -> "Arda": la parola che riconosci, max n lettere. */
export function corto(squadra: string, n = 8): string {
  const parole = String(squadra).split(/\s+/).filter(Boolean);
  const p = parole.find((x) => !SIGLE.test(x) && x.length >= 3) || parole[0] || squadra;
  return p.length > n ? p.slice(0, n - 1) + "." : p;
}
/** "MG 1-3 casa + MG 0-2 ospite" -> "MG1-3c+0-2o"; "X oppure GG" -> "X o GG"; "DC 1X + O1.5" -> "1X+O1.5". */
export function giocataCorta(m: string): string {
  return String(m)
    .replace(/^DC\s+/i, "").replace(/\+\s*DC\s+/gi, "+")
    .replace(/X oppure GG/i, "X o GG")
    .replace(/MG\s*(\d-\d)\s*totali/gi, "MG$1")
    .replace(/MG\s*(\d-\d)\s*casa/gi, "MG$1c").replace(/MG\s*(\d-\d)\s*ospite/gi, "MG$1o")
    .replace(/\s*\+\s*MG/g, "+").replace(/\s*\+\s*/g, "+")
    .trim();
}
const taglia = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
const quota = (q: number | null | undefined) => (q == null ? " n/d" : q.toFixed(2));

/** Tabella monospazio: colonne con larghezza fissa, la prima colonna puo' essere un'emoji. */
export function pre(intestazione: string[], righe: string[][], larghezze: number[]): string {
  // Prima colonna con l'emoji (✅ 🔄 ...): niente riempimento, le emoji hanno
  // lunghezze diverse in JS ma occupano tutte 2 caratteri sullo schermo.
  const riga = (c: string[], testata = false) => c.map((x, i) =>
    i === 0 && larghezze[0] === 2 ? (testata ? "  " : x)
      : i === c.length - 1 ? x.padStart(larghezze[i]) : taglia(x, larghezze[i])).join(" ");
  return `<pre>${esc([riga(intestazione, true), "─".repeat(larghezze.reduce((a, b) => a + b + 1, -1)), ...righe.map((r) => riga(r))].join("\n"))}</pre>`;
}

export const partita = (casa: string, ospite: string) => `${corto(casa)}-${corto(ospite)}`;
export { quota as q };
