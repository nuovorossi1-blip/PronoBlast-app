import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { paletti, logicaDi } from "../netlify/functions/lib/paletti";

// Napoli-Roma 24/10/2026, quote del file e della scheda Sisal lette il 21/10/2026 alle 11:13.
const napoliRoma: any = {
  odd_1: 2.75, odd_x: 3.25, odd_2: 2.5, odd_1x: 1.5, odd_x2: 1.4, odd_12: 1.3, odd_u15: 3.5, odd_o15: 1.25,
  odd_u25: 1.9, odd_o25: 1.8, odd_u35: 1.33, odd_o35: 3, odd_gg: 1.6, odd_ng: 2.2,
  quote_sisal: {
    at: "2026-10-21T09:13:34Z", codice: "36431-1001", mercati: 375, esatti_aggio: 1.308,
    quote: { "U0.5": 10, "O0.5": 1.02, "U4.5": 1.1, "O4.5": 5.5, "U5.5": 1.02, "O5.5": 10, "X OPPURE GG": 1.4, "MG 3-6 TOTALI": 1.9, "MG 2-4 TOTALI": 1.52, "GG + O2.5": 2.1, "GG + U2.5": 6 },
    esatti: { "0-0": 13, "1-0": 10, "0-1": 9, "1-1": 6.5, "2-0": 16, "0-2": 13, "2-1": 10, "1-2": 9, "2-2": 12, "3-0": 33, "3-1": 22, "1-3": 20, "3-2": 25, "2-3": 25, "0-3": 25 },
  },
};
const EQ = ["MG 3-6 totali", "GG + O2.5", "O2.5", "GG", "MG 2-4 totali", "U3.5", "1X", "X2", "X oppure GG"];

describe("paletti delle quote (21/10/2026)", () => {
  const p = paletti(napoliRoma, EQ);
  const mk = (c: string) => p.mercati.find((x) => x.codice === c)!;
  it("Equilibrio: GG in zona e allineato, Over 2,5 e MG 3-6 fuori zona ma allineati", () => {
    assert.equal(mk("GG").inZona, true); assert.equal(mk("GG").stato, "in_linea"); assert.equal(logicaDi(p, "GG"), true);
    assert.equal(mk("O2.5").inZona, false); assert.equal(mk("O2.5").stato, "in_linea");
    assert.equal(mk("MG 3-6 totali").inZona, false); assert.equal(mk("MG 3-6 totali").stato, "in_linea");
  });
  it("MG 2-4 allineato (coerente ~1,50), X o GG protetta (coerente ~1,49)", () => {
    assert.equal(mk("MG 2-4 totali").stato, "in_linea");
    assert.ok(Math.abs(mk("MG 2-4 totali").quotaCoerente! - 1.5) <= 0.03);
    assert.equal(mk("X oppure GG").stato, "protetta");
    assert.equal(logicaDi(p, "X oppure GG"), false);
    assert.ok(p.anomalie.some((a) => a.startsWith("X o GG 1,40")));
  });
  it("il pareggio e' protetto", () => assert.equal(mk("X").stato, "protetta"));
  it("0-0: Under 0,5 a 10 e risultato esatto a 13 -> segnalato", () => {
    assert.ok(p.incroci.some((s) => s.startsWith("0-0") && s.includes("risultato esatto")));
  });
  it("il 2-1 resta piu' probabile del 3-1, nessuna goleada protetta", () => {
    assert.ok(!p.anomalie.some((a) => a.includes("goleada")));
  });
  it("distribuzione dei gol dalla scala Sisal: cuore 2-3 gol, almeno 2 al 74%", () => {
    assert.equal(p.gol.fonte, "sisal");
    assert.ok(Math.abs(p.gol.almeno2 - 0.737) < 0.01);
    assert.equal(p.aggio.find((a) => a.nome === "Risultato esatto")?.pct, 30.8);
  });
  it("senza scheda Sisal i multigol sono stime: allineamento non verificabile", () => {
    const { quote_sisal: _q, ...soloFile } = napoliRoma;
    const s = paletti(soloFile, EQ);
    assert.equal(s.mercati.find((x) => x.codice === "MG 2-4 totali")!.stato, "non_verificabile");
    assert.equal(logicaDi(s, "MG 2-4 totali"), null);
    assert.equal(s.gol.fonte, "file");
  });
});
