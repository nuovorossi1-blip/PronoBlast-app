/**
 * SERVER LOCALE (06/10/2026) — PronoBlast sul PC di casa al posto di Vercel.
 *
 * PERCHE'. Il piano gratuito di Vercel e' stato messo in pausa (CPU esaurita):
 * fino al rinnovo del mese l'app gira qui, poi si torna su Vercel. Fa la stessa
 * cosa di Vercel con vercel.json:
 *  - le rotte delle funzioni (/predict, /lavori, ... e /api/<nome>) vanno allo
 *    STESSO dispatcher di Vercel (api/[route].ts) e a upload-excel;
 *  - il resto e' il sito statico di frontend/dist, con /index.html di riserva.
 * Nessuna logica duplicata: le funzioni sono quelle di netlify/functions/.
 *
 * Avvio: avvia.ps1 (operazione pianificata "PronoBlast - Server locale").
 * Da internet: Tailscale Funnel https://pc-claude.tailcad625.ts.net:8443.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { fork } from "node:child_process";
import os from "node:os";
import { POST as dispatch } from "../api/[route]";
import uploadExcel from "../netlify/functions/upload-excel.mjs";
import { ricalcolaConsigliatiQuoteCambiate } from "../netlify/functions/lib/letturaPartita";
import { svuotaServerCache } from "../netlify/functions/lib/serverCache";
import { precalcolaVerdetti } from "../netlify/functions/lib/verdettiGiornata";
import { recuperaLavoriSaltati } from "../netlify/functions/lib/recuperoLavori";

const QUI = path.dirname(fileURLToPath(import.meta.url));
const RADICE = path.resolve(QUI, "..");
const DIST = path.join(RADICE, "frontend", "dist");
const PORTA = Number(process.env.PORTA || 3000);
// Su un server nostro (questo PC, domani la VPS) una richiesta puo' durare
// quanto serve: i modelli gratuiti di OpenRouter ci mettono minuti. Senza,
// llmProviders.ts applicherebbe il limite di Netlify (21 s). Il .env vince.
process.env.LIMITE_PIATTAFORMA_SECONDI ||= "630";

// DUE PROCESSI (10/10/2026, Rossi: "prima era fluida, adesso ogni click carica").
// Node fa una cosa alla volta: mentre calcolava i verdetti di 186 partite
// (80-160 s) o il dossier (4 minuti), le richieste del telefono restavano in
// coda e la scheda partita passava da 0,3 s a 3-5 s. Ora questo processo
// risponde all'app e ne avvia un secondo, "lavori" (porta 3002, priorita'
// bassa), con gli stessi file: lì girano dossier, quote, verdetti in anticipo e
// recupero dei lavori saltati. I calcoli sono gli stessi, cambia solo dove.
const RUOLO_LAVORI = process.env.PRONOBLAST_RUOLO === "lavori";
const PORTA_LAVORI = Number(process.env.PORTA_LAVORI || 3002);
const ETICHETTA = RUOLO_LAVORI ? "[lavori] " : "";

/** Le rotte che fanno partire lavori lunghi vanno al processo "lavori". */
function eLavoroPesante(nome: string, url: URL): boolean {
  return nome === "dossier-giornata" || nome === "quote-pc" || (nome === "verdetto" && url.searchParams.has("day"));
}

// Le rotte delle funzioni sono quelle riscritte da vercel.json verso /api/...
const vercel = JSON.parse(fs.readFileSync(path.join(RADICE, "vercel.json"), "utf8"));
const FUNZIONI = new Set<string>(
  vercel.rewrites
    .filter((r: any) => String(r.destination).startsWith("/api/"))
    .map((r: any) => String(r.source).replace(/^\//, "")),
);
const INTESTAZIONI: Record<string, string> = Object.fromEntries(
  (vercel.headers?.[0]?.headers || []).map((h: any) => [h.key, h.value]),
);

const TIPI: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".map": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp",
  ".ttf": "font/ttf", ".woff": "font/woff", ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json", ".txt": "text/plain; charset=utf-8",
};

// COMPRESSIONE (07/10/2026, Rossi: "la prima volta non e' reattivo"). L'app
// (3 MB di JavaScript) e le risposte partivano senza compressione: a ogni
// aggiornamento il telefono riscaricava 3 MB in rete mobile. Con brotli i file
// dell'app pesano ~5 volte meno (compressi una volta e tenuti in memoria), le
// risposte delle funzioni si comprimono con gzip.
const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);
const COMPRIMIBILI = /\.(js|css|html|json|map|svg|txt|webmanifest|ttf)$/i;
const compressi = new Map<string, { mtime: number; dati: Buffer }>();

