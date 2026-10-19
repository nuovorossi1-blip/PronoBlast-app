import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { tipoCompetizione, stessoTipo } from "../netlify/functions/lib/formaGol";

// 19/10/2026 (Rossi): campionato nel campionato, coppa nella coppa, amichevole nell'amichevole,
// nazionale nella nazionale.
describe("tipo di competizione", () => {
  it("riconosce campionati, coppe, amichevoli e nazionali", () => {
    for (const t of ["Serie A", "Superligaen", "LaLiga", "Eredivisie", "Ligue 1", "Premier League", "Liga Portugal"]) assert.equal(tipoCompetizione(t), "campionato", t);
    for (const t of ["Champions League", "Europa League", "Coppa Italia", "DFB Pokal", "Coupe de France", "Taça de Portugal", "FA Cup"]) assert.equal(tipoCompetizione(t), "coppa", t);
    for (const t of ["Club Friendlies"]) assert.equal(tipoCompetizione(t), "amichevole", t);
    for (const t of ["World Cup Qualification UEFA", "UEFA Nations League", "International Friendlies"]) assert.equal(tipoCompetizione(t), "nazionale", t);
  });
  it("tiene solo lo stesso tipo; con meno di 3 usa le ufficiali, mai le amichevoli", () => {
    const p = [
      { torneo: "Serie A" }, { torneo: "Club Friendlies" }, { torneo: "Serie A" }, { torneo: "Coppa Italia" }, { torneo: "Serie A" },
    ];
    assert.equal(stessoTipo(p, "campionato").partite.length, 3);
    assert.equal(stessoTipo(p, "campionato").stesso, true);
    const coppa = stessoTipo(p, "coppa");
    assert.equal(coppa.stesso, false);
    assert.ok(coppa.partite.every((x) => x.torneo !== "Club Friendlies"));
  });
});
