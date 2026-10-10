"""
Verifica Avvio PronoBlast con Playwright Edge (mobile 412x900, profilo persistente come l'APK).
Rete simulata 4G via CDP: latenza 150 ms, download 1.6 Mbps, upload 750 kbps.
Misura:
  - Tempo a cui compaiono le card delle partite (obiettivo < 0.5 s da cache)
  - Tempo a cui i dati aggiornati sono arrivati dal server (obiettivo ~1 s)
  - Presenza/durata di rotellina di caricamento (ActivityIndicator)
"""
import asyncio
import os
import shutil
import subprocess
import sys
import time
from urllib.parse import urlparse
from playwright.async_api import async_playwright

PORT = 3100
BASE = f"http://127.0.0.1:{PORT}"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
ROOT_DIR = os.path.abspath(os.path.join(FRONTEND_DIR, ".."))
SERVER_DIR = os.path.join(ROOT_DIR, "server-locale")
PROFILE_DIR = os.path.join(SCRIPT_DIR, ".test-profile-edge")

# 4G parameters (CDP Network.emulateNetworkConditions)
LATENCY_MS = 150
DOWNLOAD_BPS = int(1.6 * 1024 * 1024 / 8)  # 1.6 Mbps -> 209715 B/s
UPLOAD_BPS = int(750 * 1024 / 8)           # 750 kbps -> 96000 B/s


async def wait_server_ready(max_retries=30):
    import urllib.request
    for _ in range(max_retries):
        try:
            with urllib.request.urlopen(f"{BASE}/", timeout=1) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            await asyncio.sleep(0.5)
    return False


