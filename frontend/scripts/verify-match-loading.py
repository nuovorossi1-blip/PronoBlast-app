"""Browser regression: a slow history must not hide the match.

Uses Edge's local CDP session and mocks every API; no AI calls or database writes.
Run with --baseline to measure the old bundle, without asserting the new behavior.
"""
import asyncio
import json
import sys
import time
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright


MATCH_ID = "0765ad72-ee0f-4cb5-8520-862b757b5e44"
MATCH = {
    "id": MATCH_ID, "squadra1": "TEST CASA", "squadra2": "TEST OSPITE",
    "manifestazione": "TEST", "day": "2099-10-08", "time": "18:00",
    "odds": {}, "result": None, "prediction": None, "selected": False,
}
READING = {"programma": None, "ai": {"lettura": "Gia salvata"},
           "dossier": True, "ai_vecchia": False, "consigliato": None}


async def verify(browser, refresh):
    context = await browser.new_context(ignore_https_errors=True, service_workers="block")
    requests = []
    errors = []
    reading_finished = None
    start = time.monotonic()

    async def api_route(route):
        nonlocal reading_finished
        request = route.request
        path = urlparse(request.url).path
        query = parse_qs(urlparse(request.url).query)
        # Static resources only; all fetches are intercepted to avoid side effects.
        if request.resource_type not in ("fetch", "xhr"):
            await route.continue_()
            return
        requests.append((path, query, time.monotonic() - start))
        response = {}
        delay = 0
        if path == "/match-detail":
            response, delay = MATCH, 0.05
        elif path == "/odd-settings":
            response = {"min_odd": 1.4, "options": [1.4, 1.5, 1.6, 1.75]}
        elif path == "/match-history":
            response, delay = None, 2.5
        elif path == "/predict":
            response, delay = None, 0.4
        elif path == "/ml-stats":
            response, delay = {"markets": []}, 1.5
        elif path == "/selected-list":
            response = []
        elif path == "/forma-gol":
            response, delay = {"forma": None}, 2
        elif path == "/lettura":
            response, delay = {**READING, "ai": None if refresh else READING["ai"]}, 0.25
        await asyncio.sleep(delay)
        await route.fulfill(status=200, content_type="application/json", body=json.dumps(response))
        if path == "/lettura" and "auto" not in query:
            reading_finished = time.monotonic() - start

    await context.route("**/*", api_route)
    page = await context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    try:
        await page.goto(f"http://127.0.0.1:3000/match/{MATCH_ID}", wait_until="domcontentloaded")
        await page.get_by_text("TEST CASA", exact=True).first.wait_for(state="visible", timeout=15000)
        visible_after = time.monotonic() - start
        await page.wait_for_timeout(3000)
        readings = [(query, elapsed) for path, query, elapsed in requests if path == "/lettura"]
        autos = [elapsed for query, elapsed in readings if "auto" in query]
        output = {"refresh_needed": refresh, "visible_seconds": round(visible_after, 3),
                  "lettura_calls": len(readings), "auto_calls": len(autos), "errors": errors}
        print(json.dumps(output))
        if "--baseline" not in sys.argv:
            assert visible_after < 2.0, "Match still waits for the 2.5s history"
            assert not errors, errors
            assert len(readings) == (2 if refresh else 1), readings
            assert len(autos) == (1 if refresh else 0), autos
            if autos:
                assert reading_finished is not None and autos[0] >= reading_finished, "Concurrent readings"
    finally:
        await context.close()


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp("http://127.0.0.1:9222")
        await verify(browser, refresh=False)
        await verify(browser, refresh=True)
        await browser.close()


asyncio.run(main())
