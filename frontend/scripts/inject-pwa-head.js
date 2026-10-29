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
  '<meta name="theme-color" content="#1A1A1A" />',
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

// Grafica ispirata a RVincente (29/10/2026): font Manrope (testi) e Barlow
// Condensed (titoli, fonts.heading in src/theme.ts), sfondo grafite e una
// schermata d'avvio col nome in oro che _layout.tsx sfuma quando l'app e' pronta.
// I font sono in public/fonts (licenza SIL OFL, presi da Google Fonts).
// React Native Web scrive il testo normale con la pila "-apple-system,
// BlinkMacSystemFont, ...": dare a Manrope anche il nome "-apple-system" la
// fa usare a tutto il testo senza toccare le icone, che hanno un font loro.
const manrope = (nome) => [
  ["manrope-latin", "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD"],
  ["manrope-latin-ext", "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF"],
].map(([f, r]) => `@font-face { font-family: "${nome}"; font-style: normal; font-weight: 200 800; font-display: swap; src: url(/fonts/${f}.woff2) format("woff2"); unicode-range: ${r}; }`).join("\n      ");
const barlow = [600, 700, 800, 900].map((w) => `@font-face { font-family: "Barlow Condensed"; font-style: normal; font-weight: ${w}; font-display: swap; src: url(/fonts/barlow-condensed-${w}.woff2) format("woff2"); }`).join("\n      ");
const grafica = `<link rel="preload" href="/fonts/manrope-latin.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="/fonts/barlow-condensed-900.woff2" as="font" type="font/woff2" crossorigin />
    <style id="pb-grafica">
      ${manrope("Manrope")}
      ${manrope("-apple-system")}
      ${barlow}
      html, body, #root { background: #1A1A1A; }
      body { -webkit-font-smoothing: antialiased; }
      #pb-splash { position: fixed; inset: 0; z-index: 2147483647; background: #1A1A1A; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px; transition: opacity 300ms ease-out; }
      #pb-splash.pb-splash-via { opacity: 0; pointer-events: none; }
      #pb-splash img { width: 84px; height: 84px; border-radius: 22px; box-shadow: 0 0 40px rgba(245,166,35,.25); }
      #pb-splash .pb-nome { font-family: "Barlow Condensed", system-ui, sans-serif; font-weight: 900; font-size: 34px; letter-spacing: 3px; color: #F5A623; text-shadow: 0 0 24px rgba(245,166,35,.45); }
      #pb-splash .pb-giro { width: 34px; height: 34px; border: 3px solid rgba(245,166,35,.15); border-top-color: #F5A623; border-radius: 50%; animation: pb-giro .8s linear infinite; }
      @keyframes pb-giro { to { transform: rotate(360deg); } }
    </style>`;
if (!html.includes('id="pb-grafica"')) {
  html = html.replace("</head>", "  " + grafica + "\n</head>");
}
const splash = `<div id="pb-splash"><img src="/pronoblast-192.png" alt="" /><div class="pb-nome">PRONOBLAST</div><div class="pb-giro"></div></div><script>window.__pbSplashT=Date.now()</script>`;
if (!html.includes('id="pb-splash"')) {
  html = html.replace(/<body([^>]*)>/, `<body$1>${splash}`);
}

fs.writeFileSync(file, html);
console.log(`inject-pwa-head: ok (${mancanti.length} tag aggiunti)`);
