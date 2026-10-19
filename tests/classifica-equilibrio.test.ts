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
