import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { mappaScheda } from "../netlify/functions/lib/quoteSisal";
import { comboOdd, quoteCatalogo, quotaXoppureGG } from "../netlify/functions/lib/clusterEngine";

// Mercati della scheda Sisal di Napoli-Roma letta il 21/10/2026 (estratto).
const mercati: any[] = [
  { cs: 3, nome: "1X2 ESITO FINALE", desc: "ESITO FINALE 1X2", soglia: "", esiti: [["1", 2.75], ["X", 3.25], ["2", 2.5]] },
  { cs: 7989, nome: "UNDER/OVER", desc: "U/O 4.5", soglia: "4.5", esiti: [["UNDER", 1.1], ["OVER", 5.5]] },
  { cs: 12192, nome: "COMBO: 1X2 + U/O", desc: "1X2 + U/O 4.5", soglia: "4.5", esiti: [["1 + U", 3.25], ["X + U", 3.4], ["2 + U", 2.9]] },
  { cs: 99989, nome: "COMBO: DC + U/O", desc: "DC + U/O 1.5", soglia: "1.5", esiti: [["1X + OVER", 1.85], ["X2 + OVER", 1.7]] },
  { cs: 12562, nome: "COMBO: GOAL/NOGOAL + U/O", desc: "U/O 2.5 + GG/NG", soglia: "2.5", esiti: [["GOAL + OVER", 2.1]] },
  { cs: 30562, nome: "MULTIGOAL", desc: "MULTIGOAL MULTIESITI 16 ESITI", soglia: "", esiti: [["2-4", 1.52], ["3-6", 1.9]] },
  { cs: 30362, nome: "MULTIGOAL SQUADRA X", desc: "MULTIGOAL SQUADRA 1 MULTIESITI", soglia: "", esiti: [["1-3", 1.33], ["2-4", 2.5]] },
  { cs: 30362, nome: "MULTIGOAL SQUADRA X", desc: "MULTIGOAL SQUADRA 2 MULTIESITI", soglia: "", esiti: [["1-3", 1.3], ["2-4", 2.25]] },
  { cs: 30394, nome: "MULTIGOAL CASA + MULTIGOAL OSPITE", desc: "MULTIESITI 91 ESITI", soglia: "", esiti: [["1-3/0-2 ", 1.95]] },
  { cs: 9493, nome: "COMBO CHANCE: X O GOAL", desc: "ESITO FINALE X O GOAL", soglia: "", esiti: [["X O GOAL", 1.4]] },
  { cs: 7, nome: "RISULTATO ESATTO 26 ESITI", desc: "RISULTATO ESATTO 26 ESITI", soglia: "", esiti: [["1-0", 10], ["1-1", 6.5], ["ALTRO", 33]] },
];

describe("quote della scheda Sisal (21/10/2026)", () => {
  const { quote, esatti } = mappaScheda(mercati);
  it("traduce i mercati nei nomi del catalogo", () => {
    assert.equal(quote["MG 2-4 TOTALI"], 1.52);
    assert.equal(quote["MG 1-3 CASA"], 1.33);
    assert.equal(quote["MG 2-4 OSPITE"], 2.25);
    assert.equal(quote["MG 1-3 CASA + MG 0-2 OSPITE"], 1.95);
    assert.equal(quote["1 + U4.5"], 3.25);
    assert.equal(quote["U4.5"], 1.1);
    assert.equal(quote["1X + O1.5"], 1.85);
    assert.equal(quote["GG + O2.5"], 2.1);
    assert.equal(quote["X OPPURE GG"], 1.4);
    assert.deepEqual(esatti, { "1-0": 10, "1-1": 6.5 });
  });
  it("il motore usa la quota Sisal al posto della stima", () => {
    const odds: any = { odd_1: 2.75, odd_X: 3.25, odd_2: 2.5, odd_1X: 1.5, odd_X2: 1.4, odd_12: 1.3, odd_U15: 3.5, odd_O15: 1.25, odd_U25: 1.9, odd_O25: 1.8, odd_U35: 1.33, odd_O35: 3, odd_GG: 1.6, odd_NG: 2.2 };
    const prima = quoteCatalogo(odds);
    assert.equal(prima["MG 2-4 totali"].estimated, true);
    const dopo = quoteCatalogo({ ...odds, sisal: quote });
    assert.deepEqual(dopo["MG 2-4 totali"], { odd: 1.52, estimated: false });
    assert.deepEqual(dopo["DC 1X + O1.5"], { odd: 1.85, estimated: false });
    assert.equal(comboOdd("1 + U4.5", { ...odds, sisal: quote }), 3.25);
    assert.equal(quotaXoppureGG({ ...odds, sisal: quote }), 1.4);
    assert.equal(quotaXoppureGG(odds), 1.44);
  });
});
