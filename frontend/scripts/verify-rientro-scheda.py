"""
Verifica B4: rientro nella scheda partita con Playwright Edge (viewport mobile 390x844).
Server di prova su porta separata (3100, NON porta 3000).
Misura: rientro < 0.5 s e zero rotellina (nessun ActivityIndicator durante il rientro).
"""
import asyncio
import json
import subprocess
import sys
import time
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright

MATCH_ID = "0765ad72-ee0f-4cb5-8520-862b757b5e44"
PORT = 3100
BASE = f"http://127.0.0.1:{PORT}"

MATCH = {
    "id": MATCH_ID,
    "squadra1": "FIORENTINA",
    "squadra2": "MILAN",
    "manifestazione": "SERIE A",
    "day": "2026-10-10",
    "time": "20:45",
    "odds": {
        "odd_1": 2.80, "odd_x": 3.25, "odd_2": 2.50,
        "odd_1x": 1.50, "odd_x2": 1.42, "odd_12": 1.33,
        "odd_u25": 1.85, "odd_o25": 1.95,
        "odd_u35": 1.30, "odd_o35": 3.20,
        "odd_gg": 1.70, "odd_ng": 2.05,
    },
    "result": None,
    "prediction": None,
    "selected": False,
}

SAVED_CONSIGLIATO = {
    "market": "X2",
    "nome": "X2",
    "quota": 1.42,
    "stimata": False,
    "daLasciare": None,
    "ai": "confermato",
    "notizia": None,
    "pA": 0.65,
    "pB": 0.62,
    "n": 120,
    "avvisi": [],
}

READING = {
    "programma": {
        "frasi": ["Partita equilibrata"],
        "accordo": True,
        "motivi": [],
        "forma_casa": 1.2,
        "forma_ospite": 1.4,
        "pesata_casa": {"fatti": 1.3, "subiti": 1.1},
        "pesata_ospite": {"fatti": 1.5, "subiti": 1.0},
        "assenti_casa": 0,
        "assenti_ospite": 0,
    },
    "ai": {
        "lettura": "Lettura AI pronta",
        "modello": "DeepSeek",
        "gol_casa": "1.2",
        "gol_ospite": "1.4",
        "gol_totali": "2.6",
        "risultati_probabili": ["1-1", "1-2"],
    },
    "dossier": True,
    "ai_vecchia": False,
    "consigliato": SAVED_CONSIGLIATO,
}

TABELLA = {
    "scenari": {
        "1.40": [{"market": "X2", "p": 0.65, "pA": 0.65, "pB": 0.62, "nA": 60, "nB": 60}],
    }
}