async def run_measurement():
    # Pulisce eventuale profilo di test precedente per partire da situazione nota
    if os.path.exists(PROFILE_DIR):
        try:
            shutil.rmtree(PROFILE_DIR)
        except Exception:
            pass

    env = os.environ.copy()
    env["PORTA"] = str(PORT)

    # Avvia server di prova (porta 3100) usando --env-file senza leggerlo
    # Cerca il file .env in server-locale o nel repository principale
    env_file_arg = "--env-file=.env"
    if not os.path.exists(os.path.join(SERVER_DIR, ".env")):
        env_file_arg = "--env-file=..\\PronoBlast-app\\server-locale\\.env"

    server_log_path = os.path.join(SERVER_DIR, "server-test.log")
    server_log_file = open(server_log_path, "w", encoding="utf-8")

    server_cmd = ["npx", "tsx", env_file_arg, "server.ts"]
    print(f"Avvio server di prova su porta {PORT}...")
    server_proc = subprocess.Popen(
        server_cmd,
        cwd=SERVER_DIR,
        env=env,
        shell=True,
        stdout=server_log_file,
        stderr=subprocess.STDOUT,
    )

    ready = await wait_server_ready()
    if not ready:
        server_proc.terminate()
        server_log_file.close()
        print("ERRORE: Server di prova non risponde su porta", PORT)
        sys.exit(1)

    print(f"Server pronto su {BASE}.")

    try:
        async with async_playwright() as p:
            # -------------------------------------------------------------
            # FASE 1: PRIMA APERTURA (Warming profilo persistente)
            # -------------------------------------------------------------
            print("\n[FASE 1] Prima apertura: popolazione profilo persistente (come prima installazione)...")
            context = await p.chromium.launch_persistent_context(
                PROFILE_DIR,
                channel="msedge",
                headless=True,
                viewport={"width": 412, "height": 900},
                is_mobile=True,
                has_touch=True,
            )
            page = context.pages[0] if context.pages else await context.new_page()

            # CDP 4G emulation
            cdp = await context.new_cdp_session(page)
            await cdp.send("Network.emulateNetworkConditions", {
                "offline": False,
                "latency": LATENCY_MS,
                "downloadThroughput": DOWNLOAD_BPS,
                "uploadThroughput": UPLOAD_BPS,
            })

            t_init0 = time.monotonic()
            await page.goto(f"{BASE}/", wait_until="domcontentloaded")
            # Attende comparsa card
            await page.locator('[data-testid^="match-"]').first.wait_for(state="visible", timeout=20000)
            t_init_card = time.monotonic() - t_init0
            print(f"   Prima apertura completata: card visibili dopo {t_init_card:.3f} s.")

            # Attendi che le richieste in sottofondo (verdetti, salvataggi) si stabilizzino
            await page.wait_for_timeout(6000)
            keys1 = await page.evaluate("() => Object.keys(localStorage)")
            print(f"   LocalStorage al termine della fase 1 ({len(keys1)} chiavi): {keys1[:8]}")

            # Chiudi del tutto l'app/browser
            await context.close()
            print("   App chiusa completamente (profilo persistente salvato).")

            # -------------------------------------------------------------
            # FASE 2: RIAPERTURA APP (Misurazione reale: app chiusa e riaperta)
            # -------------------------------------------------------------
            print("\n[FASE 2] Riapertura app chiusa del tutto con profilo persistente + rete 4G...")
            context2 = await p.chromium.launch_persistent_context(
                PROFILE_DIR,
                channel="msedge",
                headless=True,
                viewport={"width": 412, "height": 900},
                is_mobile=True,
                has_touch=True,
            )
            page2 = context2.pages[0] if context2.pages else await context2.new_page()

            cdp2 = await context2.new_cdp_session(page2)
            await cdp2.send("Network.emulateNetworkConditions", {
                "offline": False,
                "latency": LATENCY_MS,
                "downloadThroughput": DOWNLOAD_BPS,
                "uploadThroughput": UPLOAD_BPS,
            })

            requests_log = []
            responses_log = []

            def on_request(req):
                path = urlparse(req.url).path
                t = time.monotonic() - t_reopen0 if 't_reopen0' in globals() else 0
                requests_log.append((t, path))

            def on_response(resp):
                path = urlparse(resp.url).path
                t = time.monotonic() - t_reopen0 if 't_reopen0' in globals() else 0
                responses_log.append((t, path, resp.status))
                if path.endswith(".js"):
                    from_disk = resp.from_service_worker
                    print(f"   [JS LOADED] {t:.3f} s -> {path.split('/')[-1]} (status: {resp.status})")

            page2.on("request", on_request)
            page2.on("response", on_response)
            page2.on("console", lambda msg: print(f"   [CONSOLE {time.monotonic() - t_reopen0 if 't_reopen0' in globals() else 0:.3f}s] {msg.text}"))

            spinners_detected = []
            monitoring_active = True

            async def spinner_monitor():
                while monitoring_active:
                    try:
                        # Cerca ActivityIndicator (progress bar di RN web o spinner)
                        c = await page2.locator('[role="progressbar"], [aria-label="loading"], .activity-indicator').count()
                        if c > 0:
                            spinners_detected.append(time.monotonic() - t_reopen0)
                    except Exception:
                        pass
                    await asyncio.sleep(0.02)

            global t_reopen0
            t_reopen0 = time.monotonic()
            mon_task = asyncio.create_task(spinner_monitor())

            # Navigazione
            await page2.goto(f"{BASE}/", wait_until="domcontentloaded")
            t_dcl = time.monotonic() - t_reopen0
            print(f"   [TIMING] DOMContentLoaded a {t_dcl:.3f} s")

            # Misura 1: Comparsa prima card
            t_wait_start = time.monotonic() - t_reopen0
            card_locator = page2.locator('[data-testid^="match-"]').first
            await card_locator.wait_for(state="visible", timeout=15000)
            t_card_visible = time.monotonic() - t_reopen0
            print(f"   [TIMING] Card wait_for terminato a {t_card_visible:.3f} s (wait durato {t_card_visible - t_wait_start:.3f} s)")

            # Misura 2: Arrivo risposta matches-list aggiornata
            t_updated_data = None
            for _ in range(200):
                for (t_resp, path, status) in responses_log:
                    if "/matches-list" in path and status == 200:
                        t_updated_data = t_resp
                        break
                if t_updated_data is not None:
                    break
                await asyncio.sleep(0.05)

            # Ulteriore attesa di stabilizzazione (1s)
            await page2.wait_for_timeout(1000)
            monitoring_active = False
            await mon_task

            # Riepilogo
            print("\n" + "=" * 60)
            print("ESITO MISURAZIONE AVVIO (Playwright Edge mobile 412x900 - 4G):")
            print("=" * 60)
            print(f"  • DOMContentLoaded: {t_dcl:.3f} s")
            print(f"  • Tempo comparsa prima card: {t_card_visible:.3f} s (obiettivo: < 0.500 s)")
            if t_updated_data is not None:
                print(f"  • Tempo dati aggiornati (/matches-list): {t_updated_data:.3f} s (obiettivo: ~1.0 s)")
            else:
                print(f"  • Tempo dati aggiornati (/matches-list): non rilevato entro il timeout")
            print(f"  • Rilevamenti rotellina/spinner a schermo: {len(spinners_detected)}")

            print("\nRichieste API registrate all'avvio:")
            for (t_req, path) in requests_log:
                if any(x in path for x in ["/matches-", "/ml-stats", "/verdetto", "/selected-list", "/odd-settings"]):
                    print(f"   + {t_req:.3f} s -> {path}")

            print("\nRisposte API registrate:")
            for (t_res, path, st) in responses_log:
                if any(x in path for x in ["/matches-", "/ml-stats", "/verdetto", "/selected-list", "/odd-settings"]):
                    print(f"   <- {t_res:.3f} s [{st}] <- {path}")

            await context2.close()
    finally:
        server_proc.terminate()
        server_proc.wait()
        try:
            server_log_file.close()
        except Exception:
            pass


if __name__ == "__main__":
    asyncio.run(run_measurement())
