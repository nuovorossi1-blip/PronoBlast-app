#!/usr/bin/env node
/**
 * Con `web.output: "single"` (SPA) Expo NON usa `app/+html.tsx`: genera
 * `dist/index.html` da un suo template minimo. Le meta della PWA (manifest,
 * theme-color, icona iOS, lang) vanno quindi iniettate dopo l'export.
 * Lanciato da `yarn build:web`, quindi vale sia in locale sia su Vercel/Netlify.
 */
const fs = require("fs");
const path = require("path");

const outputDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, "..", "dist");
const file = path.join(outputDir, "index.html");
if (!fs.existsSync(file)) {
  console.error("inject-pwa-head: dist/index.html non trovato — export fallito?");
  process.exit(1);
}

let html = fs.readFileSync(file, "utf8");
html = html.replace(/<html lang="[^"]*"/, '<html lang="it"');

const tags = [
  '<meta name="description" content="Analisi partite e pronostici: motore statistico, IA e quote del bookmaker" />',
  '<meta name="theme-color" content="#0A0A0A" />',
  '<meta name="apple-mobile-web-app-capable" content="yes" />',
  // "black" e NON "black-translucent": con translucent la pagina viene disegnata
  // SOTTO la barra di stato e l'intestazione (col tasto indietro) finisce nascosta.
  '<meta name="apple-mobile-web-app-status-bar-style" content="black" />',
  '<meta name="apple-mobile-web-app-title" content="PronoBlast" />',
  '<link rel="apple-touch-icon" href="/pronoblast-192.png" />',
  '<link rel="manifest" href="/manifest.webmanifest" />',
];

const mancanti = tags.filter((t) => !html.includes(t));
if (mancanti.length) {
  html = html.replace("</head>", "  " + mancanti.join("\n  ") + "\n</head>");
}

// NIENTE viewport-fit=cover.
// Con il valore predefinito ("auto") il browser tiene la pagina DENTRO l'area
// sicura: sotto la barra di stato, sopra la barra dei gesti, fuori dalle tacche.
// Con "cover" la pagina si estende sotto le barre di sistema e va compensata a
// mano con env(safe-area-inset-*): dove quella compensazione non arriva
// (WebView Android in edge-to-edge, PWA installata) l'intestazione con il tasto
// indietro finisce sotto la barra di stato. Se per qualche motivo fosse gia'
// presente, lo togliamo.
html = html.replace(/,?\s*viewport-fit=cover/g, "");

// Altezza della pagina agganciata al viewport VISIBILE (dvh), non al viewport di
// layout: su telefono il 100% include la barra degli indirizzi, quindi la barra
// in basso e i pulsanti di fondo pagina finivano sotto il bordo dello schermo.
// Il blocco e' idempotente: si aggiunge solo se non c'e' gia'.
const altezza = `<style id="pb-viewport">
      /* Vedi scripts/inject-pwa-head.js */
      html, body, #root { height: 100%; }
      @supports (height: 100dvh) { html, body, #root { height: 100dvh; } }
    </style>`;
if (!html.includes('id="pb-viewport"')) {
  html = html.replace("</head>", "  " + altezza + "\n</head>");
}

fs.writeFileSync(file, html);
console.log(`inject-pwa-head: ok (${mancanti.length} tag aggiunti)`);
