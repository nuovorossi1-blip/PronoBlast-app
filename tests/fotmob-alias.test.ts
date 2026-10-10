import { describe, it, beforeEach } from "node:test";
import * as assert from "node:assert/strict";
import { trovaPartita } from "../netlify/functions/lib/fotmobDossier";
import { simil, impostaAlias, squadreIncompatibili, marker } from "../netlify/functions/lib/teamMatch";
import { type PartitaFonte } from "../netlify/functions/lib/resultSources";

describe("Abbinamento squadre e alias FotMob", () => {
  beforeEach(() => {
    impostaAlias([]);
  });

  it("1. Braga-Sporting Lisbona vs Braga-Sporting CP abbinata (sia con alias che con riserva)", () => {
    const oraMs = 1791573300000;
    const fotmobBraga: PartitaFonte = {
      fonte: "FotMob",
      lega: "Liga Portugal",
      casa: "Braga",
      ospite: "Sporting CP",
      gc: 1,
      go: 3,
      finita: true,
      supplementari: false,
      stato: "FT",
      ora: oraMs,
      id: "5887647",
      legaId: 61,
    };
    const elenco = [fotmobBraga];

    // Senza alias: la regola di riserva abbina la partita per orario + lega nota (POR1 -> 61)
    const riserva = trovaPartita(elenco, "Braga", "Sporting Lisbona", oraMs, "POR1");
    assert.ok(riserva, "Dovrebbe essere abbinata tramite regola di riserva");
    assert.equal(riserva.id, "5887647");
    assert.deepEqual(riserva.aliasScoperto, {
      da: "Sporting Lisbona",
      a: "Sporting CP",
    });

    // Con alias impostato: abbinata subito tramite regola ordinaria
    impostaAlias([{ da: "Sporting Lisbona", a: "Sporting CP" }]);
    const ordinaria = trovaPartita(elenco, "Braga", "Sporting Lisbona", oraMs);
    assert.ok(ordinaria, "Dovrebbe essere abbinata tramite regola ordinaria con alias");
    assert.equal(ordinaria.id, "5887647");
  });

  it("2. Due partite candidate nella stessa fascia -> null (ambiguita')", () => {
    const oraMs = 1791573300000;
    const cand1: PartitaFonte = {
      fonte: "FotMob",
      lega: "Liga Portugal",
      casa: "Braga",
      ospite: "Sporting CP",
      gc: null,
      go: null,
      finita: false,
      supplementari: false,
      stato: "",
      ora: oraMs,
      id: "5887647",
      legaId: 61,
    };
    const cand2: PartitaFonte = {
      fonte: "FotMob",
      lega: "Liga Portugal",
      casa: "Braga",
      ospite: "Sporting B",
      gc: null,
      go: null,
      finita: false,
      supplementari: false,
      stato: "",
      ora: oraMs + 10 * 60000, // +10 minuti, stessa fascia +-30m
      id: "9999999",
      legaId: 61,
    };

    // Senza alias, due candidati che soddisfano la riserva nella stessa fascia -> niente
    const esito = trovaPartita([cand1, cand2], "Braga", "Sporting Lisbona", oraMs, "POR1");
    assert.equal(esito, null, "Due partite candidate nella stessa fascia devono restituire null");
  });

  it("3. Marker U21/U19/Women diversi mai abbinati", () => {
    // Controllo funzione marker e squadreIncompatibili
    assert.equal(marker("Sporting Lisbona U19"), "u19");
    assert.equal(marker("Sporting CP"), "");
    assert.equal(marker("Braga Women"), "women");
    assert.equal(marker("Braga U21"), "u21");

    assert.ok(squadreIncompatibili("Sporting Lisbona U19", "Sporting CP"));
    assert.ok(squadreIncompatibili("Braga Women", "Braga"));
    assert.ok(squadreIncompatibili("Arsenal U21", "Arsenal"));
    assert.ok(squadreIncompatibili("Juventus U19", "Juventus U23"));

    // Simil con marker diversi torna 0
    assert.equal(simil("Braga U19", "Braga"), 0);
    assert.equal(simil("Arsenal Women", "Arsenal"), 0);

    // Anche nella regola di riserva di trovaPartita non devono essere abbinate
    const oraMs = 1791573300000;
    const fotmobSenior: PartitaFonte = {
      fonte: "FotMob",
      lega: "Liga Portugal",
      casa: "Braga",
      ospite: "Sporting CP",
      gc: null,
      go: null,
      finita: false,
      supplementari: false,
      stato: "",
      ora: oraMs,
      id: "5887647",
      legaId: 61,
    };
    // PronoBlast ha Braga vs Sporting Lisbona U19
    const esito = trovaPartita([fotmobSenior], "Braga", "Sporting Lisbona U19", oraMs, "POR1");
    assert.equal(esito, null, "U19 vs Senior non deve mai essere abbinata");
  });

  it("4. Manchester United vs Manchester City mai abbinati", () => {
    assert.ok(simil("Manchester United", "Manchester City") <= 0.5);
    assert.ok(squadreIncompatibili("Manchester United", "Manchester City"));

    // In trovaPartita riserva: Arsenal vs Manchester United non deve abbinare Arsenal vs Manchester City
    const oraMs = 1791573300000;
    const fotmobCity: PartitaFonte = {
      fonte: "FotMob",
      lega: "Premier League",
      casa: "Arsenal",
      ospite: "Manchester City",
      gc: null,
      go: null,
      finita: false,
      supplementari: false,
      stato: "",
      ora: oraMs,
      id: "474747",
      legaId: 47,
    };
    const esito = trovaPartita([fotmobCity], "Arsenal", "Manchester United", oraMs, {
      manifestazione: "ING1",
      legaIdAtteso: 47,
    });
    assert.equal(esito, null, "Manchester United vs Manchester City non devono mai essere abbinati");
  });

  it("5. Verifica i 6 casi certi risolti con alias", () => {
    const coppieCerte = [
      { da: "Sporting Lisbona", a: "Sporting CP" },
      { da: "Odense", a: "OB" },
      { da: "Bukhara", a: "Buxoro" },
      { da: "Ekenas", a: "EIF" },
      { da: "Akademisk Boldklub Gladsa", a: "AB" },
      { da: "Belediye Vanspor", a: "Van Spor Kulübü" },
    ];

    impostaAlias(coppieCerte);

    for (const { da, a } of coppieCerte) {
      assert.equal(simil(da, a), 1, `L'alias per ${da} -> ${a} deve portare simil a 1`);
    }
  });
});
