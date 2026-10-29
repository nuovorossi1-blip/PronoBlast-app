// Grafica ispirata a RVincente (29/10/2026): grafite, oro con riflesso corallo,
// riquadri "a vetro", testi Manrope e titoli Barlow Condensed. I colori con un
// significato (success/warning/danger, AI, cluster) restano quelli di prima.
export const colors = {
  bg: "#1A1A1A",
  surface: "#242424",
  // Alias usati in alcune schermate (quote, risultato, match): stessi valori di bg/surface
  background: "#1A1A1A",
  card: "#242424",
  surfaceHi: "#2D2D2D",
  // Gradiente: oro → arancio → corallo
  primary: "#F5A623",
  primaryLight: "#FFC15E",
  primaryDark: "#FF6B6B",
  text: "#FFFFFF",
  textMuted: "#A1A1AA",
  textDim: "#71717A",
  border: "rgba(255,255,255,0.08)",
  borderLight: "rgba(255,255,255,0.16)",
  success: "#10B981",
  warning: "#F59E0B",
  danger: "#EF4444",
  aiBg: "rgba(96, 165, 250, 0.12)",
  aiText: "#60A5FA",
  clusterBg: "rgba(192, 132, 252, 0.12)",
  clusterText: "#C084FC",
  // Riquadri a vetro (barra in basso, intestazioni)
  glass: "rgba(36,36,36,0.72)",
};

// File in public/fonts, dichiarati nella pagina da scripts/inject-pwa-head.js.
// Il testo normale prende Manrope da solo; heading va messo sui titoli.
export const fonts = {
  body: "Manrope",
  heading: "Barlow Condensed",
};

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  full: 999,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};