function accetta(req: http.IncomingMessage, cosa: string): boolean {
  return String(req.headers["accept-encoding"] || "").includes(cosa);
}

async function fileCompresso(file: string): Promise<Buffer> {
  const mtime = fs.statSync(file).mtimeMs;
  const c = compressi.get(file);
  if (c && c.mtime === mtime) return c.dati;
  const dati = await brotli(fs.readFileSync(file), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } });
  compressi.set(file, { mtime, dati });
  return dati;
}

function leggiCorpo(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((ok, ko) => {
    const pezzi: Buffer[] = [];
    req.on("data", (p) => pezzi.push(p));
    req.on("end", () => ok(Buffer.concat(pezzi)));
    req.on("error", ko);
  });
}

/** Dopo un Excel nuovo: dossier delle quote cambiate, consigliati e verdetti. */
function lavoriDopoExcel() {
  fetch(`http://127.0.0.1:${PORTA}/dossier-giornata?avvia=1`, { method: "POST" }).catch(() => {});
  ricalcolaConsigliatiQuoteCambiate().catch((e) => console.error("[server] ricalcolo quote cambiate", e));
  void precalcolaVerdetti("excel");
}

/** Passa la richiesta al processo "lavori". false = non risponde: la fa questo processo. */
function inoltraAiLavori(req: http.IncomingMessage, res: http.ServerResponse, corpo?: Buffer): Promise<boolean> {
  return new Promise((ok) => {
    const t0 = Date.now();
    const intestazioni = { ...req.headers };
    if (corpo) intestazioni["content-length"] = String(corpo.length);
    const avanti = http.request(
      { host: "127.0.0.1", port: PORTA_LAVORI, method: req.method, path: req.url, headers: intestazioni },
      (r) => {
        res.writeHead(r.statusCode || 502, r.headers);
        r.pipe(res);
        r.on("end", () => {
          console.log(`[API ${req.method}] ${req.url} -> ${r.statusCode} in ${Date.now() - t0} ms (processo lavori)`);
          ok(true);
        });
      },
    );
    avanti.on("error", () => ok(res.headersSent));
    avanti.end(corpo);
  });
}

async function funzione(req: http.IncomingMessage, res: http.ServerResponse, nome: string) {
  const t0 = Date.now();
  const host = req.headers["x-forwarded-host"] || req.headers.host || `127.0.0.1:${PORTA}`;
  const proto = req.headers["x-forwarded-proto"] || "http";
  const url = `${proto}://${host}${req.url}`;
  const corpo = req.method === "GET" || req.method === "HEAD" ? undefined : await leggiCorpo(req);
  if (!RUOLO_LAVORI && eLavoroPesante(nome, new URL(url))) {
    // Le scritture del processo lavori (quote nuove) rendono vecchia la cache breve di qui.
    if (corpo) svuotaServerCache(nome);
    if (await inoltraAiLavori(req, res, corpo)) return;
    console.error(new Date().toISOString(), `[server] processo lavori assente: ${nome} fatto qui`);
  }
  const intestazioni = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v != null) intestazioni.set(k, Array.isArray(v) ? v.join(", ") : v);
  }
  const richiesta = new Request(url, { method: req.method, headers: intestazioni, body: corpo });
  const risposta: Response = nome === "upload-excel" ? await uploadExcel(richiesta) : await dispatch(richiesta);
  // QUOTE CARICATE (07/10/2026, Rossi: "se scarico le quote alle 15 o alle 18
  // e cambiano"): si riavvia il giro del dossier del giorno, che rifa' la
  // lettura AI gratis solo delle partite con le quote cambiate o nuove.
  if (nome === "upload-excel" && risposta.ok) {
    svuotaServerCache("upload-excel");
    if (RUOLO_LAVORI) lavoriDopoExcel();
    else {
      fetch(`http://127.0.0.1:${PORTA_LAVORI}/_lavori/dopo-excel`, { method: "POST" })
        .then((r) => { if (!r.ok) throw new Error(String(r.status)); })
        .catch(() => { console.error("[server] processo lavori assente: lavori dopo l'Excel fatti qui"); lavoriDopoExcel(); });
    }
  }
  const fuori: Record<string, string> = { ...INTESTAZIONI };
  risposta.headers.forEach((v, k) => { if (k !== "content-encoding" && k !== "content-length") fuori[k] = v; });
  let dati = Buffer.from(await risposta.arrayBuffer());
  if (dati.length > 1024 && accetta(req, "gzip") && !/event-stream/.test(fuori["content-type"] || "")) {
    dati = await gzip(dati, { level: 6 });
    fuori["content-encoding"] = "gzip";
    fuori["vary"] = "Accept-Encoding";
  }
  console.log(`${ETICHETTA}[API ${req.method}] ${req.url} -> ${risposta.status} in ${Date.now() - t0} ms (${dati.length} bytes, enc: ${fuori["content-encoding"] || "raw"})`);
  res.writeHead(risposta.status, fuori);
  res.end(dati);
}

