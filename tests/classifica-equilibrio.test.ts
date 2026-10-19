import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { classificaEquilibrio, evaluateMarketOutcome } from "../frontend/src/api";

// Malaga-Real Sociedad 18/10/2026: ospite avanti, Over 3,5 a 2,50.
const malaga: any = { odd_1: 3.1, odd_X: 3.4, odd_2: 2.2, odd_1X: 1.67, odd_X2: 1.33, odd_GG: 1.52, odd_O25: 1.6, odd_O35: 2.5 };

describe("classifica dell'Equilibrio", () => {
  it("Malaga-Real Sociedad: X2 prima ma pagata poco, si sceglie Over 2,5", () => {
    const c = classificaEquilibrio(malaga)!;
    assert.equal(c.fascia, "2,30-2,59");
    assert.equal(c.direzione, "ospite");
    assert.deepEqual(c.voci.map((v) => v.mercato), ["X2", "X oppure GG", "Over 2,5", "GG", "1X"]);
    assert.equal(c.voci[0].pagata, false);
    assert.equal(c.voci[1].pagata, null);
    assert.equal(c.scelta, "Over 2,5");
  });
  it("fuori dal ramo (favorita sotto 2,00 o GG alto) non c'e' classifica", () => {
    assert.equal(classificaEquilibrio({ ...malaga, odd_2: 1.9 }), null);
    assert.equal(classificaEquilibrio({ ...malaga, odd_GG: 1.85 }), null);
    assert.equal(classificaEquilibrio({ ...malaga, odd_O35: undefined }), null);
  });
  it("Over 3,5 da 3,00: GG e Over da evitare, 1X in testa", () => {
    const c = classificaEquilibrio({ ...malaga, odd_O35: 3.2, odd_1X: 1.45 })!;
    assert.equal(c.voci[0].mercato, "1X");
    assert.ok(c.voci.find((v) => v.mercato === "GG")!.daEvitare);
    assert.equal(c.scelta, "1X");
  });
  it("tutti i mercati della classifica sono valutabili sul risultato", () => {
    for (const m of ["GG", "Over 2,5", "1X", "X2", "X oppure GG"]) {
      assert.equal(typeof evaluateMarketOutcome(m, "2-5"), "boolean", m);
    }
    assert.equal(evaluateMarketOutcome("X oppure GG", "1-0"), false);
    assert.equal(evaluateMarketOutcome("X oppure GG", "0-0"), true);
  });
});

import { decidi } from "../netlify/functions/lib/regolePronostico";

const riga = { squadra1: "Malaga", squadra2: "Real Sociedad", manifestazione: "SPA1", odd_1: 3.1, odd_x: 3.4, odd_2: 2.2, odd_1x: 1.67, odd_x2: 1.33, odd_12: 1.28, odd_o15: 1.18, odd_u15: 4, odd_o25: 1.6, odd_u25: 2.2, odd_o35: 2.5, odd_u35: 1.45, odd_gg: 1.52, odd_ng: 2.4 };

describe("Pronostico prima del via: la classifica non decide piu' (19/10/2026, la piu' facile)", () => {
  it("Malaga-Real Sociedad: niente riga della classifica, sceglie fra le fasce", () => {
    const d = decidi(riga, { ai: { direzione: "2", risultati_probabili: ["1-2", "0-2", "1-1"] } });
    assert.ok(d.scelta);
    assert.ok(!d.ragioni.some((r) => /classifica dello scenario/i.test(r.t)));
  });
});

import { classificaGap } from "../frontend/src/api";

// Tromso-KFUM Oslo 18/10/2026: Gap vero, favorita 1,42, Over 3,5 a 2,50.
const tromso: any = { odd_1: 1.42, odd_X: 4.5, odd_2: 6.5, odd_1X: 1.09, odd_X2: 2.75, odd_GG: 1.75, odd_O25: 1.6, odd_O35: 2.5 };

describe("classifica del Gap Tecnico", () => {
  it("Tromso: fascia da 2,30 con favorita 1,40-1,59, MG casa 1-3 in testa", () => {
    const c = classificaGap(tromso, { "MG 1-3 casa": { odd: 1.31 }, "MG 2-4 casa": { odd: 1.68 }, "DC 1X + GG": { odd: 2.11 } })!;
    assert.equal(c.fascia, "da 2,30");
    assert.equal(c.fasciaFavorita, "1,40-1,59");
    assert.equal(c.voci[0].mercato, "MG casa 1-3");
    assert.equal(c.voci[0].pagata, false);          // stimata 1,31, ne serve 1,37
    assert.equal(c.voci[1].mercato, "1 fisso");    // 65% -> serve 1,54, pagato 1,42: no
    assert.equal(c.scelta, null);                  // Over 57% serve 1,76 (qui 1,60): si lascia (fini' 1-1)
  });
  it("Gap falso e Progressione: niente classifica Gap", () => {
    assert.equal(classificaGap({ ...tromso, odd_2: 3.5 }), null);
    assert.equal(classificaGap({ ...tromso, odd_X: 3.8 }), null);
  });
  it("tutti i codici del Gap sono valutabili sul risultato", () => {
    for (const m of ["1", "2", "DC 1X + GG", "DC X2 + GG", "MG 2-4 casa", "MG 1-3 ospite", "O2.5", "GG"]) {
      assert.equal(typeof evaluateMarketOutcome(m, "2-1"), "boolean", m);
    }
  });
});

import { mgStrettaFavorita } from "../netlify/functions/lib/letturaPartita";

describe("alzata e goleada (19/10/2026)", () => {
  it("Multigol stretta della favorita riconosciuta nei due modi di scriverla", () => {
    assert.equal(mgStrettaFavorita("MG 1-3 casa", "1"), true);
    assert.equal(mgStrettaFavorita("MG casa 2-4", "1"), true);
    assert.equal(mgStrettaFavorita("MG 2-5 casa", "1"), false);
    assert.equal(mgStrettaFavorita("MG 1-3 ospite", "1"), false);
    assert.equal(mgStrettaFavorita("MG 2-4 totali", "1"), false);
  });
});
