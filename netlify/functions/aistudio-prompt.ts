import { pgGet, jsonResponse, rowToMatch } from "./lib/supabaseRest";
import { parseLeagueLabel } from "./lib/leagueContext";

/**
 * GET /aistudio-prompt
 * Genera il testo da incollare in TypingMind per far analizzare le partite
 * in Schedina da un modello esterno con la ricerca web attiva.
 *
 * ==========================================================================
 * 16/09/2026 — RISCRITTA DA ZERO. PROMPT CORTO, SENZA QUOTE.
 * ==========================================================================
 * Le versioni precedenti erano lunghe centinaia di righe: fair odds,
 * Edge%, Kelly, matrice di correlazione con 10.000 simulazioni Monte Carlo,
 * soglie per mercato. Il test sul campo ha mostrato due difetti che nessuna
 * riscrittura del testo poteva sanare:
 *
 *  1) CIRCOLO VIZIOSO. Ricevendo il CSV delle quote, il modello ricavava le
 *     "fair odds" da quelle stesse quote. Confrontare un listino con se
 *     stesso privato del margine da' una somma di edge sempre pari a MENO il
 *     margine: il value non puo' esistere, mai, su nessuna partita. Gli edge
 *     positivi che comparivano erano solo errori di arrotondamento.
 *  2) QUOTE INVENTATE. Su Sunderland-AZ il modello ha consigliato X2 a 1.85
 *     mentre nel CSV c'era 2.10, costruendoci sopra un edge del +8,9%.
 *
 * Rossi ha poi provato a mano un prompt di sei righe, senza quote, con la
 * ricerca web attiva: risultato migliore di tutto l'apparato matematico.
 *
 * Da qui la scelta: diamo SOLO giorno, ora, campionato e squadre. Le quote
 * il modello se le cerca sul web insieme a forma, gol e assenze, cosi' il
 * suo giudizio nasce da dati indipendenti invece che dal listino stesso.
 *
 * Niente fair odds, niente Edge%, niente Kelly: sono calcoli che un modello
 * in chat non puo' eseguire davvero, e produrre numeri che sembrano calcoli
 * e non lo sono e' peggio che non produrne.
 *
 * L'unica regola di sostanza rimasta e' quella che risolve un errore vero:
 * non puntare contro il risultato probabile, cambiare mercato invece.
 * ==========================================================================
 */
