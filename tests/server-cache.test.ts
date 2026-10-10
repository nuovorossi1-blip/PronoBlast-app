import { describe, it, beforeEach } from "node:test";
import * as assert from "node:assert/strict";
import {
  isRottaCacheabile,
  isScrittura,
  getServerCachedResponse,
  setServerCachedResponse,
  svuotaServerCache,
  controllaInvalidazioneScrittura,
  statoServerCache,
  CACHE_SERVER_TTL_MS,
} from "../netlify/functions/lib/serverCache";

describe("Cache breve server e invalidazione su scritture (Incarico Avvio Rapido)", () => {
  beforeEach(() => {
    svuotaServerCache("beforeEach test");
  });

  it("1. Solo le 5 rotte ammesse sono cacheabili in GET", () => {
    const ammesse = ["matches-days", "ml-stats", "tabella-scenari", "manuale-stats", "odd-settings"];
    for (const r of ammesse) {
      assert.strictEqual(isRottaCacheabile(r, "GET"), true, `Rotta ${r} deve essere cacheabile`);
    }

    const vietate = ["matches-list", "verdetto", "lettura", "match-detail", "matches", "random-route"];
    for (const r of vietate) {
      assert.strictEqual(isRottaCacheabile(r, "GET"), false, `Rotta ${r} NON deve essere cacheabile`);
    }

    // Anche le rotte ammesse NON sono cacheabili se il metodo e' POST o PUT
    assert.strictEqual(isRottaCacheabile("odd-settings", "POST"), false);
    assert.strictEqual(isRottaCacheabile("ml-stats", "POST"), false);
  });

  it("2. Memorizzazione in cache e risposta HIT per rotte ammesse", async () => {
    const req = new Request("http://localhost/api/matches-days", { method: "GET" });
    const resOriginale = new Response(JSON.stringify({ days: ["2026-10-10"] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    // All'inizio la cache e' vuota
    assert.strictEqual(getServerCachedResponse("matches-days", req), null);

    // Salvataggio
    await setServerCachedResponse("matches-days", req, resOriginale);
    assert.strictEqual(statoServerCache().dim, 1);
    assert.deepStrictEqual(statoServerCache().chiavi, ["matches-days"]);

    // Successiva chiamata deve essere HIT con header x-server-cache
    const hit = getServerCachedResponse("matches-days", req);
    assert.notStrictEqual(hit, null);
    assert.strictEqual(hit?.headers.get("x-server-cache"), "HIT");
    const json = await hit?.json();
    assert.deepStrictEqual(json, { days: ["2026-10-10"] });
  });

  it("3. Le rotte non ammesse non vengono mai salvate in cache", async () => {
    const req = new Request("http://localhost/api/matches-list?day=2026-10-10", { method: "GET" });
    const res = new Response(JSON.stringify([{ match_id: "1" }]), { status: 200 });

    await setServerCachedResponse("matches-list", req, res);
    assert.strictEqual(statoServerCache().dim, 0);
    assert.strictEqual(getServerCachedResponse("matches-list", req), null);
  });

  it("4. Rilevamento delle operazioni di scrittura", () => {
    const scritture = [
      "upload-excel",
      "quote-pc",
      "sync-results",
      "results-manual",
      "results-auto",
      "selection-save",
      "selection-delete",
      "save-verdict",
      "rebuild-learning",
      "ricalcolo",
      "match-result",
      "delete-all",
      "import-db",
      "stats-reset",
    ];

    for (const s of scritture) {
      assert.strictEqual(isScrittura(s, "POST"), true, `${s} [POST] deve essere considerata scrittura`);
      assert.strictEqual(isScrittura(s, "GET"), true, `${s} [GET] deve essere comunque considerata scrittura`);
    }

    // Metodi POST generici
    assert.strictEqual(isScrittura("odd-settings", "POST"), true);
    assert.strictEqual(isScrittura("qualsiasi-cosa", "POST"), true);
    assert.strictEqual(isScrittura("qualsiasi-cosa", "DELETE"), true);

    // Letture pure
    assert.strictEqual(isScrittura("matches-days", "GET"), false);
    assert.strictEqual(isScrittura("ml-stats", "GET"), false);
  });

  it("5. Qualunque scrittura svuota immediatamente la cache server", async () => {
    // Popoliamo la cache con matches-days e ml-stats
    const reqDays = new Request("http://localhost/api/matches-days", { method: "GET" });
    const resDays = new Response(JSON.stringify({ days: ["2026-10-10"] }), { status: 200 });
    await setServerCachedResponse("matches-days", reqDays, resDays);

    const reqStats = new Request("http://localhost/api/ml-stats", { method: "GET" });
    const resStats = new Response(JSON.stringify({ accuracy: 0.75 }), { status: 200 });
    await setServerCachedResponse("ml-stats", reqStats, resStats);

    assert.strictEqual(statoServerCache().dim, 2);

    // Scrittura 1: quote-pc
    const invalidato1 = controllaInvalidazioneScrittura("quote-pc", "POST");
    assert.strictEqual(invalidato1, true);
    assert.strictEqual(statoServerCache().dim, 0, "Cache deve essere vuota dopo quote-pc");

    // Ripopoliamo
    await setServerCachedResponse("matches-days", reqDays, resDays);
    assert.strictEqual(statoServerCache().dim, 1);

    // Scrittura 2: sync-results
    controllaInvalidazioneScrittura("sync-results", "POST");
    assert.strictEqual(statoServerCache().dim, 0, "Cache deve essere vuota dopo sync-results");

    // Ripopoliamo
    await setServerCachedResponse("matches-days", reqDays, resDays);
    assert.strictEqual(statoServerCache().dim, 1);

    // Scrittura 3: save-verdict
    controllaInvalidazioneScrittura("save-verdict", "POST");
    assert.strictEqual(statoServerCache().dim, 0, "Cache deve essere vuota dopo save-verdict");

    // Ripopoliamo
    await setServerCachedResponse("matches-days", reqDays, resDays);
    assert.strictEqual(statoServerCache().dim, 1);

    // Scrittura 4: upload-excel
    controllaInvalidazioneScrittura("upload-excel", "POST");
    assert.strictEqual(statoServerCache().dim, 0, "Cache deve essere vuota dopo upload-excel");

    // Ripopoliamo
    await setServerCachedResponse("matches-days", reqDays, resDays);
    assert.strictEqual(statoServerCache().dim, 1);

    // Scrittura 5: odd-settings [POST]
    controllaInvalidazioneScrittura("odd-settings", "POST");
    assert.strictEqual(statoServerCache().dim, 0, "Cache deve essere vuota dopo odd-settings POST");

    // Ripopoliamo
    await setServerCachedResponse("matches-days", reqDays, resDays);
    assert.strictEqual(statoServerCache().dim, 1);

    // Scrittura 6: ricalcolo
    controllaInvalidazioneScrittura("ricalcolo", "POST");
    assert.strictEqual(statoServerCache().dim, 0, "Cache deve essere vuota dopo ricalcolo");
  });

  it("6. Scadenza naturale TTL (60 secondi)", async () => {
    assert.strictEqual(CACHE_SERVER_TTL_MS, 60_000);
  });
});
