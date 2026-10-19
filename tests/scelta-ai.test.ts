import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { controllaScelta, giocataValida, type OpzioneGiocabile } from "../netlify/functions/lib/sceltaAI";

// Lorient-Monaco 18/10/2026: l'AI dice "vince il Monaco" (0-2, 1-2, 1-3) e sceglie X o GG, che perde lo 0-2.
const opzioni: OpzioneGiocabile[] = [
  { codice: "X oppure GG", nome: "X oppure GG", quota: 1.55, stimata: true },
  { codice: "MG 1-3 casa", nome: "MG 1-3 Lorient", quota: 1.45, stimata: true, soloIncertezza: true },
  { codice: "MG 1-3 totali", nome: "MG 1-3 totali", quota: 1.43, stimata: true, soloIncertezza: true },
  { codice: "MG 2-4 totali", nome: "MG 2-4 totali", quota: 1.54, stimata: true },
];

describe("controllo della scelta dell'AI (19/10/2026)", () => {
  it("Lorient-Monaco: X o GG vince solo in 2 su 3 -> resta (basta 2 su 3)", () => {
    const c = controllaScelta(giocataValida("X oppure GG", opzioni), opzioni, ["0-2", "1-2", "1-3"], "2");
    assert.equal(c.giocata?.codice, "X oppure GG");
    assert.equal(c.corretta, false);
  });
  it("una scelta che vince in meno di 2 risultati si sostituisce con la migliore", () => {
    const c = controllaScelta(giocataValida("MG 1-3 totali", opzioni), opzioni, ["0-2", "1-2", "1-3"], "2");
    assert.equal(c.corretta, true);
    assert.equal(c.giocata?.codice, "MG 2-4 totali"); // vince in 3 su 3; quelle dell'incertezza non valgono con un vincitore
  });
  it("'nessuna' con opzioni coerenti -> si prende la migliore; fuori elenco non vale", () => {
    assert.equal(controllaScelta(null, opzioni, ["1-1", "2-1", "1-2"], "nessuna").giocata?.codice, "MG 1-3 totali"); // 4 vincono 3 su 3: la quota piu' bassa
    assert.equal(giocataValida("2", opzioni), null);
  });
});
