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
import { POST as dispatch } from "../api/[route]";
import uploadExcel from "../netlify/functions/upload-excel.mjs";

const QUI = path.dirname(fileURLToPath(import.meta.url));
const RADICE = path.resolve(QUI, "..");
const DIST = path.join(RADICE, "frontend", "dist");
const PORTA = Number(process.env.PORTA || 3000);

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

function leggiCorpo(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((ok, ko) => {
    const pezzi: Buffer[] = [];
    req.on("data", (p) => pezzi.push(p));
    req.on("end", () => ok(Buffer.concat(pezzi)));
    req.on("error", ko);
  });
}

async function funzione(req: http.IncomingMessage, res: http.ServerResponse, nome: string) {
  const host = req.headers["x-forwarded-host"] || req.headers.host || `127.0.0.1:${PORTA}`;
  const proto = req.headers["x-forwarded-proto"] || "http";
  const url = `${proto}://${host}${req.url}`;
  const corpo = req.method === "GET" || req.method === "HEAD" ? undefined : await leggiCorpo(req);
  const intestazioni = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v != null) intestazioni.set(k, Array.isArray(v) ? v.join(", ") : v);
  }
  const richiesta = new Request(url, { method: req.method, headers: intestazioni, body: corpo });
  const risposta: Response = nome === "upload-excel" ? await uploadExcel(richiesta) : await dispatch(richiesta);
  const fuori: Record<string, string> = { ...INTESTAZIONI };
  risposta.headers.forEach((v, k) => { if (k !== "content-encoding" && k !== "content-length") fuori[k] = v; });
  res.writeHead(risposta.status, fuori);
  res.end(Buffer.from(await risposta.arrayBuffer()));
}

function statico(req: http.IncomingMessage, res: http.ServerResponse, percorso: string) {
  let file = path.join(DIST, decodeURIComponent(percorso));
  if (!file.startsWith(DIST)) file = path.join(DIST, "index.html");
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const html = file + ".html";
    file = fs.existsSync(html) ? html : path.join(DIST, "index.html");
  }
  const tipo = TIPI[path.extname(file).toLowerCase()] || "application/octet-stream";
  const cache = file.includes(`${path.sep}_expo${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache";
  res.writeHead(200, { ...INTESTAZIONI, "Content-Type": tipo, "Cache-Control": cache });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}

http.createServer(async (req, res) => {
  const percorso = new URL(req.url || "/", "http://x").pathname;
  const nome = percorso.split("/").filter(Boolean).pop() || "";
  const eFunzione = percorso.startsWith("/api/") || FUNZIONI.has(percorso.replace(/^\//, ""));
  try {
    if (eFunzione) await funzione(req, res, nome);
    else statico(req, res, percorso);
  } catch (e: any) {
    console.error(new Date().toISOString(), req.method, percorso, e);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e?.message || "Errore del server locale" }));
  }
}).listen(PORTA, "127.0.0.1", () => {
  console.log(new Date().toISOString(), `PronoBlast locale su http://127.0.0.1:${PORTA}`);
});
