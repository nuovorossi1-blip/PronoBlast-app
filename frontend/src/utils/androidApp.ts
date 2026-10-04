/**
 * App Android di PronoBlast (guscio Capacitor, cartella android/ nella radice).
 *
 * Questo file e' l'unico punto del frontend che sa dell'APK. Non importa
 * @capacitor/core: quando la pagina gira dentro il guscio, Capacitor inietta
 * da solo `window.Capacitor` (con `Plugins` e `registerPlugin`), e qui lo si
 * legge se c'e'. Nel browser normale tutto restituisce "non nativo".
 *
 * L'APK e' pubblicato come GitHub Release (workflow .github/workflows/build-apk.yml):
 * - link fisso all'ultima versione: RELEASE_LATEST_APK
 * - controllo versione: API pubblica GitHub, tag "apk-v1.0.N"
 */
import { Platform } from "react-native";

export const REPO = "nuovorossi1-blip/PronoBlast-app";
export const RELEASE_LATEST_APK = `https://github.com/${REPO}/releases/latest/download/PronoBlast.apk`;
export const RELEASE_LATEST_PAGE = `https://github.com/${REPO}/releases/latest`;
const RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;

export interface InstalledVersion {
  version: string;
  versionCode: number;
}

export interface RemoteRelease {
  version: string;   // "1.0.12"
  tag: string;       // "apk-v1.0.12"
  apkUrl: string;    // asset PronoBlast.apk della release
  pageUrl: string;
  notes: string;
}

interface ApkUpdaterPlugin {
  getCurrentVersion(): Promise<InstalledVersion>;
  canInstallPackages(): Promise<{ allowed: boolean }>;
  openInstallSettings(): Promise<void>;
  downloadAndInstall(options: { url: string; fileName: string }): Promise<{ started: boolean }>;
}

function cap(): any | null {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  const c = (window as any).Capacitor;
  return c && typeof c.isNativePlatform === "function" ? c : null;
}

/** true solo dentro l'APK Android (WebView Capacitor). */
export function isAndroidShell(): boolean {
  const c = cap();
  if (!c) return false;
  try {
    return c.isNativePlatform() === true && c.getPlatform() === "android";
  } catch {
    return false;
  }
}

/** true nel browser Chrome/Firefox di un telefono Android (NON dentro l'APK). */
export function isAndroidBrowser(): boolean {
  if (Platform.OS !== "web" || typeof navigator === "undefined") return false;
  if (isAndroidShell()) return false;
  return /android/i.test(navigator.userAgent || "");
}

function plugin(): ApkUpdaterPlugin | null {
  const c = cap();
  if (!c) return null;
  const p = c.Plugins?.ApkUpdater ?? (typeof c.registerPlugin === "function" ? c.registerPlugin("ApkUpdater") : null);
  return p || null;
}

/** Confronto "1.0.12" > "1.0.9". Tollera il prefisso "apk-v" / "v". */
export function isNewerVersion(remote: string, installed: string): boolean {
  const norm = (v: string) =>
    v.replace(/^apk-v/i, "").replace(/^v/i, "").split("-")[0].split(".").map((p) => Number.parseInt(p, 10) || 0);
  const a = norm(remote), b = norm(installed);
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

export async function getInstalledVersion(): Promise<InstalledVersion | null> {
  const p = plugin();
  if (!p) return null;
  return p.getCurrentVersion();
}

export async function fetchLatestRelease(): Promise<RemoteRelease | null> {
  const r = await fetch(RELEASE_API, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
  if (r.status === 404) return null; // nessuna release ancora pubblicata
  if (!r.ok) throw new Error(`GitHub releases ${r.status}`);
  const j = await r.json();
  const tag: string = j.tag_name || "";
  if (!/^apk-v/i.test(tag)) return null; // release di altro tipo, non e' un APK
  const asset = (j.assets || []).find((a: any) => a.name === "PronoBlast.apk");
  return {
    version: tag.replace(/^apk-v/i, ""),
    tag,
    apkUrl: asset?.browser_download_url || RELEASE_LATEST_APK,
    pageUrl: j.html_url || RELEASE_LATEST_PAGE,
    notes: (j.body || "").trim(),
  };
}

/**
 * Dentro l'APK: se c'e' una release piu' nuova della versione installata, la
 * restituisce. Qualsiasi errore (offline, API GitHub, plugin assente) -> null:
 * il controllo aggiornamenti non deve mai impedire l'avvio dell'app.
 */
export async function checkForAndroidUpdate(): Promise<{ installed: InstalledVersion; release: RemoteRelease } | null> {
  if (!isAndroidShell()) return null;
  try {
    const [installed, release] = await Promise.all([getInstalledVersion(), fetchLatestRelease()]);
    if (!installed || !release) return null;
    return isNewerVersion(release.version, installed.version) ? { installed, release } : null;
  } catch {
    return null;
  }
}

/**
 * Scarica e apre l'installatore. Restituisce "permission" se prima bisogna
 * autorizzare "Installa app sconosciute" (in quel caso apre le impostazioni).
 */
export async function installAndroidUpdate(release: RemoteRelease): Promise<"started" | "permission"> {
  const p = plugin();
  if (!p) throw new Error("Plugin ApkUpdater non disponibile");
  const cap = await p.canInstallPackages();
  if (!cap.allowed) {
    await p.openInstallSettings();
    return "permission";
  }
  await p.downloadAndInstall({ url: release.apkUrl, fileName: `PronoBlast-${release.version}.apk` });
  return "started";
}

/** Dal browser: avvia il download dell'ultimo APK. */
export function downloadLatestApk() {
  if (typeof window === "undefined") return;
  // location.href (non window.open): Chrome Android avvia il download e resta
  // sulla pagina, mentre una nuova scheda per un .apk finisce spesso vuota.
  window.location.href = RELEASE_LATEST_APK;
}