async def run_test():
    server_proc = subprocess.Popen(
        ["node", "scripts/serve-test-build.cjs", "dist", str(PORT)],
        cwd="frontend",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    time.sleep(1.2)

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel="msedge", headless=True)
            context = await browser.new_context(
                viewport={"width": 390, "height": 844},
                is_mobile=True,
                has_touch=True,
                service_workers="block",
            )

            api_calls = []

            async def route_api(route):
                request = route.request
                if request.resource_type not in ("fetch", "xhr"):
                    await route.continue_()
                    return
                path = urlparse(request.url).path
                query = parse_qs(urlparse(request.url).query)
                print(f"[REQ] {path} {query}")
                api_calls.append(path)
                resp = {}
                delay = 0.05
                if path == "/match-detail":
                    resp, delay = MATCH, 0.08
                elif path == "/odd-settings":
                    resp = {"min_odd": 1.40, "options": [1.40, 1.50, 1.60, 1.75]}
                elif path == "/lettura":
                    resp, delay = READING, 0.15
                elif path == "/tabella-scenari":
                    resp, delay = TABELLA, 0.10
                elif path == "/forma-gol":
                    resp = {"forma": None}
                elif path == "/predict":
                    resp, delay = {
                        "structure": {
                            "family": "RANGE_CONTROLLATO",
                            "dominance": "equilibrium",
                            "offensive_profile": "moderate",
                            "goal_compression": "medium",
                            "goal_floor": 2,
                            "goal_range": "2-4",
                            "goal_ceiling": 4,
                            "goal_ceiling_open": False,
                            "lambda_home": 1.35,
                            "lambda_away": 1.25,
                        },
                        "ranking": [{"market": "X2", "coverage": 0.65}],
                        "pre_ranking": [{"market": "X2", "odd": 1.42}],
                        "market_odds": {"X2": {"odd": 1.42, "estimated": False}},
                    }, 0.05
                elif path == "/match-structural":
                    resp = {"structure": {"lambda_home": 1.2, "lambda_away": 1.4}, "ranking": []}
                elif path == "/match-history":
                    resp = None
                elif path == "/ml-stats":
                    resp = {"markets": []}
                elif path == "/selected-list":
                    resp = []
                elif path == "/matches-days":
                    resp = ["2026-10-10"]
                elif path == "/matches-list":
                    resp = [MATCH]

                await asyncio.sleep(delay)
                await route.fulfill(status=200, content_type="application/json", body=json.dumps(resp))

            await context.route("**/*", route_api)
            page = await context.new_page()
            page.on("console", lambda msg: print(f"[CONSOLE] {msg.text}"))
            page.on("pageerror", lambda err: print(f"[PAGEERROR] {err}\nSTACK: {getattr(err, 'stack', '')}"))

            print("1. Primo caricamento scheda partita...")
            t0 = time.monotonic()
            await page.goto(f"{BASE}/match/{MATCH_ID}", wait_until="domcontentloaded")
            await page.get_by_text("FIORENTINA", exact=True).first.wait_for(state="visible", timeout=10000)
            await page.get_by_text("IL CONSIGLIATO", exact=True).first.wait_for(state="visible", timeout=10000)
            tempo_primo = time.monotonic() - t0
            print(f"   Primo caricamento completato in {tempo_primo:.3f} s.")

            # Attendi che il bundle e la lettura si salvino nella cache locale
            await page.wait_for_timeout(1000)

            print("2. Uscita dalla scheda (ritorno a home / pagina precedente)...")
            # Tasto indietro
            back_btn = page.get_by_test_id("back-btn")
            if await back_btn.count() > 0:
                await back_btn.click()
            else:
                await page.goto(f"{BASE}/", wait_until="domcontentloaded")
            await page.wait_for_timeout(500)

            print("3. RIENTRO NELLA SCHEDA (misurazione tempo e rotellina)...")
            spinners_detected = []

            # Monitora se compare un elemento rotellina/ActivityIndicator
            async def monitor_spinner():
                for _ in range(50):
                    spinners = await page.locator('[role="progressbar"], [aria-label="loading"], .activity-indicator').count()
                    if spinners > 0:
                        spinners_detected.append(spinners)
                    await asyncio.sleep(0.01)

            t_rientro_start = time.monotonic()
            # Naviga di nuovo al match
            nav_task = asyncio.create_task(page.goto(f"{BASE}/match/{MATCH_ID}", wait_until="domcontentloaded"))
            mon_task = asyncio.create_task(monitor_spinner())

            # Attendi subito la comparsa delle squadre e del box Consigliato
            await page.get_by_text("FIORENTINA", exact=True).first.wait_for(state="visible", timeout=5000)
            await page.get_by_text("IL CONSIGLIATO", exact=True).first.wait_for(state="visible", timeout=5000)
            t_rientro = time.monotonic() - t_rientro_start

            await nav_task
            await mon_task

            # Verifica anche il contenuto del consigliato
            cons_val = await page.get_by_text("X2", exact=True).first.is_visible()

            print(f"\nRISULTATI MISURAZIONE:")
            print(f"  • Tempo di rientro nella scheda: {t_rientro:.3f} s (soglia richiesta: < 0.500 s)")
            print(f"  • Rotelline/spinner rilevati durante il rientro: {len(spinners_detected)}")
            print(f"  • Box 'IL CONSIGLIATO' visibile con valore corretto: {cons_val}")

            assert t_rientro < 0.500, f"Rientro troppo lento: {t_rientro:.3f} s >= 0.500 s"
            assert len(spinners_detected) == 0, f"Rilevata rotellina durante il rientro: {spinners_detected}"
            assert cons_val, "Consigliato non visibile al rientro"

            print("\nESITO B4: PASS (rientro istantaneo < 0.5 s e zero rotellina).")
            await context.close()
            await browser.close()
    finally:
        server_proc.terminate()
        server_proc.wait()


if __name__ == "__main__":
    asyncio.run(run_test())