async function statico(req: http.IncomingMessage, res: http.ServerResponse, percorso: string) {
  let file = path.join(DIST, decodeURIComponent(percorso));
  if (!file.startsWith(DIST)) file = path.join(DIST, "index.html");
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const html = file + ".html";
    file = fs.existsSync(html) ? html : path.join(DIST, "index.html");
  }
  const tipo = TIPI[path.extname(file).toLowerCase()] || "application/octet-stream";
  const cache = file.includes(`${path.sep}_expo${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache";
  if (COMPRIMIBILI.test(file) && accetta(req, "br")) {
    const dati = await fileCompresso(file);
    res.writeHead(200, { ...INTESTAZIONI, "Content-Type": tipo, "Cache-Control": cache, "Content-Encoding": "br", "Vary": "Accept-Encoding" });
    return res.end(req.method === "HEAD" ? undefined : dati);
  }
  res.writeHead(200, { ...INTESTAZIONI, "Content-Type": tipo, "Cache-Control": cache, "Vary": "Accept-Encoding" });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}

http.createServer(async (req, res) => {
  const percorso = new URL(req.url || "/", "http://x").pathname;
  const nome = percorso.split("/").filter(Boolean).pop() || "";
  const eFunzione = percorso.startsWith("/api/") || FUNZIONI.has(percorso.replace(/^\//, ""));
  try {
    if (RUOLO_LAVORI && percorso === "/_lavori/dopo-excel") {
      lavoriDopoExcel();
      res.writeHead(202, { "Content-Type": "application/json" });
      return res.end('{"ok":true}');
    }
    if (eFunzione) await funzione(req, res, nome);
    else await statico(req, res, percorso);
  } catch (e: any) {
    console.error(new Date().toISOString(), req.method, percorso, e);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e?.message || "Errore del server locale" }));
  }
}).listen(PORTA, "127.0.0.1", () => {
  console.log(new Date().toISOString(), `${ETICHETTA}PronoBlast locale su http://127.0.0.1:${PORTA}`);
});

if (RUOLO_LAVORI) {
  // Se il processo dell'app si chiude, questo non deve restare orfano sulla porta.
  process.on("disconnect", () => process.exit(0));
  // VERDETTI PRONTI PRIMA DELL'APERTURA (10/10/2026): oggi e i due giorni dopo,
  // poco dopo l'avvio (il server intanto risponde) e poi ogni 30 minuti per le
  // partite e le quote nuove. Le partite gia' calcolate costano un millisecondo.
  setTimeout(() => void precalcolaVerdetti("avvio"), 15_000);
  setInterval(() => void precalcolaVerdetti("ogni 30 minuti"), 30 * 60_000);
  // LAVORI SALTATI A PC SPENTO (10/10/2026): dossier delle 6/13 e quote delle 12
  // non fatti oggi si avviano ora. Dopo 3 minuti (l'agente quote e la rete
  // partono con calma) e di nuovo dopo 10, se la prima volta non rispondevano.
  for (const minuti of [3, 10]) {
    setTimeout(() => {
      recuperaLavoriSaltati(`http://127.0.0.1:${PORTA}`)
        .then((fatti) => { if (fatti.length) console.log(new Date().toISOString(), "[recupero]", fatti.join("; ")); })
        .catch((e) => console.error("[recupero]", e));
    }, minuti * 60_000);
  }
} else {
  // Stesso file, stesse opzioni (tsx, .env), priorita' bassa: il PC da' la
  // precedenza alle richieste del telefono. Se si chiude, riparte da solo.
  // L'operazione pianificata di Windows avvia tutto a priorita' bassa: questo
  // processo, che risponde al telefono, torna normale.
  try { os.setPriority(0, os.constants.priority.PRIORITY_NORMAL); } catch { /* resta com'e' */ }
  const avviaLavori = () => {
    const figlio = fork(fileURLToPath(import.meta.url), [], {
      env: { ...process.env, PRONOBLAST_RUOLO: "lavori", PORTA: String(PORTA_LAVORI) },
    });
    try { os.setPriority(figlio.pid!, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* resta normale */ }
    figlio.on("exit", (codice) => {
      console.error(new Date().toISOString(), `[server] processo lavori chiuso (${codice}): riparte fra 10 s`);
      setTimeout(avviaLavori, 10_000);
    });
  };
  avviaLavori();
}