export default async (): Promise<Response> => {
  try {
    const rows = await pgGet(`matches?selected=eq.true&select=*`);
    if (!rows.length) return jsonResponse({ csv: "", count: 0 });

    // Ordine per giorno, poi orario, poi competizione e squadra di casa: lo
    // stesso in cui Rossi le vede in Schedina. Supabase non garantisce un
    // ordine, e senza questo le partite arrivavano sparse.
    const selected = rows.map(rowToMatch).sort((a: any, b: any) =>
      String(a.day || "").localeCompare(String(b.day || "")) ||
      String(a.time || "").localeCompare(String(b.time || "")) ||
      String(a.manifestazione || "").localeCompare(String(b.manifestazione || "")) ||
      String(a.squadra1 || "").localeCompare(String(b.squadra1 || ""))
    );

    const N = selected.length;

    // Data in formato italiano: il modello deve cercare la partita giusta, e
    // con partite su piu' giorni ogni riga porta la sua.
    const itDate = (d: string) => {
      const [y, mo, da] = String(d || "").split("-");
      return da && mo && y ? `${da}-${mo}-${y}` : String(d || "");
    };

    // ======================================================================
    // 17/09/2026 — SCENARIO ACCANTO A OGNI PARTITA
    //
    // Il modello riceve nomi e orari e ricostruisce tutto dal web. Quando non
    // sa decidere ripiega sull'Over 2.5: nell'ultimo test erano 5 Over su 7.
    // Le quote reali del file Sisal sono l'unica cosa che lui NON riesce a
    // procurarsi (i bookmaker si difendono dai robot), e da quelle sappiamo
    // gia' che TIPO di partita e'.
    //
    // Non gli passiamo le quote — sarebbe il circolo vizioso che ci e' gia'
    // costato il prompt lungo: ricavare le "fair odds" dal listino e poi
    // confrontarle col listino stesso non puo' produrre value. Gli passiamo
    // una CLASSIFICAZIONE, cioe' una parola, piu' i mercati da valutare per
    // primi. Il giudizio resta suo, basato sulla ricerca web.
    //
    // Stessa regola della card in app (frontend/src/api.ts, getScenarioNote):
    // una sola discriminante, esiste una favorita sotto quota 2,00?
    //   no -> EQUILIBRIO | si + X sotto 4,00 -> PROGRESSIONE | si + X da 4,00 -> GAP
    //   (GAP FALSO se l'avversario sta sotto 4,00, 18/10/2026)
    //
    // I mercati sono tradotti in quelli che Rossi ha ammesso per TypingMind:
    // il DNB della card diventa 1X/X2, il multigol 1-3/0-2 diventa MG 2-4.
    // ======================================================================
    const SOGLIA_FAVORITA = 2.0;
    const SOGLIA_GAP = 4.0;

    function bloccoScenario(m: any): string[] {
      const o = m.odds || {};
      const q1 = o.odd_1, qx = o.odd_X, q2 = o.odd_2;
      // Senza le tre quote non inventiamo uno scenario: meglio una riga nuda
      // che una classificazione campata in aria.
      if (q1 == null || qx == null || q2 == null) return [];

      const fav: "1" | "2" | null =
        q1 < SOGLIA_FAVORITA && q1 <= q2 ? "1" :
        q2 < SOGLIA_FAVORITA && q2 < q1 ? "2" :
        null;

      if (!fav) {
        return [
          "SCENARIO: EQUILIBRIO",
          "Mercati da considerare:",
          "• GG",
          "• Over 2,5",
          "• MG Totale 2-4",
        ];
      }

      const lato = fav === "1" ? "casa favorita" : "ospite favorito";

      // GAP FALSO (18/10/2026): X da 4,00 ma l'avversario sotto 4,00 -> nessun divario vero.
      if (qx >= SOGLIA_GAP && (fav === "1" ? q2 : q1) < SOGLIA_GAP) {
        return [
          `SCENARIO: GAP FALSO (${lato}, avversario sotto 4)`,
          "Mercati da considerare:",
          "• Nessuna giocata (partita da evitare)",
          "• Under 3,5",
        ];
      }

      if (qx >= SOGLIA_GAP) {
        return [
          `SCENARIO: GAP TECNICO (${lato})`,
          "Mercati da considerare:",
          `• ${fav} fisso`,
          "• GG + Over 2,5 (combo)",
          fav === "1" ? "• MG Casa 2-4" : "• MG Ospite 2-4",
        ];
      }

      return [
        `SCENARIO: PROGRESSIONE (${lato})`,
        "Mercati da considerare:",
        fav === "1"
          ? "• MC CASA (1-3) + MC OSPITE (0-2)"
          : "• MC CASA (0-2) + MC OSPITE (1-3)",
        fav === "1" ? "• 1X" : "• X2",
      ];
    }

    const righe: string[] = [];
    for (const m of selected as any[]) {
      const comp = parseLeagueLabel(m.manifestazione) || m.manifestazione || "";
      righe.push("");
      righe.push(`${itDate(m.day)} | ${m.time || ""} | ${comp} — ${m.squadra1} - ${m.squadra2}`);
      righe.push(...bloccoScenario(m));
    }

    // ======================================================================
    // 17/09/2026 — TRE DIVIETI, dopo l'analisi dei tre errori reali.
    //
    // Il prompt corto aveva funzionato, ma tre pronostici sono andati male e
    // ognuno per un motivo diverso e ripetibile:
    //   - Barcellona MG Casa 2-4 -> finita 7-2. Il Barca segnava 4,2 gol a
    //     partita: il range 2-4 era semplicemente quello sbagliato.
    //   - Milan-Benfica GG -> finita 0-2. Milan 2 gol in 4 gare, Benfica
    //     4 porte inviolate su 5.
    //   - Sunderland-AZ X2 -> finita 1-0. Ha puntato CONTRO il favorito.
    //
    // Il terzo e' il piu' istruttivo: la regola c'era gia', ma era scritta
    // con una condizione ("se la favorita paga troppo poco"). Sunderland
    // pagava 1,67 — non "troppo poco" — e il modello si e' sentito
    // autorizzato. Ora e' incondizionata: MAI, a nessuna quota.
    //
    // Sono tre divieti e non una tabella di soglie perche' usano dati che il
    // modello trova davvero sul web (gol fatti, gol subiti, porte inviolate),
    // non xG stimati per ogni campionato. Una tabella con celle obbligatorie
    // da riempire e' un invito a inventare i numeri mancanti.
    // ======================================================================
    const prompt = [
      // ====================================================================
      // 17/09/2026 — PROMPT RIDOTTO ALL'OSSO, su richiesta di Rossi dopo il
      // test migliore.
      //
      // Era arrivato a 5.500 caratteri: una regola aggiunta per ogni errore
      // osservato. Il risultato e' stato l'opposto di quello voluto — il
      // modello ha scartato 4 partite su 8 usando le regole stesse come
      // appigli ("la favorita reale e' l'altra", "quota combo non trovata"),
      // e non ha prodotto nessuna multipla.
      //
      // Rossi ha provato a mano la versione minima: una riga di consegna piu'
      // l'elenco con scenario e mercati. Risultato migliore di tutte le
      // versioni con le regole.
      //
      // L'informazione che conta e' gia' nei MERCATI: sono calcolati dalle
      // quote reali del file Sisal, che il modello non puo' procurarsi, e
      // restringono la scelta a tre voci per partita. Il resto — soglie,
      // divieti, obblighi di confronto — e' testo che il modello rigira.
      //
      // Se torna a sbagliare, si aggiunge UNA riga per l'errore specifico.
      // Non un blocco di regole.
      // ====================================================================
      "Fai una ricerca via web e analizza queste partite",
      "Partite:",
      ...righe,
    ].join("\n");

    // La chiave resta "csv" perche' e' quella che il frontend legge da sempre
    // in tre schermate: rinominarla vorrebbe dire toccarle tutte per niente.
    return jsonResponse({ csv: prompt, count: N });
  } catch (e: any) {
    return jsonResponse({ error: e?.message || "Errore" }, 502);
  }
};
