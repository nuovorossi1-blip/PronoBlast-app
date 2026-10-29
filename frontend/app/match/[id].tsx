import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  TextInput, Linking, } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";

import { daGiocare } from "@/src/api";
import { api, Match, Prediction, MARKET_FAMILIES, ODD_LABELS, OddsKey, quickPredictionFamily, rankPicks, StructuralAnalysis, buildFinalVerdict, VerdictPick, getMarketOdd, filterCoherentAlternatives, ammessoDallaStruttura, fusioneInIngresso, conLetturaGol, NOTA_LETTURA_GOL, getMatchCautionWarning, MatchHistory, getScenarioNote, chiaveScenario, evaluateMarketOutcome, ManualeStatsResponse, isVerdictMarket, normalizeMarket, SimilarOddsResponse, RIGHE_STATISTICHE, pctProb, candidatiManuale, FASCE_AI, dividiAnalisi, pronosticoPostPartita, inizioPartitaMs, verdettoDaAI, validaFasce, sogliaMassimaAffidabile, chiaveFascia, PROB_AFFIDABILE, FasciaValidata, etichettaFascia, valutaPuntaSu, consiglioDi, alternativeDelConsiglio, consiglioDaCautela, aiDecide, letturaGol, FormaGol, TabellaScenari, VoceTabella, quotaManuale, fasciaDellaQuota, RispostaLettura, intervalloGol, coerenteConGol, analizzaGiocate, AnalisiGiocate, mercatoAIValido, EsitoMercatoAI, PronosticoRegole, classificaScenario, isMercatoVietato, pronosticiDelloScenario, chiavePronostico } from "@/src/api";
import { marketStatsCache, mlStatsCache, matchDetailCache, oddSettingsCache, selectedListCache, persistentLetturaCache, persistentTabellaCache } from "@/src/utils/cache";
import { useScrollMemory } from "@/src/utils/scrollMemory";
import { colors, fonts } from "@/src/theme";
import { ScoreInput } from "@/src/components/ScoreInput";
import { predictionQueue } from "@/src/utils/predictionQueue";
import BottomNav, { useNavMetrics } from "@/src/components/BottomNav";
import { confirmAction, notify } from "@/src/utils/platform";

/**
 * La soglia di quota si legge UNA VOLTA per sessione. Se due schermate la
 * chiedono insieme condividono la stessa promessa, cosi' non partono due
 * richieste per lo stesso numero.
 */
const ODD_FALLBACK = { min_odd: 1.40, options: [1.40, 1.50, 1.60, 1.75] };
let oddSettingsPromise: Promise<{ min_odd: number; options: number[] }> | null = null;

function getOddSettingsOnce(): Promise<{ min_odd: number; options: number[] }> {
  const cached = oddSettingsCache.get();
  if (cached) return Promise.resolve(cached);
  if (!oddSettingsPromise) {
    oddSettingsPromise = api.getMinOdd()
      .then((r) => {
        const v = {
          min_odd: r?.min_odd || ODD_FALLBACK.min_odd,
          options: r?.options?.length ? r.options : ODD_FALLBACK.options,
        };
        oddSettingsCache.set(v);
        return v;
      })
      .catch(() => {
        oddSettingsPromise = null; // un errore non deve congelare il fallback
        return ODD_FALLBACK;
      });
  }
  return oddSettingsPromise;
}

/** Le statistiche mercati sono le stesse per tutta l'app: se la cache della
 *  home e' ancora fresca non ha senso riscaricare 500 righe. */
function getMarketStatsCached(): Promise<{ markets: any[] }> {
  const c = marketStatsCache.get();
  if (c && !marketStatsCache.isStale()) return Promise.resolve({ markets: c });
  return api.marketStats()
    .then((s) => { marketStatsCache.set(s?.markets || []); return { markets: s?.markets || [] }; })
    .catch(() => ({ markets: marketStatsCache.get() || [] }));
}

/**
 * Mercati che Rossi non gioca e non giochera' mai (28/09/2026): non devono
 * comparire ne' nel RANKING STRUTTURALE ne' nell'EURISTICA RAPIDA.
 *
 * Attenzione: e' un filtro di VISUALIZZAZIONE e di proposta, non una rimozione
 * dal motore. NG in particolare resta nel calcolo come "solo veto": se sta in
 * alto nel ranking continua a impedire che venga proposto GG, che e' il suo
 * opposto. Toglierlo davvero dal motore riaprirebbe il buco chiuso il 19/09,
 * quando il verdetto scivolava su GG al 39% in partite difensive.
 */
const MAI_GIOCATI = ["NG", "U1.5", "U2.5"];
const nonGiocato = (m: string) => {
  const n = String(m || "").trim().toUpperCase().replace(/\s+/g, "");
  return MAI_GIOCATI.some((x) => x.replace(/\s+/g, "").toUpperCase() === n);
};

// Memoria della sessione (07/10/2026, Rossi: "se esco e rientro deve esserci
// gia'"): lettura e consigliato per partita, e la tabella scenari.
const memLettura = new Map<string, RispostaLettura>();
let memTabella: TabellaScenari | null = null;

export default function MatchDetail() {
  const { id, gen } = useLocalSearchParams<{ id: string; gen?: string }>();
  const router = useRouter();
  const scrollMem = useScrollMemory(`/match/${id ?? "x"}`);
  // Altezza REALE della BottomNav, presa dal suo stesso calcolo: prima era
  // stimata a mano qui e i due numeri non coincidevano, lasciando una
  // striscia di sfondo fra le due barre.
  const { height: navHeight } = useNavMetrics();
  const oddCached = oddSettingsCache.get();
  const [minOdd, setMinOdd] = useState<number>(oddCached?.min_odd ?? ODD_FALLBACK.min_odd);
  const [minOddOptions, setMinOddOptions] = useState<number[]>(oddCached?.options ?? ODD_FALLBACK.options);
  const [oddReady, setOddReady] = useState<boolean>(!!oddCached);

  const initialBundle = id ? matchDetailCache.get(id, minOdd) : null;
  const [match, setMatch] = useState<Match | null>(initialBundle?.match ?? null);
  const [prediction, setPrediction] = useState<Prediction | null>(initialBundle?.match?.prediction ?? null);
  const [loading, setLoading] = useState(!initialBundle);
  const [aiPending, setAiPending] = useState(false);
  const [result, setResult] = useState(initialBundle?.match?.result || "");
  const [marketStats, setMarketStats] = useState<{ market: string; win_rate: number; total: number; family: string }[]>(() => marketStatsCache.get() || []);
  const [mostraPerche, setMostraPerche] = useState(false);
  const [rankingTutto, setRankingTutto] = useState(false);
  // Fascia mostrata nella scheda AI: parte dalla Quota minima, si puo' sfogliare.
  const [fasciaAI, setFasciaAI] = useState<number | null>(null);
  const [fontiAperte, setFontiAperte] = useState(false);
  /** Storico delle partite concluse con quote vicine. Si carica a richiesta:
   *  il server deve scorrere ottomila partite, non ha senso farlo all'apertura
   *  di ogni scheda. */
  const [storicoQuote, setStoricoQuote] = useState<SimilarOddsResponse | null>(null);
  const [caricoStorico, setCaricoStorico] = useState(false);
  // Ticket 8: quante volte ogni mercato del manuale e' uscito, per scenario.
  const [manualeStats, setManualeStats] = useState<ManualeStatsResponse | null>(null);
  // Si riprova due volte se non arriva (01/10/2026, Irlanda-Austria): senza
  // misura i mercati del manuale sparivano da fasce e alternative del consiglio.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const prova = (tentativo: number) => {
      api.manualeStats()
        .then((r) => { if (alive) setManualeStats(r); })
        .catch((e) => {
          console.error("[manuale-stats]", e);
          if (alive && tentativo < 2) timer = setTimeout(() => prova(tentativo + 1), 4000);
        });
    };
    prova(0);
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, []);
  const [structural, setStructural] = useState<StructuralAnalysis | null>(initialBundle?.struct as StructuralAnalysis | null);
  const [showClusterAll, setShowClusterAll] = useState(false);
  const [history, setHistory] = useState<MatchHistory | null>(initialBundle?.hist as MatchHistory | null);
  // Forma gol delle due squadre da FotMob (07/10/2026): a parte, non blocca la scheda.
  const [forma, setForma] = useState<FormaGol | null>(null);
  // Parere dell'AI chiuso in una riga quando non decide (07/10/2026, Rossi).
  const [parereAperto, setParereAperto] = useState(false);
  // Tutto il resto della scheda sta in "Approfondisci", chiuso (07/10/2026, Rossi:
  // "all'utente serve la lettura, se vuole approfondire lo fa a parte").
  const [approfondisci, setApprofondisci] = useState(false);
  const [altreFasce, setAltreFasce] = useState(false);
  const [vecchioVerdetto, setVecchioVerdetto] = useState(false);
  const [tabella, setTabella] = useState<TabellaScenari | null>(() => memTabella ?? persistentTabellaCache.get());
  // La lettura (07/10/2026): frasi del programma + lettura dell'AI gratis.
  const [lettura, setLettura] = useState<RispostaLettura | null>(() => {
    if (!id) return null;
    return memLettura.get(id) ?? persistentLetturaCache.get(id, initialBundle?.match?.odds);
  });
  const [letturaInCorso, setLetturaInCorso] = useState(false);
  const [proInCorso, setProInCorso] = useState(false);
  // Partita gia' giocata: "leggila con l'AI come prima del via" (19/10/2026, Rossi).
  const [rifaiInCorso, setRifaiInCorso] = useState(false);
  const leggiComePrima = () => {
    if (!id || rifaiInCorso) return;
    setRifaiInCorso(true);
    api.lettura(id, { genera: true, rifai: true })
      .then((r) => { memLettura.set(id, r); persistentLetturaCache.set(id, r, match?.odds); setLettura(r); })
      .catch((e) => notify("Lettura non fatta", String(e?.message || e).replace(/^\d{3}\s+/, "")))
      .finally(() => setRifaiInCorso(false));
  };
  // Rossi (07/10/2026): "se e' automatica falla e basta, senza cliccarci".
  // Prima subito quello che c'e', poi (auto=1) il server fa la lettura gratis
  // se manca o se le quote sono cambiate.
  useEffect(() => {
    if (!id) return;
    let vivo = true;
    const cachedL = memLettura.get(id) ?? persistentLetturaCache.get(id, match?.odds);
    if (cachedL) {
      memLettura.set(id, cachedL);
      setLettura(cachedL);
    }
    setLetturaInCorso(true);
    api.lettura(id)
      .then(async (r) => {
        if (!vivo) return;
        memLettura.set(id, r);
        persistentLetturaCache.set(id, r, match?.odds);
        setLettura(r);
        // La lettura salvata compare prima di qualunque generazione AI.
        // Non rifacciamo il lavoro quando l'AI e' gia' aggiornata.
        if (r.dossier && (!r.ai || r.ai_vecchia)) {
          const aggiornata = await api.lettura(id, { auto: true });
          if (vivo) {
            memLettura.set(id, aggiornata);
            persistentLetturaCache.set(id, aggiornata, match?.odds);
            setLettura(aggiornata);
          }
        }
      })
      .catch(() => {})
      .finally(() => { if (vivo) setLetturaInCorso(false); });
    return () => { vivo = false; };
  }, [id, match?.odds]);
  // Risultati attesi con accanto la quota Sisal del risultato esatto, quando la scheda e' stata letta.
  const conQuotaSisal = (rs: string[]) => rs.map((r) => {
    const q = match?.quote_sisal?.esatti?.[String(r).replace(/\s/g, "")];
    return q ? `${r} @${q.toFixed(2)}` : r;
  }).join(" · ");

  // "Pronostico AI": la stessa lettura col modello scelto in LLM & Budget,
  // con il controllo della notizia che puo' cambiare "Punta su questo".
  const faiPro = () => {
    if (!id || proInCorso) return;
    setProInCorso(true);
    api.lettura(id, { genera: true, pro: true })
      .then((r) => {
        memLettura.set(id, r);
        persistentLetturaCache.set(id, r, match?.odds);
        setLettura(r);
        // Quote della scheda Sisal (21/10/2026): lette dal server prima del pronostico.
        const sx = (r as any)?.sisal;
        if (sx?.ok) load(true);
        else if (sx && !sx.ok) notify("Quote Sisal non lette", `${sx.errore || "scheda non disponibile"}: multigol e combo restano stimate (*).`);
        // Una volta sola (11/10/2026): il server rida' il primo, finche' le quote non cambiano.
        if ((r as any)?.pro_gia_fatto) {
          notify("Pronostico AI già fatto", "Vale il primo pronostico: ripremendo il modello risponderebbe un po' diverso ogni volta. Si potrà rifare solo se cambiano le quote (Excel nuovo).");
        }
      })
      .catch((e) => notify("Pronostico AI non fatto", String(e?.message || e).replace(/^\d{3}\s+/, "")))
      .finally(() => setProInCorso(false));
  };
  useEffect(() => {
    let vivo = true;
    const t = memTabella ?? persistentTabellaCache.get();
    if (t?.scenari) {
      memTabella = t;
      setTabella(t);
      return;
    }
    api.tabellaScenari().then((res) => {
      if (vivo && res?.scenari) {
        memTabella = res;
        persistentTabellaCache.set(res);
        setTabella(res);
      }
    }).catch(() => {});
    return () => { vivo = false; };
  }, []);
  useEffect(() => {
    if (!id) return;
    let vivo = true;
    setForma(null);
    api.formaGol(id).then((r) => { if (vivo) setForma(r?.forma ?? null); }).catch(() => {});
    return () => { vivo = false; };
  }, [id]);
  // Pronostico regole (15/10/2026, in prova): arriva dentro la lettura (stessa memoria del
  // consigliato), cosi' compare insieme a lui e non sposta la scheda dopo qualche secondo.
  // Solo prima del via: ricalcolato a partita iniziata sembrerebbe sempre giusto (anche dalla memoria).
  const inizioRegole = match ? inizioPartitaMs(match.day, match.time) : null;
  const regole: PronosticoRegole | null = match && !match.result && (inizioRegole === null || inizioRegole > Date.now())
    ? (lettura?.regole ?? null) : null;
  // Dettagli (consigliato d'archivio, lettura completa): chiusi se c'e' "Cosa giocare", aperti
  // sulle partite iniziate o finite, dove "Cosa giocare" non c'e'.
  const [dettagli, setDettagli] = useState(false);
  // Vista semplice (19/10/2026): il resto della scheda e il perche' si'/no restano chiusi finche' non si aprono.
  const [tecnici, setTecnici] = useState(false);
  const [percheAperto, setPercheAperto] = useState(false);
  // Il pronostico unico (15/10/2026 sera): il consigliato salvato, anche a partita iniziata o finita.
  const cosaGiocare = lettura?.consigliato ?? null;
  const mostraDettagli = dettagli || !cosaGiocare;
  // Lista delle partite in Schedina: serve a sapere qual e' la prossima.
  const [selList, setSelList] = useState<Match[]>((selectedListCache.get() as Match[]) || []);
  const loadVersion = useRef(0);

  /** Riversa nello stato un pacchetto gia' pronto (dalla cache o dalla rete). */
  const applyBundle = useCallback((b: { match: any; cands: any; struct: any; hist: any }) => {
    setMatch(b.match);
    setPrediction(b.match?.prediction ?? null);
    setResult(b.match?.result || "");
    setStructural(b.struct as StructuralAnalysis | null);
    setHistory(b.hist as MatchHistory | null);
  }, []);

  // STALE-WHILE-REVALIDATE, come gia' fa la home.
  //  - se il pacchetto e' in cache lo mostro SUBITO, senza spinner;
  //  - se e' ancora fresco (<5 min) non chiamo nemmeno il server;
  //  - se e' vecchio aggiorno in sottofondo, con i dati vecchi gia' a schermo.
  const load = useCallback(async (force = false) => {
    if (!id) return;
    const version = ++loadVersion.current;
    const current = () => loadVersion.current === version;
    const cached = matchDetailCache.get(id, minOdd);
    if (cached) {
      applyBundle(cached);
      setMarketStats(marketStatsCache.get() || []);
      setLoading(false);
      if (!force && !matchDetailCache.isStale(id, minOdd)) return;
    }
    try {
      // Le "opportunita' non sfruttate" (/match-candidates) non si mostrano piu'
      // (round 2, TICKET 1): erano costanti di famiglia, non numeri di questa
      // partita. L'endpoint resta in piedi, la scheda non lo chiama.
      const [m, stats, struct, hist] = await Promise.all([
        api.match(id).then((m) => {
          // La scheda si apre appena arrivano squadre, quote e dati salvati.
          // Statistiche, motore e storico completano il pacchetto in seguito.
          if (current()) {
            setMatch(m);
            setPrediction(m.prediction ?? null);
            setResult(m.result || "");
            if (!cached) { setStructural(null); setHistory(null); }
            setLoading(false);
          }
          return m;
        }),
        getMarketStatsCached(),
        api.matchStructural(id, minOdd).catch(() => null),
        api.matchHistory(id).catch(() => null),
      ]);
      if (!current()) return;
      const bundle = { match: m, cands: null, struct, hist };
      matchDetailCache.set(id, minOdd, bundle);
      applyBundle(bundle);
      setMarketStats(stats?.markets || []);
    } catch (e: any) {
      // Con dati gia' a schermo un errore di rete non deve buttare un alert
      // in faccia: si tiene quello che c'e'.
      if (current() && !cached) notify("Errore", e?.message || "Caricamento");
    } finally {
      if (current()) setLoading(false);
    }
  }, [id, minOdd, applyBundle]);

  useEffect(() => {
    if (oddReady) load();
    // Una risposta della partita precedente non deve sovrascrivere quella nuova.
    return () => { loadVersion.current++; };
  }, [load, oddReady]);

  // Soglia salvata nelle impostazioni: una volta per SESSIONE, non per partita.
  useEffect(() => {
    if (oddReady) return;
    let alive = true;
    getOddSettingsOnce().then((r) => {
      if (!alive) return;
      setMinOddOptions(r.options);
      setMinOdd(r.min_odd);
      setOddReady(true);
    });
    return () => { alive = false; };
  }, [oddReady]);

  const changeMinOdd = useCallback((value: number) => {
    setMinOdd(value);                 // il ricalcolo parte da solo: `load` dipende da minOdd
    const prev = oddSettingsCache.get();
    oddSettingsCache.set({ min_odd: value, options: prev?.options ?? ODD_FALLBACK.options });
    api.setMinOdd(value).catch(() => { /* la scelta vale comunque per questa sessione */ });
  }, []);

  // ============================================================
  // FASE 0 — salvataggio del verdetto finale.
  // Il verdetto viene calcolato durante il render (più sotto); qui lo
  // ricalcoliamo una volta sola, fuori dal render, per poterlo salvare senza
  // effetti collaterali dentro il JSX.
  // NOTA: le righe qui sotto devono restare allineate a quelle del blocco
  // "VERDETTO FINALE" nel render — se un giorno cambia la logica lì, va
  // cambiata anche qui, altrimenti si salva un pick diverso da quello mostrato.
  // ============================================================
  /** Riquadro mostrato quando nessun mercato coerente supera la soglia.
      Deve contenere COMUNQUE il selettore della quota: senza, l'utente non ha
      modo di abbassarla e resta bloccato su una schermata muta. */
  const renderNessunaGiocata = () => (
    <View style={styles.verdictBlock}>
      <Text style={styles.verdictTitle}>VERDETTO FINALE</Text>
      <View style={styles.minOddRow}>
        <Text style={styles.minOddLabel}>Fascia di quota</Text>
        <View style={styles.minOddChips}>
          {minOddOptions.map((v) => (
            <TouchableOpacity
              key={v}
              onPress={() => changeMinOdd(v)}
              style={[styles.minOddChip, minOdd === v && styles.minOddChipOn]}
            >
              <Text style={[styles.minOddChipTxt, minOdd === v && styles.minOddChipTxtOn]}>
                {v.toFixed(2)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <View style={styles.sogliaWarn}>
        <Text style={styles.sogliaWarnTitle}>Nessuna giocata nella fascia {etichettaFascia(minOdd)}</Text>
        <Text style={styles.sogliaWarnBody}>
          {"In questa fascia di quota non c'è nessun mercato coerente con la lettura della partita. Prova un'altra fascia qui sopra per vedere cosa propone il motore."}
        </Text>
      </View>
    </View>
  );

  // Un pronostico AI generato dopo il calcio d'inizio (puo' conoscere il
  // risultato) si mostra, ma non entra mai nel verdetto.
  const aiPostPartita = pronosticoPostPartita(prediction, match);
  const predVerdetto = aiPostPartita ? null : prediction;
  // SCELTA B (07/10/2026): l'AI vota nel verdetto solo con una notizia verificata.
  const predDecide = predVerdetto && aiDecide(predVerdetto, match) ? predVerdetto : null;
  // Mercati del manuale candidati in QUESTA partita (scenario, >50% in
  // archivio, quota >= soglia). Per le fasce AI si parte da 1.40.
  const manualeQui = candidatiManuale(match?.odds, manualeStats?.scenari, minOdd, structural?.market_odds, false, structural?.structure);
  const manualeFasce = candidatiManuale(match?.odds, manualeStats?.scenari, FASCE_AI[0], structural?.market_odds, true, structural?.structure);

  // Il consigliato salvato (pick_finale) non dipende piu' dalla fascia che si
  // sta guardando: lo calcola il server, il piu' solido fra tutte le fasce
  // (consigliatoTraFasce, 13/10/2026). La scheda chiede solo di aggiornarlo,
  // una volta per partita aperta.
  const savedVerdictRef = useRef<string | null>(null);
  useEffect(() => {
    if (!match || match.id !== id || match.result) return;
    if (savedVerdictRef.current === match.id) return;
    savedVerdictRef.current = match.id;
    api.verdettoPartita(match.id).catch(() => {
      // Best effort: se il salvataggio fallisce l'app resta identica.
      savedVerdictRef.current = null;
    });
  }, [id, match]);

  // Subscribe to background prediction queue so the UI reflects in-flight requests
  useEffect(() => {
    if (!id) return;
    const updateState = async () => {
      const wasPending = predictionQueue.isPending(id);
      setAiPending(wasPending);
      // If a background prediction just finished, refresh the data
      if (!wasPending && match && !match.main_prediction && prediction === null) {
        try {
          const m = await api.match(id);
          setMatch(m);
          setPrediction(m.prediction ?? null);
          matchDetailCache.invalidate(id); // il pacchetto in cache non ha il pronostico appena arrivato
        } catch {}
      }
    };
    updateState();
    const unsub = predictionQueue.subscribe(updateState);
    return unsub;
  }, [id]);

  // Polling fallback while a background prediction is in flight
  useEffect(() => {
    if (!aiPending || !id) return;
    const interval = setInterval(async () => {
      try {
        const m = await api.match(id);
        if (m.prediction) {
          setMatch(m);
          setPrediction(m.prediction);
          matchDetailCache.invalidate(id);
          clearInterval(interval);
        }
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [aiPending, id]);

  const runPrediction = (forceRegen: boolean = false, confermato = false) => {
    if (!id) return;
    // Partita gia' iniziata: il pronostico puo' conoscere il risultato. Si
    // puo' generare lo stesso (per vedere la scheda), ma lo si dice prima.
    const inizio = inizioPartitaMs(match?.day, match?.time);
    if (!confermato && (!!match?.result || (inizio !== null && Date.now() >= inizio))) {
      confirmAction({
        title: "PARTITA GIÀ INIZIATA",
        message: "Un pronostico generato adesso può essere influenzato dal risultato (la ricerca web lo trova). Verrà marcato \"dopo la partita\": lo vedi, ma non conta per il verdetto né per la pagella.",
        confirmText: "Genera comunque",
        cancelText: "Annulla",
        onConfirm: () => runPrediction(forceRegen, true),
      });
      return;
    }
    // FIRE-AND-FORGET: la richiesta viene avviata e tracciata dalla queue globale.
    // L'utente può tornare alla home; quando la risposta arriva, lo stato si aggiorna.
    setAiPending(true);
    setApprofondisci(true);
    predictionQueue.enqueue(id, forceRegen).then((p) => {
      if (p) {
        if ((p as any).fasce?.rifatto) notify("Pronostico AI rifatto", (p as any).fasce.rifatto);
        setPrediction(p);
        matchDetailCache.invalidate(id);
        load(true);
      } else {
        // Prima l'errore restava nascosto: si vedeva solo tornare "Rigenera".
        notify("Pronostico AI non generato", predictionQueue.lastError(id) || "Errore sconosciuto: riprova.");
      }
    });
  };

  // ============================================================
  // AUTO-GENERA quando l'utente tap "Pronostico AI" nel BottomNav
  // ============================================================
  // BottomNav passa ?gen=<timestamp> ogni click sul tab Pronostico AI
  // quando l'utente è già su questa pagina. Reagiamo lanciando la
  // generazione (force=true se esiste già una predizione = rigenera).
  useEffect(() => {
    if (!gen || !id || proInCorso) return;
    faiPro();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gen, id]);

  const saveResult = async () => {
    if (!id || !result.trim()) return;
    try {
      const out = await api.setResult(id, result.trim());
      marketStatsCache.invalidate();
      mlStatsCache.invalidate();
      matchDetailCache.invalidate(id);
      if (out.learning?.applied) {
        const ok = out.learning.result_ok;
        notify(
          ok ? "✓ Pronostico VINTO" : "✗ Pronostico PERSO",
          `Mercato: ${out.learning.main_prediction}\n\nIl sistema ha aggiornato i punteggi della famiglia di pronostico per migliorare le prossime previsioni.`,
        );
      } else {
        notify("Salvato", "Risultato salvato");
      }
      await load(true);
    } catch (e: any) {
      notify("Errore", e?.message);
    }
  };

  // ============================================================
  // SCORRIMENTO FRA LE PARTITE DELLA SCHEDINA (richiesta di Rossi, 10/09)
  // ============================================================
  // Aprendo una partita selezionata si restava bloccati li': per vedere la
  // successiva bisognava tornare indietro alla Schedina e riaprirla a mano.
  // La lista arriva dalla cache condivisa (la stessa gia' usata da Schedina e
  // schermata risultato), quindi nel caso normale non costa nessuna richiesta.
  useEffect(() => {
    let alive = true;
    const cached = selectedListCache.get() as Match[] | null;
    if (cached) setSelList(cached);
    if (!cached || selectedListCache.isStale()) {
      api.selectedList()
        .then((list) => { if (alive) { selectedListCache.set(list); setSelList(list); } })
        .catch(() => {});
    }
    return () => { alive = false; };
  }, [id]);

  const selIndex = id ? selList.findIndex((m) => m.id === id) : -1;
  const prevSel = selIndex > 0 ? selList[selIndex - 1] : null;
  const nextSel = selIndex >= 0 && selIndex < selList.length - 1 ? selList[selIndex + 1] : null;
  // `replace` e non `push`: scorrendo dieci partite non deve accumularsi una
  // pila di dieci schermate da smontare col tasto indietro.
  const goToSel = (m: Match | null) => { if (m) router.replace(`/match/${m.id}`); };

  // ============================================================
  // PRECARICAMENTO DELLA PARTITA SUCCESSIVA
  // ============================================================
  // Mentre Rossi legge questa partita, la connessione e' ferma. Usiamo quel
  // tempo morto per scaricare in sottofondo il pacchetto della prossima in
  // Schedina, cosi' premendo AVANTI compare istantanea invece di ricominciare
  // da cinque richieste. Se non preme AVANTI si e' sprecata una richiesta:
  // costo accettabile, perche' in una schedina si scorre quasi sempre avanti.
  //
  // Parte con 1,2 secondi di ritardo per non rubare banda al caricamento della
  // partita che si sta guardando adesso, che ha la precedenza.
  useEffect(() => {
    if (!oddReady || loading) return;
    const nid = nextSel?.id;
    if (!nid || matchDetailCache.get(nid, minOdd)) return;
    let alive = true;
    const timer = setTimeout(() => {
      Promise.all([
        api.match(nid),
        api.matchStructural(nid, minOdd).catch(() => null),
        api.matchHistory(nid).catch(() => null),
      ])
        .then(([m, struct, hist]) => {
          if (alive) matchDetailCache.set(nid, minOdd, { match: m, cands: null, struct, hist });
        })
        .catch((e) => { console.error("[precarica scheda successiva]", e); /* non deve mai disturbare: solo log */ });
    }, 1200);
    return () => { alive = false; clearTimeout(timer); };
  }, [oddReady, loading, nextSel?.id, minOdd]);

  const toggleSelect = async () => {
    if (!match) return;
    const next = !match.selected;
    setMatch({ ...match, selected: next });
    try { await api.updateSelection([match.id], next); } catch {}
  };

  if (loading || !match || match.id !== id) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  // sort markets in each family by probability (lowest odd first = most probable)
  const families = MARKET_FAMILIES.map((fam) => {
    const items = fam.keys.map((k) => ({
      key: k,
      label: ODD_LABELS[k],
      value: match.odds[k] as number | undefined,
      estimated: (match.odds.estimated || []).includes(k),
    })).filter((x) => x.value != null);
    // Order is canonical (1, X, 2 / 1X, X2, 12 / U, O / GG, NG) — no sort
    // Find the index of the MOST PROBABLE market (lowest odd) to highlight with star
    let topIdx = -1;
    let minVal = Infinity;
    items.forEach((it, i) => {
      if (typeof it.value === "number" && it.value < minVal) {
        minVal = it.value;
        topIdx = i;
      }
    });
    return { name: fam.name, items, topIdx };
  });

  // Il mercato del VERDETTO mostrato, scritto dal blocco del verdetto (che si
  // valuta prima nello stesso render) e letto dal RANKING STRUTTURALE per
  // mettere "Rotto da" solo sulla riga del pick (round 2, TICKET 1).
  let pickVerdetto: string | null = null;

  // Legenda delle due fonti dei numeri (round 2, TICKET 1): una stima del
  // motore e una misura sulle partite concluse non devono sembrare la stessa cosa.
  const apriLegendaFonti = () => confirmAction({
    title: "DA DOVE VENGONO I NUMERI",
    message: "«Poisson» = probabilità STIMATA dal motore con le quote di questa partita: è un calcolo, non una misura.\n\n«in archivio (vinte/totale)» = quante volte il mercato è uscito DAVVERO nelle partite concluse dello stesso tipo. Il numero fra parentesi dice su quante partite: più è grande, più la percentuale è affidabile.",
    confirmText: "Ho capito",
    cancelText: "Chiudi",
    onConfirm: () => {},
  });

  // IL CONSIGLIATO e tutte le giocate col perche' (07/10/2026): stessa regola
  // della multipla (analizzaGiocate in api.ts).
  const analisi: AnalisiGiocate | null = (() => {
    const st = structural?.structure;
    if (!match || !st) return null;
    const pr = lettura?.programma ?? null;
    const nota = getScenarioNote(match.odds, st);
    const totAtteso = (pr?.forma_casa != null ? (st.lambda_home + pr.forma_casa) / 2 : st.lambda_home)
      + (pr?.forma_ospite != null ? (st.lambda_away + pr.forma_ospite) / 2 : st.lambda_away);
    try {
      return analizzaGiocate({
        odds: match.odds as any, marketOdds: structural?.market_odds,
        ranking: (structural?.ranking || []).map((r) => ({ market: r.market, coverage: r.coverage })),
        voci: nota && tabella ? tabella.scenari[chiaveScenario(nota)] : null,
        manuali: nota?.markets || [], totAtteso,
        direzione: letturaGol(st.lambda_home, st.lambda_away).direzione,
        casa: match.squadra1, ospite: match.squadra2,
        pesataCasa: pr?.pesata_casa, pesataOspite: pr?.pesata_ospite, accordo: pr?.accordo ?? null,
        assentiCasa: pr?.assenti_casa ?? 0, assentiOspite: pr?.assenti_ospite ?? 0,
        scenario: nota?.scenario ?? null,
        coppaEuropea: /^(EUCHL|EUEL|EUCONFL)/.test(String(match.manifestazione || "").toUpperCase()),
        // Come favoritaNonPerde() del server (letturaPartita.ts, 15/10/2026)
        favNonPerde: (() => {
          const l = lettura?.pro?.risultati_probabili?.length ? lettura.pro : lettura?.ai;
          const ris = (l?.risultati_probabili || []).map((r) => String(r).replace(/\s/g, "").split("-").map(Number)).filter((r) => r.length === 2 && r.every(Number.isFinite));
          const q1 = Number(match.odds?.odd_1), q2 = Number(match.odds?.odd_2);
          if (ris.length !== 3 || !(q1 > 1 && q2 > 1) || q1 === q2) return false;
          return ris.every((r) => (q1 < q2 ? r[0] >= r[1] : r[1] >= r[0]));
        })(),
        // Come consigliatoDi() del server (19/10/2026): i 3 risultati attesi della valutazione AI.
        risultatiAI: (lettura?.pro?.risultati_probabili?.length && !lettura.pro_vecchia ? lettura.pro : lettura?.ai)?.risultati_probabili ?? null,
        direzioneAI: (lettura?.pro?.risultati_probabili?.length && !lettura.pro_vecchia ? lettura.pro : lettura?.ai)?.direzione ?? null,
        // Come xoggDaAI() del server (16/10/2026): X oppure GG proposto dall'AI con risultati coerenti.
        xoggAI: (() => {
          const l = lettura?.pro as any;
          if (!l?.mercato || !/^x\s+(oppure|o)\s+gg$/i.test(String(l.mercato).trim())) return false;
          const ris = (l.risultati_probabili || []).map((r: string) => String(r).replace(/\s/g, "").split("-").map(Number)).filter((r: number[]) => r.length === 2 && r.every(Number.isFinite));
          return ris.length === 3 && ris.every(([c, o]: number[]) => c === o || (c > 0 && o > 0));
        })(),
      });
    } catch {
      return null;
    }
  })();

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity testID="back-btn" onPress={() => router.canGoBack() ? router.back() : router.replace("/")} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{match.manifestazione}</Text>
        <TouchableOpacity testID="toggle-sel" onPress={toggleSelect} style={styles.iconBtn}>
          <Ionicons name={match.selected ? "checkmark-circle" : "ellipse-outline"} size={22}
            color={match.selected ? colors.primary : colors.textMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 96 }]} {...scrollMem}>
        {/* Match hero */}
        <View style={styles.hero}>
          <Text style={styles.heroDay}>{match.day} · {match.time}</Text>
          <Text style={styles.team}>{match.squadra1}</Text>
          <Text style={styles.vs}>vs</Text>
          <Text style={styles.team}>{match.squadra2}</Text>
          <TouchableOpacity onPress={faiPro} activeOpacity={0.7} style={styles.proBtn} disabled={proInCorso}>
            <Ionicons name="sparkles" size={14} color="#000" />
            <Text style={styles.proBtnTxt}>{proInCorso ? "Pronostico AI in corso…" : "Pronostico AI"}</Text>
          </TouchableOpacity>
          {match.result && (
            <View style={styles.resultBox}>
              <Text style={styles.resultLbl}>RISULTATO</Text>
              <Text style={styles.resultVal}>{match.result}</Text>
            </View>
          )}
        </View>

        {/* ============ LA SCHEDA DELLA SCELTA (19/10/2026 sera, Rossi): "nome della partita, sotto il
            pronostico scelto, sotto lo scenario e la descrizione del perche' e' stato scelto, sotto il perche'
            si' e il perche' no di tutti i pronostici; il dossier dell'AI con i risultati previsti e il suo
            pronostico in fondo". La scelta e' il consigliato salvato (lo stesso di Schedina e multipla),
            fatto con il percorso: scenario -> AI -> AI e book allineati -> ripiego -> da lasciare. Tutto il
            resto della scheda e' in "Dettagli tecnici". ============ */}
        {(() => {
          const cs = cosaGiocare;
          const per = cs?.percorso ?? null;
          const note = getScenarioNote(match.odds, structural?.structure);
          const q2 = (x: number) => x.toFixed(2).replace(".", ",");
          const pc = (p: number) => `${Math.round(p * 100)}%`;
          const scelta = cs?.market ?? null;
          const nomeScelta = cs?.nome || (scelta ? scelta.replace(/\bcasa\b/gi, match.squadra1).replace(/\bospite\b/gi, match.squadra2) : null);
          const vinto = match.result && scelta ? evaluateMarketOutcome(scelta, match.result) : null;
          const ai = lettura?.pro && !lettura.pro_vecchia ? lettura.pro : lettura?.ai ?? null;
          const aiPro = !!(lettura?.pro && !lettura.pro_vecchia);
          const nomeModello = (m: string) => m.replace(" (OpenRouter)", "").replace(/^[^:]+:\s*/, "").replace(/\s*\(free\)/i, "");
          const iniziata = !!match.result || (inizioRegole !== null && inizioRegole <= Date.now());
          const proposta = ai ? String((ai as any).giocata || ai.mercato || "").trim() : "";
          const titolo = (t: string) => <Text style={[styles.scenarioNoteTitle, { marginTop: 14 }]}>{t}</Text>;
          return (
            <View style={styles.scenarioNoteBox}>
              <Text style={styles.scenarioNoteTitle}>{`${match.squadra1} – ${match.squadra2}`}</Text>

              <Text style={[styles.scenarioNoteSub, { marginTop: 10 }]}>{cs?.rifatto ? "PRONOSTICO (RIFATTO CON IL PERCORSO)" : iniziata ? "PRONOSTICO (PRIMA DEL VIA)" : "PRONOSTICO"}</Text>
              {scelta ? (
                <Text style={{ color: vinto === true ? colors.success : vinto === false ? colors.danger : colors.text, fontSize: 22, fontWeight: "900", marginTop: 2 }}>
                  {`${nomeScelta}${cs?.quota != null ? `  @${q2(cs.quota)}` : ""}${vinto === true ? "  ✓" : vinto === false ? "  ✗" : ""}`}
                </Text>
              ) : (
                <Text style={{ color: colors.textMuted, fontSize: 22, fontWeight: "900", marginTop: 2 }}>{cs ? "DA LASCIARE" : "IN ATTESA DEL DOSSIER"}</Text>
              )}
              {scelta && cs?.coerenza ? (
                <Text style={[styles.golTesto, { color: colors.success }]}>
                  {`Book ${cs.coerenza.book ? "✓" : "✗"} · AI ${cs.coerenza.ai == null ? "–" : cs.coerenza.ai ? "✓" : "✗"} · Storico ${cs.coerenza.storico == null ? "–" : cs.coerenza.storico ? "✓" : "✗"}`}
                </Text>
              ) : null}

              <Text style={[styles.scenarioNoteSub, { marginTop: 10 }]}>
                {note ? `Scenario: ${note.scenario.toUpperCase()}${note.favorita ? ` · favorita ${note.favorita === "1" ? match.squadra1 : match.squadra2} a ${q2(Number(note.favorita === "1" ? match.odds.odd_1 : match.odds.odd_2))}` : ""}${per?.ripiego ? " · RIPIEGO" : ""}` : "Scenario: quote 1X2 mancanti"}
              </Text>

              {/* PALETTI DELLE QUOTE (21/10/2026, Rossi): prima le quote, cosa e' logico e cosa no
                  (zona d'oro 1,40-1,70 e allineamento con le altre quote), poi dossier e AI nel PERCHÉ. */}
              {cs?.paletti ? (() => {
                const pl = cs.paletti!;
                const codici = new Set((per?.voci || []).map((v) => v.codice));
                const lista = pl.mercati.filter((x) => !codici.size || codici.has(x.codice));
                const nomeP = (c: string) => c.replace(/\bcasa\b/gi, match.squadra1).replace(/\bospite\b/gi, match.squadra2)
                  .replace(/^O(\d)\.5$/, "Over $1,5").replace(/^U(\d)\.5$/, "Under $1,5").replace("GG + O2.5", "GG + Over 2,5").replace("X oppure GG", "X o GG");
                const statoTxt = (s: string) => s === "in_linea" ? "allineata" : s === "protetta" ? "protetta (il book l'ha abbassata)" : s === "lasciata_alta" ? "lasciata alta (il book non ci crede)" : "stimata: non verificabile";
                return (
                  <>
                    {titolo("PALETTI DELLE QUOTE")}
                    {pl.righe.slice(0, 3).map((r, i) => <Text key={`pr${i}`} style={styles.golTesto}>{r}</Text>)}
                    <Text style={styles.golTesto}>{`Gol totali (${pl.gol.fonte === "sisal" ? "scala Sisal" : "dalle quote del file"}): ${pl.gol.distribuzione.map((d) => `${d.gol} ${pc(d.p)}`).join(" · ")}`}</Text>
                    {lista.map((x, i) => (
                      <Text key={`pm${i}`} style={[styles.golTesto, { color: x.logica ? colors.success : x.stato === "lasciata_alta" ? colors.danger : x.stato === "protetta" ? colors.primary : colors.textMuted }]}>
                        {`${x.logica ? "✓" : x.inZona ? "⚠" : "·"} ${nomeP(x.codice)} @${q2(x.quota!)}${x.stimata ? "*" : ""} · ${x.inZona ? "zona d'oro" : "fuori zona"} · ${statoTxt(x.stato)}${x.quotaCoerente ? ` · coerente ~${q2(x.quotaCoerente)}` : ""}`}
                      </Text>
                    ))}
                    {pl.anomalie.map((a, i) => <Text key={`pa${i}`} style={[styles.golTesto, styles.golAvviso]}>{`⚠ ${a}`}</Text>)}
                    {pl.esatti.length ? (
                      <Text style={styles.golTesto}>{`Risultati esatti Sisal: ${pl.esatti.slice(0, 6).map((e) => `${e.ris} @${q2(e.quota)}${e.stato === "protetta" ? " (protetto)" : e.stato === "lasciata_alta" ? " (alto)" : ""}`).join(" · ")}`}</Text>
                    ) : null}
                    {pl.incroci.map((s, i) => <Text key={`pi${i}`} style={[styles.golTesto, styles.golAvviso]}>{`↔ ${s}`}</Text>)}
                    <Text style={styles.golPic}>{"✓ in zona e allineata · ⚠ in zona ma fuori linea · coerente = la quota che avrebbe secondo le altre quote · * = stimata"}</Text>
                  </>
                );
              })() : null}

              {titolo("PERCHÉ")}
              {per ? per.passi.map((p, i) => (
                <Text key={i} style={styles.golTesto}><Text style={{ fontWeight: "800" }}>{`${i + 1}. ${p.titolo}. `}</Text>{p.testo}</Text>
              )) : (
                <Text style={styles.golPic}>{!cs ? "Il dossier della partita non è ancora pronto." : cs.perche ? `${cs.perche} (calcolato con le regole di prima: si rifà alla prossima lettura)` : "Calcolato con le regole di prima: si rifà alla prossima lettura."}</Text>
              )}

              {per?.voci?.length ? (
                <>
                  {titolo("PERCHÉ SÌ / PERCHÉ NO")}
                  {per.voci.map((v, i) => {
                    const su = v.codice === scelta;
                    const col = su ? colors.primary : v.regge ? colors.success : colors.textMuted;
                    return (
                      <View key={i} style={{ marginTop: 8 }}>
                        <Text style={[styles.golTesto, { color: col, fontWeight: "800", marginTop: 0 }]}>
                          {`${su ? "★" : v.regge ? "✓" : "✗"} ${v.nome}${v.quota ? ` @${q2(v.quota)}${v.stimata ? "*" : ""}` : ""}  ·  ${v.gruppo === "ripiego" ? (per.ripiego ? "ripiego" : "ripiego (non serve)") : "scenario"}`}
                        </Text>
                        <Text style={styles.golPic}>
                          {`Book ${v.book ? "✓" : "✗"} · AI ${v.viteAI == null ? "–" : `${v.viteAI} su 3`} · storico ${v.pStorico != null ? pc(v.pStorico) : "–"}${v.pCampionato != null ? ` · campionato ${pc(v.pCampionato)}` : ""}${v.pMedia != null ? ` · media ${pc(v.pMedia)}` : ""}`}
                        </Text>
                        {v.squadre ? (
                          <Text style={styles.golPic}>
                            {`Ultime 5: ${[v.squadre.casa ? `${match.squadra1} ${v.squadre.casa.vinte} su ${v.squadre.casa.su}` : null, v.squadre.ospite ? `${match.squadra2} ${v.squadre.ospite.vinte} su ${v.squadre.ospite.su}` : null].filter(Boolean).join(" · ")}`}
                          </Text>
                        ) : null}
                        {v.perche ? <Text style={styles.golPic}>{`Perché: ${v.perche}`}</Text> : null}
                        {!v.regge && v.manca ? <Text style={styles.golPic}>{`Non regge: ${v.manca}`}</Text> : null}
                      </View>
                    );
                  })}
                  <Text style={[styles.golPic, { marginTop: 6 }]}>* quota stimata</Text>
                </>
              ) : null}

              {titolo(ai ? `DOSSIER AI · ${aiPro ? "Pronostico AI" : "gratis"} (${nomeModello(ai.modello)})` : "DOSSIER AI")}
              {ai ? (
                <>
                  <Text style={styles.golTesto}>{`Risultati previsti: ${conQuotaSisal(ai.risultati_probabili || []) || "n/d"}`}</Text>
                  {match?.quote_sisal ? <Text style={styles.golPic}>{`Quote Sisal lette il ${new Date(match.quote_sisal.at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} (${match.quote_sisal.mercati} mercati): multigol, combo e risultati esatti sono quote vere. * = stimata.`}</Text> : null}
                  <Text style={styles.golTesto}>{`Pronostico dell'AI: ${proposta || "nessuno"}`}</Text>
                  <Text style={styles.golTesto}>{`Direzione: ${ai.direzione === "1" ? match.squadra1 : ai.direzione === "2" ? match.squadra2 : "nessun vincitore chiaro"}`}</Text>
                  {ai.notizia ? <Text style={[styles.golTesto, styles.golAvviso]}>{`Notizia: ${ai.notizia}`}</Text> : null}
                  {ai.come_stanno ? <Text style={styles.golTesto}>{`Come stanno: ${ai.come_stanno}`}</Text> : null}
                  {ai.ragionamento?.book ? <Text style={styles.golTesto}>{`Il book: ${ai.ragionamento.book}`}</Text> : null}
                  {ai.ragionamento?.direzione ? <Text style={styles.golTesto}>{`Direzione: ${ai.ragionamento.direzione}`}</Text> : null}
                  {ai.ragionamento?.segnano ? <Text style={styles.golTesto}>{`Chi segna e chi prende gol: ${ai.ragionamento.segnano}`}</Text> : null}
                  {ai.ragionamento?.scelta ? <Text style={styles.golTesto}>{`La sua scelta: ${ai.ragionamento.scelta}`}</Text> : null}
                  {ai.lettura ? <Text style={styles.golTesto}>{ai.lettura}</Text> : null}
                </>
              ) : <Text style={styles.golPic}>{letturaInCorso ? "La valutazione AI sta arrivando…" : "Non ancora disponibile."}</Text>}
              {iniziata && !ai?.ragionamento ? (
                <TouchableOpacity onPress={leggiComePrima} activeOpacity={0.7} disabled={rifaiInCorso}
                  style={{ marginTop: 8, alignSelf: "flex-start", paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.primary }}>
                  <Text style={{ color: "#000", fontWeight: "800" }}>{rifaiInCorso ? "L'AI sta leggendo (30-60 secondi)…" : "Leggila con l'AI come prima del via"}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          );
        })()}

        <TouchableOpacity onPress={() => setTecnici((v) => !v)} activeOpacity={0.7} style={{ flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginTop: 12 }}>
          <Ionicons name={tecnici ? "chevron-down" : "chevron-forward"} size={16} color={colors.textMuted} />
          <Text style={[styles.scenarioNoteSub, { marginLeft: 4 }]}>{tecnici ? "Chiudi i dettagli tecnici" : "Dettagli tecnici (consigliato d'archivio, classifiche, verdetto, statistiche)"}</Text>
        </TouchableOpacity>

        {tecnici ? (<>
        {/* ============ COSA GIOCARE: UN UNICO PRONOSTICO (15/10/2026 sera, Rossi: "un unico
            pronostico, che puo' variare solo se la IA lo fa variare") ============
            Il consigliato salvato: lo stesso di elenco, Schedina, multipla e bot. Resta anche a partita
            iniziata o finita (e' quello di prima del via). Il pallino: probabilita' d'archivio x quota
            (verde = quota con margine, giallo = nessun vantaggio, rosso = quota bassa per il rischio). */}
        {cosaGiocare ? (() => {
          const cs = cosaGiocare;
          const q2 = (x: number) => x.toFixed(2).replace(".", ",");
          const nomeMk = (mk: string) => mk.replace(/\bcasa\b/gi, match.squadra1).replace(/\bospite\b/gi, match.squadra2);
          const spiega = (mk: string) => ({ "1": `vince ${match.squadra1}`, "2": `vince ${match.squadra2}`, X: "pareggio", "1X": `${match.squadra1} non perde`, X2: `${match.squadra2} non perde`, "12": "non finisce pari", GG: "segnano tutte e due", NG: "almeno una non segna", "X oppure GG": "pareggio o segnano tutte e due" } as Record<string, string>)[mk.trim()] ?? null;
          const p = cs.pA != null && cs.pA > 0 ? Math.min(cs.pA, cs.pB ?? cs.pA) : null;
          const conv = p != null && cs.quota != null ? p * cs.quota : null;
          const col = conv === null ? colors.textDim : conv >= 1 ? colors.success : conv >= 0.95 ? colors.warning : colors.danger;
          const nomeSem = conv === null ? "" : conv >= 1 ? "VERDE" : conv >= 0.95 ? "GIALLO" : "ROSSO";
          const pro = lettura?.pro && !lettura.pro_vecchia ? lettura.pro : null;
          const nomeModello = (m: string) => m.replace(" (OpenRouter)", "").replace(/^[^:]+:\s*/, "").replace(/\s*\(free\)/i, "");
          const iniziata = !!match.result || (inizioRegole !== null && inizioRegole <= Date.now());
          return (
            <View style={{ marginHorizontal: 16, marginTop: 12, padding: 14, borderRadius: 14, borderWidth: 2, borderColor: col, backgroundColor: colors.card }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: "800", letterSpacing: 0.6 }}>{iniziata ? "PRONOSTICO (PRIMA DEL VIA)" : "PRONOSTICO"}</Text>
                {nomeSem ? (
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: col, marginRight: 6 }} />
                    <Text style={{ color: col, fontSize: 12, fontWeight: "800" }}>{nomeSem}</Text>
                  </View>
                ) : null}
              </View>
              {cs.market ? (
                <Text style={{ color: colors.text, fontSize: 22, fontWeight: "900", marginTop: 6 }}>
                  {cs.nome || nomeMk(cs.market)}{spiega(cs.market) ? <Text style={{ color: colors.textMuted, fontSize: 14, fontWeight: "600" }}>{`  (${spiega(cs.market)})`}</Text> : null}
                  {cs.quota != null ? <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800" }}>{`   @${q2(cs.quota)}${cs.stimata ? "*" : ""}`}</Text> : null}
                </Text>
              ) : (
                <View>
                  <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800", marginTop: 6 }}>Nessuna giocata da 1,40 con questi numeri</Text>
                  {/* Il perche' (16/10/2026, Rossi: "perche' non valuta GG, Over?"): le migliori da 1,40 e il motivo dello scarto. */}
                  {(analisi?.righe ?? [])
                    .filter((r) => r.quota >= 1.4 && (r.misurata || r.stima != null))
                    .sort((x, y) => (y.misurata ? Math.min(y.misurata.pA, y.misurata.pB) : y.stima ?? 0) - (x.misurata ? Math.min(x.misurata.pA, x.misurata.pB) : x.stima ?? 0))
                    .slice(0, 4)
                    .map((r, i) => (
                      <Text key={i} style={{ color: colors.textMuted, fontSize: 13, marginTop: 4 }}>
                        {`✗ ${r.nome || nomeMk(r.market)} @${q2(r.quota)}${r.stimata ? "*" : ""}`}
                        <Text style={{ color: colors.textDim }}>{` — ${r.misurata ? `archivio ${Math.round(Math.min(r.misurata.pA, r.misurata.pB) * 100)}%` : `stima ${Math.round((r.stima ?? 0) * 100)}%`}: ${r.perche ?? ""}`}</Text>
                      </Text>
                    ))}
                </View>
              )}
              {cs.market && p != null && conv !== null ? (
                <Text style={{ color: colors.text, fontSize: 14, marginTop: 8, fontWeight: "700" }}>
                  {`Vince ${(p * 10).toFixed(1).replace(".", ",").replace(",0", "")} volte su 10 · a ${q2(cs.quota!)} ne servono ${(10 / cs.quota!).toFixed(1).replace(".", ",")}`}
                  {cs.n ? <Text style={{ color: colors.textDim, fontSize: 12, fontWeight: "600" }}>{`\n(archivio: ${cs.n} partite simili)`}</Text> : null}
                  <Text style={{ color: col, fontWeight: "800" }}>
                    {conv >= 1 ? "\n→ quota con margine" : conv >= 0.95 ? "\n→ va bene in multipla, nessun vantaggio" : "\n→ quota bassa per il rischio"}
                  </Text>
                </Text>
              ) : null}
              {cs.market && cs.perche && cs.ai !== "cambiato" ? (
                <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 6 }}>{`Perché: ${cs.perche.charAt(0).toUpperCase()}${cs.perche.slice(1).replace(/\.$/, "")}`}</Text>
              ) : null}
              {(cs.avvisi ?? []).map((a, i) => (
                <Text key={i} style={{ color: colors.warning, fontSize: 13, marginTop: 4 }}>{`⚠ ${a}`}</Text>
              ))}
              {cs.ai === "cambiato" ? (
                <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 8 }}>{`🤖 Cambiato dall'AI${cs.notizia ? `: ${cs.notizia}` : ""}`}</Text>
              ) : pro ? (
                <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 8 }}>{`🤖 Pronostico AI (${nomeModello(pro.modello)}): confermato`}</Text>
              ) : null}
              {cs.stimata ? <Text style={{ color: colors.textDim, fontSize: 11, marginTop: 2 }}>* quota stimata: controllala sul bookmaker</Text> : null}
            </View>
          );
        })() : null}

        {/* ============ SCENARIO (sempre aperto; 15/10/2026: percentuali alla quota di QUESTA
            partita dalla tabella scenari, non la media di tutte le quote, che per il 2 a 1,60
            del Leverkusen diceva 70% invece di ~60%) ============ */}
        {(() => {
          const note = getScenarioNote(match.odds, structural?.structure);
          if (!note) return null;
          const voci = tabella?.scenari?.[chiaveScenario(note)];
          const forma = regole?.avvisi.find((a) => a.startsWith("forma: "));
          return (
            <View style={styles.scenarioNoteBox}>
              <Text style={styles.scenarioNoteTitle}>SCENARIO: {note.scenario.toUpperCase()}</Text>
              {note.avviso ? <Text style={[styles.scenarioNoteMarket, { marginBottom: 4 }]}>{note.avviso}</Text> : null}
              <Text style={styles.scenarioNoteSub}>
                Mercati da considerare, alla quota di questa partita:{tabella || manualeStats ? "" : " (archivio in caricamento…)"}
              </Text>
              <TouchableOpacity testID="legenda-fonti" onPress={apriLegendaFonti} activeOpacity={0.7}>
                <Text style={styles.legendaFonti}>ⓘ «Poisson» o «in archivio»: cosa vuol dire</Text>
              </TouchableOpacity>
              {note.markets.map((m, i) => {
                const q = quotaManuale(m, match.odds as any, structural?.market_odds);
                const f = fasciaDellaQuota(q?.odd);
                const k = normalizeMarket(m.replace(/\s+fisso$/i, ""));
                const v = f !== null ? voci?.[f.toFixed(2)]?.find((t) => normalizeMarket(t.market.replace(/\s+fisso$/i, "")) === k) : undefined;
                const n = v ? v.nA + v.nB : 0;
                const st = manualeStats?.scenari?.[chiaveScenario(note)]?.mercati?.[m];
                const nt = st ? st.vinte + st.perse : 0;
                // Senza misura alla quota di questa partita: la stima (Poisson) di QUESTA partita prima,
                // la media d'archivio di tutte le quote solo come riferimento.
                const stima = analisi?.righe.find((r) => normalizeMarket(r.market.replace(/\s+fisso$/i, "")) === k)?.stima ?? null;
                const misura = v && n > 0
                  ? ` — ${(v.p * 100).toFixed(0)}% in archivio a quote simili (${n} partite)`
                  : `${stima != null ? ` — circa ${(stima * 100).toFixed(0)}% per questa partita` : ""}${st && nt > 0 && st.pct !== null ? ` (archivio ${st.pct.toFixed(0)}%, ma a tutte le quote)` : ""}`;
                const vinto = match.result ? evaluateMarketOutcome(m, match.result) === true : false;
                return (
                  <Text key={i} style={[styles.scenarioNoteMarket, vinto && styles.scenarioNoteMarketVinto]}>
                    • {m}{q ? ` @${q.odd.toFixed(2).replace(".", ",")}` : ""}{misura}{vinto ? " ✓" : ""}
                  </Text>
                );
              })}
              {(() => {
                // CLASSIFICA DELL'EQUILIBRIO (19/10/2026): sotto la nota, chi scegliere prima se e' pagato il minimo.
                const cl = classificaScenario(match.odds, note.scenario, structural?.market_odds as any);
                if (!cl) return null;
                const chi = cl.tipo === "gap"
                  ? `favorita ${cl.direzione === "casa" ? match.squadra1 : match.squadra2} ${cl.fasciaFavorita}`
                  : cl.direzione === "casa" ? `${match.squadra1} avanti` : cl.direzione === "ospite" ? `${match.squadra2} avanti` : "quote 1-2 vicine";
                const nomeMk = (mk: string) => mk.replace(/casa/gi, match.squadra1).replace(/ospite/gi, match.squadra2);
                const qf = (x: number) => x.toFixed(2).replace(".", ",");
                return (
                  <View style={{ marginTop: 10 }}>
                    <Text style={styles.scenarioNoteTitle}>CLASSIFICA DELLO SCENARIO</Text>
                    <Text style={styles.scenarioNoteSub}>{`Over 3,5 ${cl.fascia} · ${chi} · ${cl.partite} partite in archivio${cl.partite < 60 ? " (poche)" : ""}`}</Text>
                    {cl.voci.map((v, i) => {
                      const vinto = match.result ? evaluateMarketOutcome(v.codice, match.result) === true : false;
                      const stato = v.daEvitare ? "da evitare"
                        : v.pagata === null ? `serve almeno ${qf(v.quotaMinima)}, controlla la quota`
                        : `serve almeno ${qf(v.quotaMinima)}, qui ${v.stimata ? "*" : ""}${qf(v.quota!)} ${v.pagata ? (v.quota! < 1.4 ? "ma sotto 1,40" : "✓") : "✗ pagata poco"}`;
                      return (
                        <Text key={v.mercato} style={[styles.scenarioNoteMarket, vinto && styles.scenarioNoteMarketVinto, v.daEvitare && { opacity: 0.5 }]}>
                          {`${i + 1}. ${nomeMk(v.mercato)} ${v.pct}% · ${stato}${vinto ? " ✓" : ""}`}
                        </Text>
                      );
                    })}
                    <Text style={[styles.scenarioNoteMarket, { marginTop: 4 }]}>
                      {cl.tipo === "gap" ? `Solo da leggere: nel Gap la classifica non decide il pronostico (in archivio scegliere "il primo pagato il minimo" perdeva il 6%).` : cl.scelta ? `Da scegliere: ${nomeMk(cl.scelta)} (il primo pagato almeno il minimo)` : "Nessun mercato è pagato il minimo: meglio lasciarla, o X oppure GG se il bookmaker lo paga abbastanza."}
                    </Text>
                    {cl.voci.some((v) => v.stimata) ? <Text style={styles.scenarioNoteSub}>* quota stimata dall'app: controllala sul bookmaker.</Text> : null}
                  </View>
                );
              })()}
              {forma ? <Text style={[styles.scenarioNoteSub, { marginTop: 6 }]}>{`Forma: ${forma.slice(7)}`}</Text> : null}
            </View>
          );
        })()}

        {/* ============ LETTURA AI (sempre aperta): la gratis c'e' sempre; il Pronostico AI (a pagamento)
            si aggiunge sopra, non la sostituisce (16/10/2026, Rossi). ============ */}
        {(() => {
          const nomeModello = (m: string) => m.replace(" (OpenRouter)", "").replace(/^[^:]+:\s*/, "").replace(/\s*\(free\)/i, "");
          const blocco = (l: any, titolo: string, vecchia: boolean, nota: string) => (
            <>
              <Text style={styles.golTitolo}>{titolo}</Text>
              {l.risultati_probabili?.length ? (
                <Text style={styles.golTesto}>Risultati probabili: <Text style={{ fontWeight: "900" }}>{conQuotaSisal(l.risultati_probabili)}</Text></Text>
              ) : null}
              <Text style={styles.golTesto}>
                {`Direzione: ${l.direzione === "1" ? match.squadra1 : l.direzione === "2" ? match.squadra2 : l.direzione ? "nessun vincitore" : "–"} · gol: ${match.squadra1} ${l.gol_casa} · ${match.squadra2} ${l.gol_ospite} · totale ${l.gol_totali}`}
              </Text>
              {l.mercato ? <Text style={styles.golTesto}>{`Giocata proposta: ${l.mercato}`}</Text> : null}
              {l.lettura ? <Text style={styles.golTesto}>{l.lettura}</Text> : null}
              {l.notizia ? (
                <Text style={[styles.golTesto, styles.golAvviso]}>{`Notizia: ${l.notizia}${l.notizia_verificata ? " (verificata nei dati)" : ""}`}</Text>
              ) : (
                <Text style={styles.golPic}>Nessuna notizia particolare trovata.</Text>
              )}
              {vecchia ? <Text style={styles.golPic}>{nota}</Text> : null}
            </>
          );
          return (
            <View style={[styles.golBox, { marginTop: 12 }]}>
              {lettura?.pro ? (
                <View style={{ marginBottom: 12 }}>
                  {blocco(lettura.pro, `PRONOSTICO AI · ${nomeModello(lettura.pro.modello)}`, !!lettura.pro_vecchia, "Fatto con quote diverse da quelle di adesso.")}
                </View>
              ) : null}
              {lettura?.ai ? blocco(lettura.ai, `LETTURA AI · ${nomeModello(lettura.ai.modello)} (gratis)`, !!lettura.ai_vecchia, "Fatta con le quote di prima: si rifà da sola.") : (
                <>
                  <Text style={styles.golTitolo}>LETTURA AI (gratis)</Text>
                  <Text style={styles.golPic}>
                    {letturaInCorso ? "La lettura AI sta arrivando…" : "Lettura AI gratis non disponibile: partita già iniziata, oppure modelli gratis occupati."}
                  </Text>
                </>
              )}
            </View>
          );
        })()}

        {/* DETTAGLI (15/10/2026): consigliato d'archivio e lettura completa del programma. */}
        <TouchableOpacity onPress={() => setDettagli((x) => !x)} activeOpacity={0.7} style={styles.approfBtn}>
          <Ionicons name={mostraDettagli ? "chevron-down" : "chevron-forward"} size={16} color={colors.textMuted} />
          <Text style={styles.approfTxt}>
            {mostraDettagli ? "Chiudi i dettagli" : "Dettagli: consigliato d'archivio, forma, gol attesi"}
          </Text>
        </TouchableOpacity>

        {/* ============ IL CONSIGLIATO (07/10/2026, Rossi) ============
            "Punterei dove tutti i dati sono d'accordo e la percentuale e'
            misurata, e lascerei le partite incerte." Indipendente dalla fascia
            (sempre da 1,40 in su). Il Pronostico AI lo conferma o lo cambia
            solo con una notizia verificata. */}
        {mostraDettagli && (lettura?.consigliato || (analisi && lettura)) ? (() => {
          // Il consigliato SALVATO vince su quello ricalcolato qui: deve essere
          // lo stesso di schedina e multipla, e non cambiare a ogni apertura.
          const salvato = lettura?.consigliato;
          const rigaSalvata = (salvato?.market && analisi)
            ? analisi.righe.find((r) => normalizeMarket(r.market) === normalizeMarket(salvato.market!))
            : undefined;
          const c = salvato
            ? (rigaSalvata ?? (salvato.daLasciare ? null : (salvato.market ? {
                nome: salvato.nome || salvato.market,
                market: salvato.market,
                quota: salvato.quota ?? 0,
                stimata: salvato.stimata ?? false,
                misurata: (salvato.pA != null && salvato.pB != null && salvato.n != null)
                  ? { pA: salvato.pA, pB: salvato.pB, n: salvato.n }
                  : null,
                stima: null,
              } : (analisi?.consigliato ?? null))))
            : (analisi?.consigliato ?? null);
          const pc = (x: number) => `${Math.round(x * 100)}%`;
          const pro = lettura?.pro && !lettura.pro_vecchia ? lettura.pro : null;

          // Valutazione proposta AI con mercatoAIValido (Incarico 2)
          let cambiato = false;
          let mercatoCambiato: string | null = null;
          let quotaCambiato: number | null = null;
          let stimataCambiato = false;
          let notiziaCambiato: string | null = null;
          let tradottoDaCambiato: string | null = null;
          let scartata: { mercato: string; motivo: string } | null = (salvato as any)?.proposta_scartata ?? null;

          if (pro?.notizia_verificata && pro.mercato) {
            const val = mercatoAIValido(pro.mercato, analisi || structural?.market_odds, analisi?.manuali, pro.risultati_probabili);
            if (val.ok && val.market && val.quota != null) {
              // Il consigliato salvato e' gia' la giocata dell'AI (ai "cambiato"):
              // resta un cambio, non una conferma (Ajax-Nec, 11/10/2026: diceva
              // "Tutti i dati d'accordo · Confermato dal Pronostico AI").
              if (!c || normalizeMarket(val.market) !== normalizeMarket(c.market) || salvato?.ai === "cambiato") {
                cambiato = true;
                mercatoCambiato = val.market;
                quotaCambiato = val.quota;
                stimataCambiato = val.stimata;
                notiziaCambiato = pro.notizia || null;
                tradottoDaCambiato = val.tradotto_da || null;
                scartata = null;
              }
            } else if (val.motivo === "fuori scala" && salvato?.ai === "cambiato" && salvato.market) {
              // Proposta sotto 1,40 o sopra il tetto: il server e' salito alla
              // giocata piu' solida coerente con la lettura dell'AI
              // (salitaDaProposta, 13/10/2026). "Contro i risultati": scartata.
              cambiato = true;
              mercatoCambiato = salvato.market;
              quotaCambiato = salvato.quota ?? null;
              stimataCambiato = !!salvato.stimata;
              notiziaCambiato = salvato.notizia || pro.notizia || null;
              tradottoDaCambiato = (salvato as any)?.tradotto_da || null;
              scartata = null;
            } else {
              scartata = { mercato: pro.mercato, motivo: val.motivo || "non ammesso" };
            }
          } else if (salvato?.ai === "cambiato" && salvato.market) {
            cambiato = true;
            mercatoCambiato = salvato.market;
            quotaCambiato = salvato.quota ?? null;
            stimataCambiato = !!salvato.stimata;
            notiziaCambiato = salvato.notizia || null;
            tradottoDaCambiato = (salvato as any)?.tradotto_da || null;
          }

          const perche = analisi ? [
            ...analisi.righe.filter((r) => !r.consigliato && r.quota >= 1.4 && (r.misurata || /GG/.test(r.market))).slice(0, 2),
            ...analisi.righe.filter((r) => !r.consigliato && r.quota < 1.4 && r.quota >= 1.15).slice(-1),
          ] : [];
          const frase = (() => {
            const pr = lettura?.programma;
            if (!pr?.pesata_casa || !pr?.pesata_ospite) return "";
            const forte = pr.pesata_casa.fatti >= pr.pesata_ospite.fatti
              ? { n: match.squadra1, a: match.squadra2, f: pr.pesata_casa.fatti, s: pr.pesata_ospite.subiti }
              : { n: match.squadra2, a: match.squadra1, f: pr.pesata_ospite.fatti, s: pr.pesata_ospite.subiti };
            const n1 = (v: number) => v.toFixed(1).replace(".", ",");
            return `${forte.n} fa ${n1(forte.f)} gol contro squadre come ${forte.a}, ${forte.a} ne prende ${n1(forte.s)}.`;
          })();
          const avvisiList = analisi?.avvisi ?? salvato?.avvisi ?? [];
          // A partita finita, l'esito accanto alla giocata (Ajax-Nec 1-1, 11/10/2026:
          // qui c'era "1 + U4.5" senza esito e il VINTO verde piu' in basso era del
          // verdetto DC 1X + GG, che sembrava riferito a questa).
          const esito = (m: string) => {
            const e = match.result ? evaluateMarketOutcome(m, match.result) : null;
            return e === true ? <Text style={{ color: colors.success, fontWeight: "900" }}>{"  ✓ VINTA"}</Text>
              : e === false ? <Text style={{ color: colors.danger, fontWeight: "900" }}>{"  ✗ PERSA"}</Text> : null;
          };
          const numeriMarket = salvato?.ai === "cambiato" ? (salvato as any).numeri_market as string | undefined : (c && cambiato ? c.market : undefined);
          const numeriNome = salvato?.ai === "cambiato" ? ((salvato as any).numeri_nome as string | undefined) ?? numeriMarket : c?.nome;
          const numeriQuota = salvato?.ai === "cambiato" ? (salvato as any).numeri_quota as number | undefined : c?.quota;
          return (
            <View style={styles.consBox}>
              <Text style={styles.consLbl}>IL CONSIGLIATO</Text>
              {(() => {
                // DA GIOCARE (11/10/2026): una riga sola, con la regola e il perche'.
                const g = daGiocare(cambiato && mercatoCambiato
                  ? { market: mercatoCambiato, nome: mercatoCambiato, quota: quotaCambiato, stimata: stimataCambiato, ai: "cambiato",
                      numeri_market: numeriMarket ?? null, numeri_nome: numeriNome ?? null, numeri_quota: numeriQuota ?? null }
                  : c ? { market: c.market, nome: c.nome, quota: c.quota, stimata: c.stimata, ai: pro && !scartata ? "confermato" : null, proposta_scartata: scartata }
                  : null);
                if (!g) return null;
                const nome = g.nome.replace(/\bcasa\b/gi, match.squadra1).replace(/\bospite\b/gi, match.squadra2);
                return (
                  <View style={{ borderWidth: 2, borderColor: colors.success, borderRadius: 10, padding: 10, marginTop: 6, marginBottom: 8, backgroundColor: "rgba(16,185,129,0.10)" }}>
                    <Text style={{ color: colors.success, fontWeight: "900", fontSize: 12, letterSpacing: 1 }}>▶ DA GIOCARE</Text>
                    <Text style={styles.consVal}>
                      {nome}
                      {g.quota != null ? <Text style={{ fontSize: 15, color: colors.textMuted }}>{` ${g.stimata ? "*" : "@"}${g.quota.toFixed(2)}`}</Text> : null}
                      {esito(g.market)}
                    </Text>
                    <Text style={styles.consMeta}>{`Perché: ${g.perche}.`}</Text>
                  </View>
                );
              })()}
              {cambiato && mercatoCambiato ? (
                <>
                  <Text style={styles.consVal}>{mercatoCambiato.replace(/\bcasa\b/gi, match.squadra1).replace(/\bospite\b/gi, match.squadra2)}{esito(mercatoCambiato)}</Text>
                  {quotaCambiato != null && (
                    <Text style={styles.consMeta}>
                      {`${stimataCambiato ? "*" : "@"} ${quotaCambiato.toFixed(2)} · proposta AI`}
                    </Text>
                  )}
                  <Text style={styles.consAvviso}>{`Cambiato dal Pronostico AI per: ${notiziaCambiato || "notizia verificata"}`}</Text>
                  {numeriMarket ? (
                    <Text style={styles.consMeta}>
                      {`Dai numeri era: ${(numeriNome || numeriMarket).replace(/\bcasa\b/gi, match.squadra1).replace(/\bospite\b/gi, match.squadra2)}${numeriQuota ? ` @ ${Number(numeriQuota).toFixed(2)}` : ""}`}
                      {esito(numeriMarket)}
                    </Text>
                  ) : null}
                  {tradottoDaCambiato ? (
                    <Text style={styles.consMeta}>{`Tradotto da proposta AI: «${tradottoDaCambiato}»`}</Text>
                  ) : null}
                </>
              ) : c ? (
                <>
                  <Text style={styles.consVal}>{c.nome}{esito(c.market)}</Text>
                  <Text style={styles.consMeta}>
                    {`${c.stimata ? "*" : "@"} ${c.quota.toFixed(2)}${c.misurata ? ` · ${pc(c.misurata.pA)} / ${pc(c.misurata.pB)} in archivio (${c.misurata.n} partite)` : c.stima != null ? ` · ~${pc(c.stima)} stima` : ""}`}
                  </Text>
                  {frase ? <Text style={styles.consTesto}>{`Tutti i dati d'accordo. ${frase}`}</Text> : null}
                  {scartata ? (
                    <Text style={styles.consAvviso}>{`⚠ Proposta AI scartata: ${scartata.motivo} («${scartata.mercato}»)`}</Text>
                  ) : null}
                  {avvisiList.map((v: string) => <Text key={v} style={styles.consAvviso}>{`⚠ ${v.charAt(0).toUpperCase()}${v.slice(1)}.`}</Text>)}
                  {perche.length ? (
                    <Text style={styles.consPic}>{"Perché non: " + perche.map((r) => `${r.nome} (${r.perche.replace(/\.$/, "")})`).join(" · ")}</Text>
                  ) : null}
                  {pro && !scartata ? <Text style={styles.consOk}>{`✓ Confermato dal Pronostico AI (${pro.modello.replace(" (OpenRouter)", "")})`}</Text> : null}
                </>
              ) : (salvato?.daLasciare ?? analisi?.daLasciare) ? (
                <>
                  <Text style={styles.consVal}>Da lasciare</Text>
                  <Text style={styles.consAvviso}>{`Motivo: ${salvato?.daLasciare ?? analisi?.daLasciare}. Se vuoi giocarla lo stesso, guarda "Punta su questo" più sotto o il Pronostico AI.`}</Text>
                  {scartata ? (
                    <Text style={styles.consAvviso}>{`⚠ Proposta AI scartata: ${scartata.motivo} («${scartata.mercato}»)`}</Text>
                  ) : null}
                </>
              ) : (
                <>
                  <Text style={styles.consVal}>Nessuna giocata sicura</Text>
                  <Text style={styles.consPic}>{"Nessun mercato da 1,40 in su con percentuale misurata e stabile per questo scenario. Le migliori e perché non vanno:"}</Text>
                  {/* Il motivo vero (15/10/2026, Lech-Leverkusen: "Nessuna giocata sicura" senza dire perche'). */}
                  {(analisi?.righe ?? []).filter((r) => r.quota >= 1.4 && r.quota <= 2 && (r.misurata || r.stima != null)).slice(0, 4).map((r) => (
                    <Text key={r.market} style={styles.consPic}>{`• ${r.nome} @${r.quota.toFixed(2)}: ${r.perche}`}</Text>
                  ))}
                  {scartata ? (
                    <Text style={styles.consAvviso}>{`⚠ Proposta AI scartata: ${scartata.motivo} («${scartata.mercato}»)`}</Text>
                  ) : null}
                </>
              )}
            </View>
          );
        })() : null}

        {/* ============ LA LETTURA (07/10/2026, Rossi) ============
            Come la lettura fatta a mano su Moldova-Slovacchia: chi e' favorita,
            chi segna e chi prende contro avversari di QUESTO livello (forma
            pesata, lib/letturaProgramma.ts), gol che ci aspettiamo e risultati
            piu' vicini (Poisson su quote e forma pesata, a meta'), poi la
            lettura dell'AI gratis. Le medie semplici delle ultime 5 restano in
            piccolo: da sole ingannavano (Slovacchia "prende 2,0" per le
            trasferte contro squadre forti). */}
        {mostraDettagli && structural?.structure && (() => {
          const s = structural.structure;
          const pr = lettura?.programma ?? null;
          const lc = pr?.forma_casa != null ? (s.lambda_home + pr.forma_casa) / 2 : s.lambda_home;
          const lo = pr?.forma_ospite != null ? (s.lambda_away + pr.forma_ospite) / 2 : s.lambda_away;
          const L = letturaGol(lc, lo, forma);
          const Lq = letturaGol(s.lambda_home, s.lambda_away, forma);
          const pc = (x: number) => `${Math.round(x * 100)}%`;
          const n1 = (x: number | null | undefined) => (x == null ? "–" : x.toFixed(1).replace(".", ","));
          const rg = (r: [number, number]) => (r[0] === r[1] ? `${r[0]}` : `${r[0]}-${r[1]}`);
          const ic = intervalloGol(lc), io = intervalloGol(lo);
          // Frasi semplici, dai numeri.
          const frasi: { t: string; avviso?: boolean }[] = [];
          if (Lq.direzione) {
            const fav = Lq.direzione === "1" ? match.squadra1 : match.squadra2;
            const q = Lq.direzione === "1" ? match.odds?.odd_1 : match.odds?.odd_2;
            const p = Lq.direzione === "1" ? Lq.p1 : Lq.p2;
            frasi.push({ t: `${fav} favorita${p >= 0.65 ? " netta" : ""} (${Lq.direzione} a ${q ? Number(q).toFixed(2) : "n/d"}).` });
          } else {
            frasi.push({ t: "Nessuna favorita netta: si gioca sui gol." });
          }
          const descrivi = (nome: string, contro: string, w: { fatti: number; subiti: number } | null | undefined) => {
            if (!w) return;
            const att = w.fatti < 0.9 ? "segna poco" : w.fatti >= 1.6 ? "segna con continuità" : "segna nella media";
            const dif = w.subiti <= 0.8 ? "prende pochi gol" : w.subiti >= 1.5 ? "prende gol facilmente" : "prende qualche gol";
            frasi.push({ t: `${nome} ${att} e ${dif} contro squadre come ${contro} (fa ${n1(w.fatti)}, prende ${n1(w.subiti)}).` });
          };
          descrivi(match.squadra1, match.squadra2, pr?.pesata_casa);
          descrivi(match.squadra2, match.squadra1, pr?.pesata_ospite);
          if (pr?.accordo === true) frasi.push({ t: "Forma e quote sono d'accordo ✓" });
          else if (pr?.accordo === false) frasi.push({ t: `Forma e quote NON sono d'accordo: ${pr.motivi.join("; ")}. Valgono le quote: in questi casi la favorita delle quote vince più spesso del previsto.`, avviso: true });
          const ass: string[] = [];
          if ((pr?.assenti_casa ?? 0) >= 3) ass.push(`${match.squadra1} con ${pr!.assenti_casa} assenti`);
          if ((pr?.assenti_ospite ?? 0) >= 3) ass.push(`${match.squadra2} con ${pr!.assenti_ospite} assenti`);
          if (ass.length) frasi.push({ t: `Assenze pesanti: ${ass.join("; ")}.`, avviso: true });
          const piccolo = (f: FormaGol["casa"] | undefined, sede: string) => !f ? null : (
            <>
              <Text style={styles.golPic}>{`Ultime ${f.totale.n}: fa ${n1(f.totale.fatti)} · prende ${n1(f.totale.subiti)} · ${sede}: fa ${n1(f.sede.fatti)} · prende ${n1(f.sede.subiti)}`}</Text>
              <Text style={styles.golPic}>
                {f.totale.partite.map((x) => `${x.fatti > x.subiti ? "V" : x.fatti === x.subiti ? "N" : "P"} ${x.fatti}-${x.subiti}`).join(" · ")}
              </Text>
            </>
          );
          const nomeModello = (m: string) => m.replace(" (OpenRouter)", "").replace(/^[^:]+:\s*/, "").replace(/\s*\(free\)/i, "");
          return (
            <View style={styles.golBox}>
              <Text style={styles.golTitolo}>LA LETTURA</Text>
              {frasi.map((f, i) => (
                <Text key={i} style={[styles.golTesto, f.avviso && styles.golAvviso]}>{f.avviso ? "⚠ " : "• "}{f.t}</Text>
              ))}
              <Text style={styles.golSez}>GOL CHE CI ASPETTIAMO</Text>
              <Text style={styles.golTesto}>
                {match.squadra1} <Text style={{ fontWeight: "900" }}>{rg(ic)}</Text>{" · "}
                {match.squadra2} <Text style={{ fontWeight: "900" }}>{rg(io)}</Text>{" · "}
                totale <Text style={{ fontWeight: "900" }}>{L.golDa}-{L.golA}</Text>
              </Text>
              <Text style={styles.golTesto}>
                Risultati più vicini: <Text style={{ fontWeight: "900" }}>{L.risultati.slice(0, 4).map((r) => `${r.casa}-${r.ospite}`).join(" · ")}</Text>
              </Text>
              <Text style={styles.golPic}>{`${n1(L.totale)} gol attesi (quote e forma pesata; il totale cade nella forchetta nel ${pc(L.pFascia)} dei casi)`}</Text>
              <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
                {[
                  { nome: match.squadra1, w: pr?.pesata_casa, f: forma?.casa, sede: "in casa", contro: match.squadra2 },
                  { nome: match.squadra2, w: pr?.pesata_ospite, f: forma?.ospite, sede: "fuori", contro: match.squadra1 },
                ].map((q) => (
                  <View key={q.nome} style={styles.golSquadra}>
                    <Text style={styles.golTesta} numberOfLines={1}>{q.nome}</Text>
                    {q.w ? (
                      <>
                        <Text style={styles.golNum}>Fa <Text style={styles.golNumB}>{n1(q.w.fatti)}</Text> · prende <Text style={styles.golNumB}>{n1(q.w.subiti)}</Text></Text>
                        <Text style={styles.golPic}>{`contro squadre come ${q.contro}`}</Text>
                      </>
                    ) : null}
                    {piccolo(q.f, q.sede)}
                    {!q.w && !q.f ? <Text style={styles.golPic}>Ultime partite non trovate su FotMob.</Text> : null}
                  </View>
                ))}
              </View>
              {pr?.accordo === false && !lettura?.pro ? (
                <Text style={[styles.golTesto, styles.golAvviso]}>{"⚠ Forma e quote non concordano: il Pronostico AI può dire se c'è una notizia che spiega la differenza (tasto in alto)."}</Text>
              ) : null}
              {lettura?.pro ? (
                <View style={styles.letturaAI}>
                  <Text style={styles.golSez}>{`PRONOSTICO AI · ${nomeModello(lettura.pro.modello)}`}</Text>
                  {lettura.pro_vecchia ? (
                    <Text style={[styles.golTesto, styles.golAvviso]}>{"Fatto con quote diverse da quelle di adesso: rifallo se vuoi."}</Text>
                  ) : null}
                  <Text style={styles.golTesto}>{lettura.pro.lettura}</Text>
                  <Text style={styles.golTesto}>
                    {`Gol: ${match.squadra1} ${lettura.pro.gol_casa} · ${match.squadra2} ${lettura.pro.gol_ospite} · totale ${lettura.pro.gol_totali}`}
                  </Text>
                  {lettura.pro.risultati_probabili?.length ? (
                    <Text style={styles.golTesto}>{`Risultati più vicini: ${conQuotaSisal(lettura.pro.risultati_probabili)}`}</Text>
                  ) : null}
                  {lettura.pro.notizia ? (
                    <Text style={[styles.golTesto, styles.golAvviso]}>
                      {`Notizia: ${lettura.pro.notizia}${lettura.pro.notizia_verificata ? " (verificata nei dati)" : ""}`}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              {lettura?.ai ? (
                <View style={styles.letturaAI}>
                  <Text style={styles.golSez}>{`LETTURA AI · ${nomeModello(lettura.ai.modello)} (gratis)`}</Text>
                  <Text style={styles.golTesto}>{lettura.ai.lettura}</Text>
                  <Text style={styles.golTesto}>
                    {`Gol: ${match.squadra1} ${lettura.ai.gol_casa} · ${match.squadra2} ${lettura.ai.gol_ospite} · totale ${lettura.ai.gol_totali}`}
                  </Text>
                  {lettura.ai.risultati_probabili?.length ? (
                    <Text style={styles.golTesto}>{`Risultati più vicini: ${conQuotaSisal(lettura.ai.risultati_probabili)}`}</Text>
                  ) : null}
                  {lettura.ai_vecchia ? <Text style={styles.golPic}>{"Fatta con le quote di prima: si rifà da sola."}</Text> : null}
                  {lettura.ai.notizia ? <Text style={[styles.golTesto, styles.golAvviso]}>{`Notizia: ${lettura.ai.notizia}`}</Text> : null}
                </View>
              ) : (
                <Text style={styles.golPic}>
                  {letturaInCorso
                    ? "La lettura AI (gratis) sta arrivando…"
                    : "Lettura AI gratis non disponibile: partita già iniziata, oppure modelli gratis occupati. Puoi usare il Pronostico AI in alto."}
                </Text>
              )}
            </View>
          );
        })()}

        {/* ALTRE FASCE DI QUOTA (11/10/2026, Rossi: "manda tanta confusione"): in
            cima resta solo il consigliato; "Punta su questo" e il verdetto per
            fascia si aprono qui, per chi vuole giocare a 1.50 / 1.60 / 1.75. */}
        <TouchableOpacity onPress={() => setAltreFasce((x) => !x)} activeOpacity={0.7} style={styles.approfBtn}>
          <Ionicons name={altreFasce ? "chevron-down" : "chevron-forward"} size={16} color={colors.textMuted} />
          <Text style={styles.approfTxt}>
            {altreFasce ? "Chiudi il pronostico per fascia" : "Pronostico per fascia di quota (1.40 / 1.50 / 1.60 / 1.75)"}
          </Text>
        </TouchableOpacity>
        {/* ============ IL CONSIGLIO DELL'AI (01/10/2026, Rossi) ============
            Fra scenario e verdetto: il mercato su cui l'AI punterebbe di piu'
            per QUESTA partita, a qualunque quota e fascia ("il consiglio di un
            amico"). Solo dopo "Genera pronostico AI" e solo se generato PRIMA
            del calcio d'inizio. Non cambia il verdetto della fascia scelta. */}
        {altreFasce && (() => {
          const ctxC = { odds: match.odds as any, structural, manuale: manualeFasce };
          // SCELTA B (07/10/2026): senza una notizia verificata "Punta su
          // questo" e' il pick del MOTORE (fusione motore + PRE senza AI, alla
          // Quota minima scelta); il consiglio dell'AI resta sotto come parere.
          // C'e' anche SENZA pronostico AI: e' la conclusione della scheda gol.
          const decideAI = aiDecide(predVerdetto, match);
          // LA GIOCATA MIGLIORE ANCHE FUORI SOGLIA (07/10/2026, Rossi): "se a
          // quella soglia c'e', dimmi quella; se no, dimmi la giocata migliore
          // della partita, indipendentemente dalla soglia". Si prova la Quota
          // minima scelta; se non c'e' niente, le altre fasce, e si prende la
          // piu' probabile.
          type PickMotore = { market: string; odd: number | null; stimata: boolean; prob: number | null; soglia: number; archivio?: number | null; tab?: VoceTabella };
          let mot: PickMotore | null = null;
          // Giocata del Pronostico AI (notizia verificata). Dal 10/10/2026 (Rossi,
          // scelta B) non sostituisce piu' il calcolo dei numeri: si mostra
          // sopra, e sotto restano i numeri della fascia scelta, che cambiano
          // con i selettori 1,40 / 1,50 / 1,60 / 1,75.
          let motAI: PickMotore | null = null;
          // PRIMA LA TABELLA SCENARI (07/10/2026, Rossi): il mercato che in
          // QUESTO scenario e in QUESTA fascia la prende piu' spesso in modo
          // stabile (partite vecchie e recenti), se la sua quota qui sta nella
          // fascia scelta. Altrimenti il secondo o il terzo della tabella, poi
          // il motore come prima.
          const notaT = getScenarioNote(match.odds, structural?.structure);
          // Gol attesi della lettura (quote e forma pesata a meta'): il consiglio
          // non puo' andare contro (Croazia-Spagna: 3,7 attesi e MG 1-3 proposto).
          const prL = lettura?.programma ?? null;
          const stL = structural?.structure;
          const totAtteso = stL
            ? (prL?.forma_casa != null ? (stL.lambda_home + prL.forma_casa) / 2 : stL.lambda_home)
              + (prL?.forma_ospite != null ? (stL.lambda_away + prL.forma_ospite) / 2 : stL.lambda_away)
            : null;
          // La notizia VERIFICATA del Pronostico AI (modello scelto) decide,
          // con quote ancora uguali a quelle con cui e' stato fatto.
          const proDecide = !!lettura?.pro?.notizia_verificata && !!lettura.pro.mercato && !lettura.pro_vecchia;
          const perScenario = notaT && tabella ? tabella.scenari[chiaveScenario(notaT)] || {} : {};
          // I mercati della tabella per una fascia, con la quota di QUESTA partita
          // dentro la fascia. Sicuri = almeno 55% e coerenti con i gol attesi
          // (Croazia-Spagna a 1,75: MG 1-3 totali al 46-48% contro 3,7 gol attesi).
          const candidatiTabella = (soglia: number, sicuri: boolean): PickMotore[] => {
            const out: PickMotore[] = [];
            const visti = new Set<string>();
            for (const voce of perScenario[soglia.toFixed(2)] || []) {
              // "2" e "2 fisso" (manuale) sono lo stesso mercato.
              const chiave = normalizeMarket(voce.market.replace(/\s+fisso$/i, ""));
              if (visti.has(chiave)) continue;
              visti.add(chiave);
              if (sicuri && (voce.p < 0.55 || !coerenteConGol(voce.market, totAtteso))) continue;
              const vp = valutaPuntaSu(voce.market, ctxC);
              const qm = vp?.odd != null ? { odd: vp.odd, stimata: vp.stimata } : quotaManuale(voce.market, match.odds, structural?.market_odds);
              if (!qm || fasciaDellaQuota(qm.odd) !== soglia) continue;
              out.push({ market: voce.market, odd: qm.odd, stimata: qm.stimata, prob: voce.p, soglia, archivio: null, tab: voce });
            }
            return out;
          };
          const daTabella = (soglia: number): PickMotore | null => candidatiTabella(soglia, true)[0] ?? null;
          // "MG 2-4 ospite" -> "MG 2-4 Spagna" (Rossi, 07/10/2026).
          const nomeM = (m: string) => m.replace(/\bcasa\b/gi, match.squadra1).replace(/\bospite\b/gi, match.squadra2);
          // A partita finita, l'esito accanto alla giocata della fascia (11/10/2026).
          const esitoP = (m: string) => {
            const e = match.result ? evaluateMarketOutcome(m, match.result) : null;
            return e === true ? <Text style={{ color: colors.success, fontWeight: "900" }}>{"  ✓ VINTA"}</Text>
              : e === false ? <Text style={{ color: colors.danger, fontWeight: "900" }}>{"  ✗ PERSA"}</Text> : null;
          };
          const pcT = (x: number) => `${Math.round(x * 100)}%`;
          if (proDecide && lettura?.pro?.mercato) {
            const v = mercatoAIValido(lettura.pro.mercato, analisi || structural?.market_odds, undefined, lettura.pro.risultati_probabili);
            if (v.ok && v.market && v.quota != null) {
              const vp = valutaPuntaSu(v.market, ctxC);
              motAI = { market: v.market, odd: v.quota, stimata: v.stimata, prob: vp?.prob ?? null, soglia: minOdd, archivio: null };
            }
          }
          if (!decideAI && !mot) {
            mot = daTabella(minOdd);
            // Niente nella fascia scelta: la migliore della tabella nelle altre fasce.
            if (!mot) {
              mot = FASCE_AI.filter((f) => Math.abs(f - minOdd) > 0.001).map(daTabella)
                .filter((x): x is PickMotore => !!x)
                .sort((x, y) => (y.tab?.p ?? 0) - (x.tab?.p ?? 0))[0] ?? null;
            }
          }
          if (!decideAI && structural?.structure && !mot) {
            const famM = structural.pre_ranking?.length
              ? structural.pre_ranking.map((x) => ({ market: x.market, odd: x.odd, family: "" }))
              : quickPredictionFamily(match.odds);
            const ingM = fusioneInIngresso(structural, famM, []);
            const preM = rankPicks(ingM.pre, [], marketStats);
            // COERENTE CON LA LETTURA (07/10/2026, Rossi): se la scheda dice
            // "nessuna direzione, si gioca sui gol", il consiglio non puo' essere
            // un 1X o un 1; con direzione 1 niente mercati sul 2 e viceversa.
            const dirL = letturaGol(structural.structure.lambda_home, structural.structure.lambda_away).direzione;
            const m0 = (m: string) => m.trim().toUpperCase().replace(/^DC\s+/, "");
            const versoCasa = (m: string) => /^(1|1X)(\s|$|\+)/.test(m0(m)) || /^1 (DNB|AH)/.test(m0(m));
            const versoOspite = (m: string) => /^(2|X2)(\s|$|\+)/.test(m0(m)) || /^2 (DNB|AH)/.test(m0(m));
            // "X oppure GG" NON e' un segno: e' il mercato della partita senza direzione.
            const conSegno = (m: string) => versoCasa(m) || versoOspite(m) || /^(X|12)(\s*\+|$)/.test(m0(m));
            const coerente = (m: string) => dirL === null ? !conSegno(m) : dirL === "1" ? !versoOspite(m) : !versoCasa(m);
            const motoreA = (soglia: number): PickMotore | null => {
              const manS = candidatiManuale(match.odds, manualeStats?.scenari, soglia, structural.market_odds, false, structural.structure);
              const v = buildFinalVerdict(ingM.structural, preM, undefined, match.odds, history, { minOdd: soglia, manuale: manS })
                .filter((x) => ammessoDallaStruttura(x.market, structural.structure) && coerente(x.market))[0];
              if (!v) return null;
              const vp = valutaPuntaSu(v.market, ctxC);
              // Mercato del manuale: conta la misura VERA dell'archivio
              // (es. X oppure GG 62% su 2.446 partite), non la stima Poisson.
              const man = manS.find((c) => normalizeMarket(c.market) === normalizeMarket(v.market));
              return {
                market: v.market, odd: man?.odd ?? vp?.odd ?? v.odd ?? null, stimata: man ? man.stimata : (vp?.stimata ?? !!v.oddEstimated),
                prob: vp?.prob ?? v.coverage ?? null, soglia, archivio: man ? man.pct : null,
              };
            };
            mot = motoreA(minOdd);
            if (!mot) {
              const altre = FASCE_AI.filter((f) => Math.abs(f - minOdd) > 0.001).map(motoreA).filter((x): x is PickMotore => !!x);
              const forza = (x: PickMotore) => (x.archivio != null ? x.archivio / 100 : x.prob ?? 0);
              mot = altre.sort((a, b) => forza(b) - forza(a))[0] ?? null;
            }
            // Ultima riserva: il mercato piu' probabile del catalogo del motore
            // con quota da 1,40 in su, coerente con la lettura e con la struttura.
            if (!mot) {
              const r = (structural.ranking || [])
                .filter((x) => isVerdictMarket(x.market) && coerente(x.market) && ammessoDallaStruttura(x.market, structural.structure))
                .map((x) => ({ x, v: valutaPuntaSu(x.market, ctxC) }))
                .filter(({ v }) => v && v.odd !== null && v.odd >= FASCE_AI[0])
                .sort((a, b) => b.x.coverage - a.x.coverage)[0];
              if (r && r.v) mot = { market: r.x.market, odd: r.v.odd, stimata: r.v.stimata, prob: r.x.coverage, soglia: r.v.fascia ?? FASCE_AI[0] };
            }
          }
          // I numeri della fascia scelta; se decide l'AI, la sua giocata va sopra.
          // LA FASCIA SCELTA PRIMA DI TUTTO (11/10/2026, Rossi): "se ho messo 1,60
          // voglio vedere il pronostico migliore dei numeri che rientra nella
          // fascia 1,60", anche se non e' sicuro, con il triangolo giallo; non la
          // giocata della fascia 1,40. Quella resta nell'avviso come la piu' sicura.
          const migliorePartita = mot;
          // Niente di sicuro in archivio: il mercato PIU' PROBABILE del motore
          // (Poisson) con quota dentro la fascia, 1,75 chiusa a 1,99. Misura del
          // 11/10/2026 su 9.979 partite: il motore e' tarato (dice 55%, vince 56%).
          // Qui niente filtro dei gol attesi (correlazione coi gol veri 0,04).
          const stimaFascia = (): PickMotore | null => {
            const r = (structural?.ranking || [])
              .filter((x) => isVerdictMarket(x.market) && ammessoDallaStruttura(x.market, structural?.structure))
              .map((x) => ({ x, v: valutaPuntaSu(x.market, ctxC) }))
              .filter(({ v }) => v && v.odd !== null && v.odd <= 1.99 && v.fascia === minOdd)
              .sort((a, b) => b.x.coverage - a.x.coverage)[0];
            return r && r.v ? { market: r.x.market, odd: r.v.odd, stimata: r.v.stimata, prob: r.x.coverage, soglia: minOdd } : null;
          };
          const deboleQui = migliorePartita && Math.abs(migliorePartita.soglia - minOdd) > 0.001
            ? stimaFascia() ?? candidatiTabella(minOdd, false)[0] ?? null
            : null;
          const motNumeri = deboleQui ?? migliorePartita;
          mot = motNumeri;
          if (motAI) mot = motAI;
          const fuoriSoglia = !!motNumeri && Math.abs(motNumeri.soglia - minOdd) > 0.001;
          // Le altre giocate buone della stessa fascia (es. a 1,50 anche MG 2-4 Spagna).
          const alternativeT = motNumeri?.tab
            ? candidatiTabella(motNumeri.soglia, true).filter((x) => normalizeMarket(x.market) !== normalizeMarket(motNumeri!.market)).slice(0, 2)
            : [];
          // Alla quota scelta non c'e' niente di sicuro: si mostra lo stesso cosa
          // c'e', con l'allarme. Decide Rossi (07/10/2026).
          const extraT = (
            <>
              {alternativeT.map((a) => (
                <Text key={a.market} style={styles.puntaMeta}>
                  {`Anche: ${nomeM(a.market)} ${a.stimata ? "*" : "@"} ${a.odd?.toFixed(2)} · ${pcT(a.tab!.pA)} / ${pcT(a.tab!.pB)}`}
                </Text>
              ))}
              {deboleQui && migliorePartita ? (
                <Text style={styles.puntaAvviso}>
                  {`⚠ A ${minOdd.toFixed(2)} i numeri non hanno una giocata sicura: ${nomeM(deboleQui.market)} ` +
                    (deboleQui.tab
                      ? `vince solo il ${pcT(deboleQui.tab.pA)} / ${pcT(deboleQui.tab.pB)} in archivio`
                      : `è la più probabile del motore in questa fascia (${deboleQui.prob != null ? pcT(deboleQui.prob) : "?"} Poisson), senza misura in archivio`) +
                    `${coerenteConGol(deboleQui.market, totAtteso) ? "" : " e va contro i gol della lettura"}. Da evitare. ` +
                    `La più sicura della partita: ${nomeM(migliorePartita.market)} ${migliorePartita.stimata ? "*" : "@"} ${migliorePartita.odd?.toFixed(2)} (fascia ${migliorePartita.soglia.toFixed(2)}). Decidi tu.`}
                  {esitoP(migliorePartita.market)}
                </Text>
              ) : null}
            </>
          );
          // La fascia la sceglie Rossi (rischio e guadagno sono suoi): qui, accanto
          // alla giocata, e non solo dentro il verdetto.
          const selettoreFascia = (
            <View style={styles.fasciaRiga}>
              {minOddOptions.map((o) => (
                <TouchableOpacity key={o} onPress={() => changeMinOdd(o)} activeOpacity={0.7}
                  style={[styles.fasciaChip, Math.abs(o - minOdd) < 0.001 && styles.fasciaChipOn]}>
                  <Text style={styles.fasciaChipTxt}>{o.toFixed(2)}{Object.keys(perScenario).length > 0 && !daTabella(o) ? " ⚠" : ""}</Text>
                </TouchableOpacity>
              ))}
            </View>
          );
          const probMot = mot ? (mot.tab ? mot.tab.p : mot.archivio != null ? mot.archivio / 100 : mot.prob) : null;
          const debole = probMot !== null && probMot < PROB_AFFIDABILE;
          const pc0 = (x: number) => `${Math.round(x * 100)}%`;
          const misuraDi = (x: PickMotore | null) => x
            ? x.tab
              ? ` · ${notaT?.scenario ?? "scenario"}: vince il ${pc0(x.tab.pA)} (partite vecchie) e il ${pc0(x.tab.pB)} (recenti) su ${x.tab.nA + x.tab.nB}`
              : (x.archivio != null ? ` · ${x.archivio.toFixed(1).replace(".", ",")}% in archivio` : x.prob !== null ? ` · ${pctProb(x.prob)} Poisson` : "")
            : "";
          const misuraMot = misuraDi(mot);

          // Con l'AI che corregge: la giocata dei numeri della fascia scelta, "prima era".
          const numeriSotto = motAI ? (
            <Text style={styles.puntaMeta}>
              {motNumeri
                ? `Prima era (numeri a ${minOdd.toFixed(2)}): ${nomeM(motNumeri.market)} ${motNumeri.odd !== null ? `${motNumeri.stimata ? "*" : "@"} ${motNumeri.odd.toFixed(2)}` : "quota n/d"}${misuraDi(motNumeri)}`
                : `Prima era (numeri a ${minOdd.toFixed(2)}): nessuna giocata coerente.`}
              {motNumeri ? esitoP(motNumeri.market) : null}
            </Text>
          ) : null;
          // UNA RIGA (11/10/2026, Rossi): prima la giocata dei numeri con il suo
          // esito, poi "/" e la giocata corretta dall'AI con il suo; se l'AI
          // propone la stessa, "confermato".
          const quotaDi = (x: PickMotore) => (x.odd !== null ? ` ${x.stimata ? "*" : "@"}${x.odd.toFixed(2)}` : "");
          const corretto = !!motAI && (!motNumeri || normalizeMarket(motAI.market) !== normalizeMarket(motNumeri.market));
          const stileQuota = { fontSize: 14, fontWeight: "700" as const, color: colors.textMuted };
          const rigaPronostico = (
            <Text style={styles.puntaVal}>
              {motNumeri
                ? <>{nomeM(motNumeri.market)}<Text style={stileQuota}>{quotaDi(motNumeri)}</Text>{esitoP(motNumeri.market)}</>
                : <Text style={stileQuota}>{motAI ? "Numeri: nessuna giocata" : "Nessuna giocata"}</Text>}
              {corretto && motAI
                ? <><Text style={{ color: colors.textMuted }}>{"  /  "}</Text>{nomeM(motAI.market)}<Text style={stileQuota}>{quotaDi(motAI)}</Text>{esitoP(motAI.market)}</>
                : null}
            </Text>
          );
          const metaPronostico = (
            <>
              {motAI ? (
                <Text style={styles.puntaMeta}>{corretto ? "Prima della barra: i numeri · dopo: corretto dal Pronostico AI" : "✓ Confermato dal Pronostico AI"}</Text>
              ) : null}
              {motNumeri ? <Text style={styles.puntaMeta}>{`Numeri a ${minOdd.toFixed(2)}${misuraDi(motNumeri)}`}</Text> : null}
            </>
          );
          const notaFuori = [
            fuoriSoglia && motNumeri ? `Da ${minOdd.toFixed(2)} i numeri non trovano niente di coerente: ${motAI ? "per i numeri" : "questa"} è la giocata migliore della partita (fascia ${motNumeri.soglia.toFixed(2)}).` : "",
            debole ? `Sotto il ${Math.round(PROB_AFFIDABILE * 100)}%: poco affidabile, valuta se lasciare la partita.` : "",
          ].filter(Boolean).join(" ") || null;
          const c = predVerdetto?.main_prediction && predVerdetto.fasce ? valutaPuntaSu(predVerdetto.main_prediction, ctxC) : null;
          if (!c || !predVerdetto) {
            if (!structural) return null;
            return (
              <View style={styles.puntaBox}>
                <Text style={styles.puntaLbl}>{proDecide ? (corretto ? "PRONOSTICO PER FASCIA · CORRETTO DALL'AI" : "PRONOSTICO PER FASCIA · CONFERMATO DALL'AI") : "PRONOSTICO PER FASCIA · DAI NUMERI"}</Text>
                {selettoreFascia}
                {proDecide && lettura?.pro?.notizia ? (
                  <Text style={styles.puntaAvviso}>{`${corretto ? "Corretto" : "Confermato"} dal Pronostico AI per: ${lettura.pro.notizia}`}</Text>
                ) : null}
                {rigaPronostico}
                {metaPronostico}
                {notaFuori ? <Text style={styles.puntaAvviso}>{notaFuori}</Text> : null}
                {extraT}
                <Text style={styles.puntaNota}>
                  {mot
                    ? "Dai numeri: scenario, motore e quote."
                    : "Nessuna giocata coerente in nessuna fascia: partita da lasciare."}
                </Text>
              </View>
            );
          }
          // Il consiglio motivato (pronostici dal 01/10): perche', cosa sa il
          // web, perche' no alle alternative. I pronostici vecchi hanno solo
          // la parte PERCHE' dell'analisi.
          const cons = consiglioDi(predVerdetto);
          const perche = cons?.perche || dividiAnalisi(predVerdetto.analysis).perche;
          // Anche gli altri mercati che l'AI ha proposto per QUESTA partita.
          const proposteAI = [
            ...(predVerdetto.playable_markets || []).map((p) => p.market),
            ...FASCE_AI.flatMap((f) => (predVerdetto.fasce as any)?.[chiaveFascia(f)]?.classifica || []),
          ];
          const alternative = alternativeDelConsiglio(mot ? mot.market : c.market, ctxC, mot ? [c.market, ...proposteAI] : proposteAI);
          const cautela = !decideAI ? null : consiglioDaCautela(c.prob, cons ? cons.web : null, alternative);
          const percheNo = (m: string) =>
            cons?.alternative.find((a) => normalizeMarket(a.mercato) === normalizeMarket(m))?.perche_no || "";
          return (
            <View style={styles.puntaBox}>
              {!decideAI ? (
                <>
                  <Text style={styles.puntaLbl}>{proDecide ? (corretto ? "PRONOSTICO PER FASCIA · CORRETTO DALL'AI" : "PRONOSTICO PER FASCIA · CONFERMATO DALL'AI") : "PRONOSTICO PER FASCIA · DAI NUMERI"}</Text>
                  {selettoreFascia}
                  {proDecide && lettura?.pro?.notizia ? (
                    <Text style={styles.puntaAvviso}>{`${corretto ? "Corretto" : "Confermato"} dal Pronostico AI per: ${lettura.pro.notizia}`}</Text>
                  ) : null}
                  {rigaPronostico}
                  {metaPronostico}
                  {notaFuori ? <Text style={styles.puntaAvviso}>{notaFuori}</Text> : null}
                  {extraT}
                  <Text style={styles.puntaPerche}>
                    {mot
                      ? proDecide ? "Il Pronostico AI ha trovato una notizia vera nei dati che cambia la giocata dei numeri." : "Dai numeri: l'AI non ha notizie che lo cambino."
                      : "Nessuna giocata coerente in nessuna fascia: partita da lasciare. L'AI non ha notizie nuove, quindi non decide lei."}
                  </Text>
                  {!lettura?.pro && (
                  <TouchableOpacity onPress={() => setParereAperto((x) => !x)} activeOpacity={0.7}>
                    <Text style={styles.puntaParere}>
                      {"Parere AI: "}<Text style={{ fontWeight: "900" }}>{c.market}</Text>
                      {c.odd !== null ? ` ${c.stimata ? "*" : "@"} ${c.odd.toFixed(2)}` : ""}
                      {parereAperto ? "  ▾ chiudi" : "  ▸ tocca per i dettagli"}
                    </Text>
                  </TouchableOpacity>
                  )}
                  {parereAperto && cons?.notizia ? (
                    <Text style={styles.puntaPerche}>{`Notizia citata ma non trovata nei dati: "${cons.notizia}"`}</Text>
                  ) : null}
                </>
              ) : (
                <>
                  <Text style={styles.puntaLbl}>{"PUNTA SU QUESTO · SCELTO DALL'AI PER UNA NOTIZIA"}</Text>
                  <Text style={styles.puntaVal}>{c.market}</Text>
                  <Text style={styles.puntaMeta}>
                    {c.odd !== null ? `${c.stimata ? "*" : "@"} ${c.odd.toFixed(2)}` : "quota n/d"}
                    {c.prob !== null ? ` · ${pctProb(c.prob)} Poisson` : ""}
                    {c.fascia !== null ? ` · fascia ${etichettaFascia(c.fascia)}` : ""}
                  </Text>
                  {cons?.notizia ? (
                    <>
                      <Text style={styles.puntaSez}>LA NOTIZIA (verificata nei dati)</Text>
                      <Text style={styles.puntaPerche}>{cons.notizia}</Text>
                    </>
                  ) : null}
                </>
              )}
              {(decideAI || parereAperto) && (
                <>
              {perche ? (
                <>
                  <Text style={styles.puntaSez}>{!decideAI ? `PERCHÉ L'AI PREFERIREBBE ${c.market}` : "PERCHÉ QUESTO"}</Text>
                  <Text style={styles.puntaPerche}>{perche}</Text>
                </>
              ) : null}
              <Text style={styles.puntaSez}>COSA SA IL WEB CHE IL SISTEMA NON SA</Text>
              <Text style={styles.puntaPerche}>
                {cons ? (cons.web || "L'AI non l'ha detto.") : "Pronostico generato prima del consiglio motivato: rigeneralo per vederlo."}
              </Text>
              {alternative.length ? (
                <>
                  <Text style={styles.puntaSez}>LE ALTERNATIVE (numeri del sistema)</Text>
                  {alternative.map((a) => (
                    <View key={a.market} style={styles.altRow}>
                      <Text style={styles.altNome}>
                        {a.market}
                        <Text style={styles.altMeta}>
                          {a.odd !== null ? `  ${a.stimata ? "*" : "@"} ${a.odd.toFixed(2)}` : ""}
                          {a.prob !== null ? ` · ${pctProb(a.prob)} Poisson` : ""}
                          {a.pctManuale !== null ? ` · ${a.pctManuale.toFixed(1).replace(".", ",")}% in archivio` : ""}
                          {a.rankMotore !== null ? ` · motore #${a.rankMotore}` : ""}
                          {` · ${a.motivo}`}
                        </Text>
                      </Text>
                      {percheNo(a.market) ? <Text style={styles.altPercheNo}>Perché no: {percheNo(a.market)}</Text> : null}
                    </View>
                  ))}
                </>
              ) : null}
              {cautela ? (
                <Text style={styles.puntaAvviso}>
                  ⚠ Meno probabile di {cautela.market} ({cautela.prob !== null ? pctProb(cautela.prob) : "?"}) senza un motivo dal web: valuta con cautela.
                </Text>
              ) : null}
              <Text style={styles.puntaNota}>
                {!decideAI
                  ? "Il \"perché\" e il web qui sopra sono il ragionamento dell'AI sul suo parere."
                  : "L'AI ha cambiato la scelta dei numeri per la notizia qui sopra: anche il verdetto qui sotto segue la sua classifica."}
              </Text>
                </>
              )}
              {decideAI && c.problema ? (
                <Text style={styles.puntaAvviso}>⚠ Il controllo lo scarta: {c.problema}. Non può diventare il verdetto.</Text>
              ) : decideAI && c.fascia !== null && Math.abs(c.fascia - minOdd) > 0.001 ? (
                <Text style={styles.puntaAvviso}>
                  Sta nella fascia {etichettaFascia(c.fascia)}: per giocarlo scegli quella fascia qui sotto.
                </Text>
              ) : null}
            </View>
          );
        })()}
        {/* ============ VERDETTO FINALE (fusione 3 sistemi) ============ */}
        {altreFasce ? (
          <TouchableOpacity onPress={() => setVecchioVerdetto((x) => !x)} activeOpacity={0.7} style={styles.approfBtn}>
            <Ionicons name={vecchioVerdetto ? "chevron-down" : "chevron-forward"} size={16} color={colors.textMuted} />
            <Text style={styles.approfTxt}>{vecchioVerdetto ? "Chiudi il vecchio verdetto" : "Vecchio verdetto (fusione motore + PRE): meno preciso, solo per confronto"}</Text>
          </TouchableOpacity>
        ) : null}
        {((el: React.ReactNode) => (altreFasce && vecchioVerdetto ? el : null))((() => {
          if (!structural) return null;
          // FASE 5 — se il backend manda la sua classifica PRE la usiamo: è una
          // sola implementazione invece di due copie da tenere allineate a mano.
          const fam = structural?.pre_ranking?.length
            ? structural.pre_ranking.map((c) => ({ market: c.market, odd: c.odd, family: "" }))
            : quickPredictionFamily(match.odds);
          const llmMarkets = predDecide?.playable_markets?.map((p) => p.market) || (predDecide?.main_prediction ? [predDecide.main_prediction] : []);
          // FILTRO STRUTTURALE IN INGRESSO (Ticket 6): motore e PRE senza i mercati
          // inammissibili PRIMA della fusione, cosi' ordine e "n/3" sono calcolati
          // solo su mercati giocabili. Il filtro piu' sotto resta come formalita'.
          const ingresso = fusioneInIngresso(structural, fam, llmMarkets);
          const preRanked = rankPicks(ingresso.pre, llmMarkets, marketStats);
          // L'AI E' LA REGISTA (01/10/2026): se il pronostico AI ha le fasce, il
          // verdetto e' la sua classifica validata per la fascia della Quota
          // minima; motore e PRE restano come badge di accordo. Senza fasce
          // (pronostici vecchi o nessun pronostico) resta la fusione.
          const daAI = verdettoDaAI(predVerdetto, structural, match.odds, minOdd, match, manualeFasce);
          const verdictRaw = daAI ? daAI.picks : buildFinalVerdict(ingresso.structural, preRanked, predDecide?.playable_markets, match.odds, history, { minOdd, manuale: manualeQui });
          // NIENTE GIOCATA non vuol dire schermata vuota. Prima qui si usciva
          // con `return null` e spariva tutto il riquadro — selettore della
          // quota compreso: l'utente restava senza il comando per abbassare la
          // soglia e sbloccarsi. Ora il riquadro c'e' sempre, con il selettore
          // e la spiegazione al posto della giocata.
          // RICALCOLO STORICO (01/10/2026): per una partita conclusa, cosa dicono
          // le regole di oggi alla Quota minima scelta (salvato dal tasto in
          // Strumenti, in ordine di data, senza sbirciare il futuro).
          const ricQui = match.result ? (match.ricalcolo?.fasce?.[chiaveFascia(minOdd)] ?? null) : null;
          if (verdictRaw.length === 0 && !ricQui) return renderNessunaGiocata();
          // ============================================================
          // FILTRO STRUTTURALE: scarta picks che violano floor/ceiling
          // (es. MG 2-4 con floor=0, MG 1-3 con floor=2-tetto=4, U2.5 con tetto aperto)
          // Manteniamo il PICK migliore CONSENTITO, fallback al primo se filtraggio
          // azzera tutto (caso edge raro).
          // ============================================================
          const violatesFn = (m: string) => !ammessoDallaStruttura(m, structural?.structure);
          const verdictCalcolato = verdictRaw.filter((v) => !violatesFn(v.market));
          if (verdictCalcolato.length === 0 && !ricQui) return renderNessunaGiocata();

          // ============================================================
          // VERDETTO CONGELATO A PARTITA FINITA (28/09/2026)
          //
          // Il riquadro ricalcolava la fusione a OGNI apertura, e fra gli
          // ingredienti del calcolo c'e' lo storico delle famiglie — che, una
          // volta salvato il risultato, contiene anche QUESTA partita. Su una
          // partita al limite, dove due mercati distano un punto, il risultato
          // appena applicato puo' ribaltare l'ordine: ti ritroveresti un
          // "VINTO" appiccicato a un verdetto che il sistema, prima della
          // partita, non ti aveva dato. Un modo silenzioso di sembrare piu'
          // bravi di quanto si e'.
          //
          // Quindi: a risultato presente si mostra `pick_finale`, cioe' quello
          // che il sistema aveva DAVVERO consigliato. Il ricalcolo resta solo
          // per le partite ancora da giocare, dove serve.
          const congelato = !!match.result && !!match.pick_finale;
          // Se il pick congelato non e' fra i ricalcolati si usa un oggetto di
          // riserva senza componenti (score 0 e nessun dettaglio): NON va mostrato
          // come "totale 0.0", che sembrerebbe un errore di calcolo.
          const congelatoSenzaComponenti = congelato
            && !verdictCalcolato.some((v) => normalizeMarket(v.market) === normalizeMarket(match.pick_finale!));
          const verdict = congelato
            ? [
                verdictCalcolato.find((v) => normalizeMarket(v.market) === normalizeMarket(match.pick_finale!))
                  ?? ({
                    market: match.pick_finale!,
                    score: 0, sources: [], ranks: {},
                    coverage: match.pick_finale_prob ?? undefined,
                    concordance: 0, agreementLabel: "divergente",
                    odd: getMarketOdd(match.pick_finale!, match.odds) ?? undefined,
                  } as VerdictPick),
                ...verdictCalcolato.filter((v) => normalizeMarket(v.market) !== normalizeMarket(match.pick_finale!)),
              ]
            : verdictCalcolato;
          // Partita conclusa SENZA congelato ma ricalcolata: il pick mostrato e'
          // quello del ricalcolo (onesto, salvato), non il ricalcolo "vivo" della
          // scheda, che usa lo storico di oggi e quindi conosce gia' il risultato.
          const soloRicalcolo = !congelato && !!ricQui;
          const pickRic: VerdictPick | null = ricQui
            ? ({
                market: ricQui.market, score: 0, sources: [], ranks: {},
                odd: ricQui.odd ?? undefined, oddEstimated: ricQui.stimata,
                coverage: ricQui.prob ?? undefined,
                concordance: 0, agreementLabel: "divergente",
              } as VerdictPick)
            : null;
          const verdictMostrato = soloRicalcolo && pickRic
            ? [pickRic, ...verdict.filter((v) => normalizeMarket(v.market) !== normalizeMarket(pickRic.market))]
            : verdict;
          const top = verdictMostrato[0];
          pickVerdetto = top.market;
          const esitoRic = ricQui?.esito === "vinta" ? "won" : ricQui?.esito === "persa" ? "lost" : null;
          const verdettoDiverso = congelato && !ricQui && !!verdictCalcolato[0]
            && normalizeMarket(verdictCalcolato[0].market) !== normalizeMarket(match.pick_finale!);
          // Alternative ordinate per concordanza DESC, poi score DESC.
          // POI filtrate per coerenza: scartano contraddizioni col PICK e
          // violazioni floor/ceiling (es. MG 2-X se floor=0, U3.5 se tetto aperto)
          // Con la classifica AI l'ordine e' quello dell'AI, non la concordanza.
          const altsRaw = daAI
            ? verdictMostrato.slice(1)
            : verdictMostrato.slice(1).sort((a, b) => (b.concordance - a.concordance) || (b.score - a.score));
          // Se un MG di range e' caduto per il tetto, O2.5 va subito dopo il pick
          // come "lettura gol" (Ticket 6).
          const { alts, letturaGolMarket } = conLetturaGol(
            top, filterCoherentAlternatives(top, altsRaw, structural?.structure, 3), verdictCalcolato, ingresso.letturaGol, 3,
          );
          const cautionWarning = getMatchCautionWarning(match.manifestazione, match.odds);

          const concColor = top.concordance === 3 ? colors.success
            : top.concordance === 2 ? colors.primary : colors.textDim;
          // Nota piccola accanto al pick, non piu' titolo del verdetto (round 2,
          // TICKET 1): su 588 verdetti la concordanza non distingue i vinti dai
          // persi (3/3 = 58,5%, 0/3 = 59,7%). Il numero resta visibile.
          const concLabel = `concordanza ${top.concordance}/3`;

          // Esito del pick col risultato: stessa funzione del resto dell'app
          // (conosce anche AH -0,75, X oppure GG, MG casa/ospite e le combo).
          let pickOutcome: "won" | "lost" | null = null;
          if (match.result) {
            const ok = evaluateMarketOutcome(top.market, match.result);
            if (ok === true) pickOutcome = "won";
            else if (ok === false) pickOutcome = "lost";
          }

          const rankBadges = (p: VerdictPick) => (
            <View style={{ flexDirection: "row", gap: 4, flexWrap: "wrap" }}>
              {p.ranks.structural && (
                <View style={[styles.vSrcBadge, { backgroundColor: colors.aiBg, borderColor: colors.aiText }]}>
                  <Ionicons name="construct" size={9} color={colors.aiText} />
                  <Text style={[styles.vSrcTxt, { color: colors.aiText }]}>STRUTT #{p.ranks.structural}</Text>
                </View>
              )}
              {p.ranks.ai && (
                <View style={[styles.vSrcBadge, { backgroundColor: "rgba(99,102,241,0.15)", borderColor: "#6366F1" }]}>
                  <Ionicons name="sparkles" size={9} color="#6366F1" />
                  <Text style={[styles.vSrcTxt, { color: "#6366F1" }]}>AI #{p.ranks.ai}</Text>
                </View>
              )}
              {p.ranks.pre && (
                <View style={[styles.vSrcBadge, { backgroundColor: "rgba(255,140,0,0.15)", borderColor: colors.primary }]}>
                  <Ionicons name="flash" size={9} color={colors.primary} />
                  <Text style={[styles.vSrcTxt, { color: colors.primary }]}>PRE #{p.ranks.pre}</Text>
                </View>
              )}
            </View>
          );

          return (
            <View style={[
              styles.verdictBlock,
              pickOutcome === "won" && { borderColor: colors.success, borderWidth: 2 },
              pickOutcome === "lost" && { borderColor: colors.danger, borderWidth: 2 },
            ]}>
              <View style={styles.verdictHeader}>
                <Ionicons name="trophy" size={16} color="#FFD700" />
                <Text style={styles.verdictTitle}>VECCHIO VERDETTO</Text>
              </View>
              <Text style={styles.verdictHint}>
                {daAI
                  ? `Classifica dell'AI per la fascia ${daAI.fascia.soglia.toFixed(2)}, controllata da Motore (Poisson) e PRE`
                  : "Fusione pesata di Motore Strutturale (Poisson) + AI + Pre-pronostico locale"}
              </Text>

              {cautionWarning && (
                <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start", backgroundColor: "rgba(245,158,11,0.15)", borderColor: "#F59E0B", borderWidth: 1, borderRadius: 8, padding: 8, marginTop: 6 }}>
                  <Ionicons name="warning" size={14} color="#F59E0B" />
                  <Text style={{ color: "#F59E0B", fontSize: 11, flex: 1 }}>{cautionWarning}</Text>
                </View>
              )}

              {top.ambiguousPair && (
                <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start", backgroundColor: "rgba(245,158,11,0.15)", borderColor: "#F59E0B", borderWidth: 1, borderRadius: 8, padding: 8, marginTop: 6 }}>
                  <Ionicons name="warning" size={14} color="#F59E0B" />
                  <Text style={{ color: "#F59E0B", fontSize: 11, flex: 1 }}>Mercato scelto perché i due migliori candidati sono opposti e troppo vicini per essere affidabili da soli (vedi alternative).</Text>
                </View>
              )}

              {(history?.team_form?.home || history?.team_form?.away) && (
                <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start", backgroundColor: "rgba(59,130,246,0.12)", borderColor: "#3B82F6", borderWidth: 1, borderRadius: 8, padding: 8, marginTop: 6 }}>
                  <Ionicons name="stats-chart" size={14} color="#3B82F6" />
                  <Text style={{ color: "#3B82F6", fontSize: 11, flex: 1 }}>
                    Forma reale (solo informativa, non influenza il pick):{" "}
                    {history?.team_form?.home && `${match.squadra1} in casa: ${history.team_form.home.avg_scored} fatti / ${history.team_form.home.avg_conceded} subiti (${history.team_form.home.matches} partite)`}
                    {history?.team_form?.home && history?.team_form?.away && " · "}
                    {history?.team_form?.away && `${match.squadra2} in trasferta: ${history.team_form.away.avg_scored} fatti / ${history.team_form.away.avg_conceded} subiti (${history.team_form.away.matches} partite)`}
                  </Text>
                </View>
              )}

              {/* Avviso: fino a che soglia conviene spingersi SU QUESTA partita.
                  Non blocca niente — la scelta resta dell'utente — ma dice
                  quando alzare la soglia smette di comprare quota e inizia a
                  comprare solo rischio. */}
              {structural?.soglia_consigliata !== undefined && minOdd > (structural?.soglia_consigliata ?? 0) ? (
                <View style={styles.sogliaWarn}>
                  <Text style={styles.sogliaWarnTitle}>
                    {structural?.soglia_consigliata
                      ? `Su questa partita non conviene superare ${structural.soglia_consigliata.toFixed(2)}`
                      : "Su questa partita nessuna soglia offre un pick solido"}
                  </Text>
                  <Text style={styles.sogliaWarnBody}>
                    {(() => {
                      const d = structural?.soglie_dettaglio?.find((x) => Math.abs(x.soglia - minOdd) < 0.01);
                      return d
                        ? `A ${minOdd.toFixed(2)} il meglio disponibile è ${d.market} al ${d.prob}%.`
                        : `A ${minOdd.toFixed(2)} il meglio disponibile scende sotto il 58%.`;
                    })()}
                    {" "}Oltre il consiglio la riuscita misurata cala dal 59,7% al 55,7%.
                  </Text>
                </View>
              ) : null}

              {/* FASE 2 — soglia di quota minima: la scelta e' dell'utente. Dal
                  11/10/2026 il selettore e' uno solo, nel pronostico per fascia. */}
              <View style={[styles.minOddRow, { display: "none" }]}>
                <Text style={styles.minOddLabel}>Fascia di quota</Text>
                <View style={styles.minOddChips}>
                  {minOddOptions.map((v) => (
                    <TouchableOpacity
                      key={v}
                      onPress={() => changeMinOdd(v)}
                      style={[
                        styles.minOddChip,
                        minOdd === v && styles.minOddChipOn,
                        structural?.soglia_consigliata != null && v > structural.soglia_consigliata && styles.minOddChipOltre,
                      ]}
                    >
                      <Text style={[styles.minOddChipTxt, minOdd === v && styles.minOddChipTxtOn]}>
                        {v.toFixed(2)}
                        {structural?.soglia_consigliata != null && v > structural.soglia_consigliata ? " ⚠" : ""}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <Text style={styles.fasciaNota}>Fascia {etichettaFascia(minOdd)}: il pick è il più probabile fra i mercati con quota dentro questo intervallo.</Text>

              <View style={styles.verdictHero}>
                <View style={styles.verdictMedal}>
                  <Ionicons name="medal" size={22} color="#FFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.verdictLabel}>
                    {congelato ? "VERDETTO DELLA FASCIA (congelato) · non è il consigliato" : soloRicalcolo ? "RICALCOLATA CON LE REGOLE DI OGGI" : "VERDETTO DELLA FASCIA"}
                  </Text>
                  {congelato && !verdettoDiverso && (
                    <Text style={styles.congelatoNota}>
                      Data prima della partita, con le regole e la quota minima di allora: non dipende dalla fascia scelta qui sopra.
                    </Text>
                  )}
                  {verdettoDiverso && (
                    <Text style={styles.congelatoNota}>
                      Ricalcolando adesso uscirebbe {verdictCalcolato[0].market}: lo storico è cambiato
                      perché ora contiene anche questa partita. Qui resta quello che il sistema ti aveva dato prima.
                    </Text>
                  )}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
                    <Text style={styles.verdictMarket}>{top.market}</Text>
                    {top.odd && top.odd > 0 ? (
                      <Text style={styles.verdictOdd}>
                        {top.oddEstimated ? "* " : "@ "}{top.odd.toFixed(2)}
                        {top.oddEstimated ? " (stimata)" : ""}
                      </Text>
                    ) : null}
                    {pickOutcome === "won" && (
                      <View style={[styles.verdictOutcome, { backgroundColor: "rgba(16,185,129,0.20)", borderColor: colors.success }]}>
                        <Ionicons name="checkmark-circle" size={11} color={colors.success} />
                        <Text style={[styles.verdictOutcomeTxt, { color: colors.success }]}>VINTO</Text>
                      </View>
                    )}
                    {pickOutcome === "lost" && (
                      <View style={[styles.verdictOutcome, { backgroundColor: "rgba(239,68,68,0.20)", borderColor: colors.danger }]}>
                        <Ionicons name="close-circle" size={11} color={colors.danger} />
                        <Text style={[styles.verdictOutcomeTxt, { color: colors.danger }]}>PERSO</Text>
                      </View>
                    )}
                  </View>
                  <View style={{ marginTop: 6, flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    {rankBadges(top)}
                    <Text style={[styles.verdictConcMini, { color: concColor }]}>{concLabel}</Text>
                  </View>
                  {top.coverage !== undefined && (
                    <Text style={styles.verdictMeta}>
                      Coverage {Math.round(top.coverage * 100)}% Poisson · Fragility {Math.round((top.fragility || 0) * 100)}%
                    </Text>
                  )}
                </View>
              </View>

              {/* Seconda riga delle partite concluse: cosa dicono le regole di
                  oggi (ricalcolo in ordine di data), verde se indovinato, rosso
                  se sbagliato, accanto al congelato che resta intatto. */}
              {congelato && ricQui && (
                <View style={[
                  styles.ricRow,
                  esitoRic === "won" && { borderColor: colors.success, backgroundColor: "rgba(16,185,129,0.10)" },
                  esitoRic === "lost" && { borderColor: colors.danger, backgroundColor: "rgba(239,68,68,0.10)" },
                ]}>
                  <Text style={styles.ricLbl}>CON LE REGOLE DI OGGI · {chiaveFascia(minOdd)}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Text style={styles.ricMarket}>{ricQui.market}</Text>
                    {ricQui.odd ? <Text style={styles.ricOdd}>{ricQui.stimata ? "*" : "@"} {ricQui.odd.toFixed(2)}</Text> : null}
                    {esitoRic === "won" && <Text style={[styles.ricEsito, { color: colors.success }]}>✓ VINTO</Text>}
                    {esitoRic === "lost" && <Text style={[styles.ricEsito, { color: colors.danger }]}>✗ PERSO</Text>}
                  </View>
                </View>
              )}
              {congelato && !ricQui && match.result && (
                <Text style={styles.ricVuoto}>Regole di oggi: non ancora ricalcolata (Strumenti → Ricalcola tutto).</Text>
              )}

              {/* Il salvato e il ricalcolato possono divergere: la card della
                  Schedina mostra `pick_finale`, cioe' il verdetto fissato in un
                  momento passato, mentre qui il verdetto viene RICALCOLATO a ogni
                  apertura con l'IA e la soglia di adesso. Se nel mezzo e' arrivato
                  il pronostico AI o e' cambiata la soglia, i due numeri non
                  coincidono e finora niente lo diceva. */}
              {match.pick_finale && normalizeMarket(match.pick_finale) !== normalizeMarket(top.market) && (
                <View style={styles.divergenza}>
                  <Ionicons name="sync-outline" size={14} color={colors.warning} />
                  <Text style={styles.divergenzaTxt}>
                    In Schedina era salvato <Text style={{ fontWeight: "900" }}>{match.pick_finale}</Text>: il verdetto è
                    cambiato ed è stato aggiornato ora. Succede quando arriva il pronostico AI o cambi la soglia minima.
                  </Text>
                </View>
              )}

              {/* "Perche' questo pick": il verdetto nasce da una somma di undici
                  correttivi (posizione nei tre sistemi, concordanza, probabilita'
                  reale, storico, penalita' varie). Senza vederli, la scelta e'
                  impossibile da giudicare — ed e' esattamente il motivo per cui
                  un MG 3-6 al posto di un 1 sembrava inspiegabile. */}
              <TouchableOpacity
                testID="verdict-perche"
                onPress={() => setMostraPerche(!mostraPerche)}
                style={styles.percheBtn}
                activeOpacity={0.7}
              >
                <Ionicons name={mostraPerche ? "chevron-down" : "chevron-forward"} size={14} color={colors.textMuted} />
                <Text style={styles.percheBtnTxt}>PERCHÉ QUESTO PICK</Text>
              </TouchableOpacity>

              {mostraPerche && (
                <View style={styles.percheBox}>
                  {[top, ...alts].map((p, idx) => (
                    <View key={`perche-${p.market}-${idx}`} style={idx ? styles.percheAltro : undefined}>
                      {idx === 0 && congelatoSenzaComponenti ? (
                        <>
                          <Text style={styles.percheMercato}>★ {p.market}</Text>
                          <Text style={styles.percheVoce}>Verdetto congelato prima della partita: componenti non salvate.</Text>
                          <Text style={styles.percheVoce}>
                            {p.odd && p.odd > 0 ? `Quota @ ${p.odd.toFixed(2)}` : "Quota non disponibile"}
                            {p.coverage !== undefined ? ` · Copertura ${Math.round(p.coverage * 100)}%` : ""}
                          </Text>
                        </>
                      ) : (<>
                      <Text style={styles.percheMercato}>
                        {idx === 0 ? "★ " : `${idx + 1}. `}{p.market}{p.origine === "ai" ? "" : ` — totale ${Number(p.score).toFixed(1)}`}
                      </Text>
                      {(p.dettaglio || []).map((d, j) => (
                        <View key={j} style={styles.percheRiga}>
                          {p.origine !== "ai" && (
                            <Text style={[styles.perchePunti, { color: d.punti >= 0 ? colors.success : colors.danger }]}>
                              {d.punti > 0 ? "+" : ""}{d.punti}
                            </Text>
                          )}
                          <Text style={styles.percheVoce}>{d.voce}</Text>
                        </View>
                      ))}
                      {!(p.dettaglio || []).length && (
                        <Text style={styles.percheVoce}>Nessun punto registrato per questo mercato.</Text>
                      )}
                      </>)}
                    </View>
                  ))}
                  <Text style={styles.percheNota}>
                    {daAI
                      ? `L'ordine è la classifica dell'AI per la fascia ${daAI.fascia.soglia.toFixed(2)}. Il codice ha tenuto solo i mercati giocabili a questa quota e coerenti con la struttura; motore e PRE indicano solo se sono d'accordo.`
                      : "L'ordine segue la classifica della fusione (quante fonti lo mettono in alto). Il punteggio decide solo fra proposte quasi pari (±5 pt): allora vince la quota più bassa."}
                  </Text>
                </View>
              )}

              {alts.length > 0 && (
                <View style={{ marginTop: 4 }}>
                  <Text style={styles.verdictAltTitle}>{daAI ? "ALTERNATIVE (classifica AI)" : "ALTERNATIVE CONCORDI"}</Text>
                  {alts.map((a, i) => (
                    <View key={`v-${a.market}-${i}`} style={styles.verdictAltRow}>
                      <View style={styles.verdictAltRank}>
                        <Text style={styles.verdictAltRankTxt}>{i + 2}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <Text style={styles.verdictAltMarket}>{a.market}</Text>
                          {letturaGolMarket === a.market && (
                            <Text style={styles.verdictAltNota}>{NOTA_LETTURA_GOL}</Text>
                          )}
                          {a.odd && a.odd > 0 ? <Text style={styles.verdictAltOdd}>@ {a.odd.toFixed(2)}</Text> : null}
                          <Text style={[styles.verdictConcMini, { color: a.concordance === 3 ? colors.success : a.concordance === 2 ? colors.primary : colors.textDim }]}>{a.concordance}/3</Text>
                          {a.vetoed && (
                            <TouchableOpacity
                              onPress={() => confirmAction({
                                title: "SEGNALE STRUTTURALE DEBOLE",
                                message: "Il motore matematico (Poisson) non ha messo questo mercato nella sua top-6, quindi riceve una lieve penalità nel punteggio finale (non un'esclusione). L'AI e/o il Pre-pronostico lo suggeriscono comunque: se qui compare, è perché la concordanza tra i sistemi lo ha comunque portato in classifica.",
                                confirmText: "Ho capito",
                                cancelText: "Chiudi",
                                onConfirm: () => {},
                              })}
                              activeOpacity={0.7}
                            >
                              <View style={styles.vetoTag}>
                                <Ionicons name="warning" size={9} color="#FFF" />
                                <Text style={styles.vetoTxt}>SEGNALE DEBOLE</Text>
                                <Ionicons name="information-circle-outline" size={10} color="#FFF" style={{ marginLeft: 2 }} />
                              </View>
                            </TouchableOpacity>
                          )}
                          {a.ambiguousPair && (
                            <View style={[styles.vetoTag, { backgroundColor: "#F59E0B" }]}>
                              <Ionicons name="swap-horizontal" size={9} color="#FFF" />
                              <Text style={styles.vetoTxt}>OPPOSTO AL PICK</Text>
                            </View>
                          )}
                        </View>
                        <View style={{ marginTop: 4 }}>{rankBadges(a)}</View>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        })())}


        <TouchableOpacity onPress={() => setApprofondisci((x) => !x)} activeOpacity={0.7} style={styles.approfBtn}>
          <Ionicons name={approfondisci ? "chevron-down" : "chevron-forward"} size={16} color={colors.textMuted} />
          <Text style={styles.approfTxt}>
            {approfondisci ? "Chiudi i dettagli" : "Approfondisci: tutte le giocate, struttura, risultati, ranking"}
          </Text>
        </TouchableOpacity>
        {approfondisci && (
          <>
            {/* TUTTE LE GIOCATE (07/10/2026, Rossi): quota, probabilita' e perche'
                si' o perche' no, per ogni mercato della partita. */}
            {analisi ? (
              <View style={styles.tabBox}>
                <Text style={styles.consLbl}>TUTTE LE GIOCATE · PERCHÉ SÌ, PERCHÉ NO</Text>
                <View style={[styles.tabRiga, styles.tabTesta]}>
                  <Text style={[styles.tabC1, styles.tabTestaTxt]}>Giocata</Text>
                  <Text style={[styles.tabC2, styles.tabTestaTxt]}>Quota</Text>
                  <Text style={[styles.tabC3, styles.tabTestaTxt]}>Prob.</Text>
                  <Text style={[styles.tabC4, styles.tabTestaTxt]}>Perché</Text>
                </View>
                {analisi.righe.slice(0, 30).map((r) => (
                  <View key={r.market} style={[styles.tabRiga, r.consigliato && styles.tabRigaCons]}>
                    <Text style={[styles.tabC1, r.consigliato && { fontWeight: "900" }]}>{r.nome}</Text>
                    <Text style={styles.tabC2}>{`${r.stimata ? "*" : ""}${r.quota.toFixed(2)}`}</Text>
                    <Text style={styles.tabC3}>
                      {r.misurata ? `${Math.round(r.misurata.pA * 100)}/${Math.round(r.misurata.pB * 100)}%` : r.stima != null ? `~${Math.round(r.stima * 100)}%` : "–"}
                    </Text>
                    <Text style={styles.tabC4}>
                      {r.consigliato && lettura?.consigliato?.ai === "cambiato"
                        ? r.perche.replace("★ consigliato", "★ scelta dei numeri (poi cambiata dal Pronostico AI)")
                        : r.perche}
                    </Text>
                  </View>
                ))}
                <Text style={styles.golPic}>{"Prob.: \"60/60%\" = misurata in archivio (partite vecchie / recenti); \"~53%\" = stima Poisson di questa partita."}</Text>
              </View>
            ) : null}

        {/* ============ STRUTTURA MATCH (Motore Strutturale) ============ */}
        {structural?.structure && (
          <View style={styles.structBlock}>
            <View style={styles.structHeader}>
              <Ionicons name="construct" size={14} color={colors.aiText} />
              <Text style={styles.structTitle}>STRUTTURA MATCH</Text>
              <View style={styles.structFamilyTag}>
                <Text style={styles.structFamilyTxt}>{structural.structure.family.replace(/_/g, " ")}</Text>
              </View>
            </View>
            <View style={styles.structGrid}>
              <View style={styles.structCell}>
                <Text style={styles.structLbl}>DOMINANZA</Text>
                <Text style={styles.structVal}>{(() => {
                  const d = structural.structure.dominance;
                  if (d === "strong_home") return "🏠 CASA NETTA";
                  if (d === "light_home") return "🏠 casa leggera";
                  if (d === "strong_away") return "✈️ OSPITE NETTA";
                  if (d === "light_away") return "✈️ ospite leggera";
                  return "⚖️ equilibrio";
                })()}</Text>
                <Text style={styles.structSub}>chi è favorito</Text>
              </View>
              <View style={styles.structCell}>
                <Text style={styles.structLbl}>PROFILO</Text>
                <Text style={styles.structVal}>{(() => {
                  const p = structural.structure.offensive_profile;
                  if (p === "reciprocity_high") return "💥 ESPLOSIVA";
                  if (p === "moderate") return "⚽ equilibrata";
                  if (p === "defensive") return "🛡️ DIFENSIVA";
                  return "▫ neutra";
                })()}</Text>
                <Text style={styles.structSub}>stile gol attesi</Text>
              </View>
              <View style={styles.structCell}>
                <Text style={styles.structLbl}>COMPRESSIONE</Text>
                <Text style={styles.structVal}>{(() => {
                  const c = structural.structure.goal_compression;
                  if (c === "high") return "🎯 alta";
                  if (c === "medium") return "📊 media";
                  return "🌐 bassa";
                })()}</Text>
                <Text style={styles.structSub}>quanto è stretto il range</Text>
              </View>
            </View>
            <View style={styles.structGrid}>
              <View style={styles.structCell}>
                <Text style={styles.structLbl}>PAVIMENTO</Text>
                <Text style={styles.structValBig}>{structural.structure.goal_floor}</Text>
                <Text style={styles.structSub}>gol min attesi</Text>
              </View>
              <View style={styles.structCell}>
                <Text style={styles.structLbl}>RANGE</Text>
                <Text style={styles.structValBig}>{structural.structure.goal_range}</Text>
                <Text style={styles.structSub}>gol totali</Text>
              </View>
              <View style={styles.structCell}>
                <Text style={styles.structLbl}>TETTO</Text>
                <Text style={[styles.structValBig, structural.structure.goal_ceiling_open && { color: colors.danger, fontSize: 18 }]}>
                  {structural.structure.goal_ceiling_open ? "APERTO" : structural.structure.goal_ceiling}
                </Text>
                <Text style={styles.structSub}>
                  {structural.structure.goal_ceiling_open ? "no max gol" : "gol max attesi"}
                </Text>
              </View>
            </View>
            <View style={styles.structLambdaRow}>
              <Text style={styles.structSub}>λ Poisson · Casa <Text style={styles.structLambda}>{structural.structure.lambda_home.toFixed(2)}</Text> · Ospite <Text style={styles.structLambda}>{structural.structure.lambda_away.toFixed(2)}</Text></Text>
              {/* xG dal web contro lambda del motore (28/09/2026).
                  I lambda nascono dalle QUOTE, gli xG da come le squadre hanno
                  giocato davvero: quando i due numeri divergono, il confronto
                  dice se il bookmaker sta prezzando una partita piu' aperta o
                  piu' chiusa di quella che il campo ha mostrato.
                  NON entrano nel calcolo: prima si accumulano su partite che poi
                  hanno un risultato, poi si misura se predicono meglio, e solo
                  allora si cambia il motore. */}
              {/* Sopra 4 a partita non e' un xG di una partita: sono i TOTALI del
                  girone ricopiati (Estonia-Islanda 06/10: 3.39 e 6.76 = "10 gol
                  attesi"). Il dossier dal 07/10 li da' a partita. */}
              {typeof prediction?.xg_casa === "number" && typeof prediction?.xg_ospite === "number"
                && prediction.xg_casa <= 4 && prediction.xg_ospite <= 4 && (() => {
                const attesiMotore = structural.structure.lambda_home + structural.structure.lambda_away;
                const attesiWeb = prediction.xg_casa + prediction.xg_ospite;
                const scarto = attesiWeb - attesiMotore;
                const colore = Math.abs(scarto) < 0.25 ? colors.textDim : scarto < 0 ? colors.warning : colors.success;
                return (
                  <View style={styles.xgRiga}>
                    <Text style={styles.structSub}>
                      xG dal web · Casa <Text style={styles.structLambda}>{prediction.xg_casa.toFixed(2)}</Text>
                      {" · Ospite "}<Text style={styles.structLambda}>{prediction.xg_ospite.toFixed(2)}</Text>
                    </Text>
                    <Text style={[styles.xgScarto, { color: colore }]}>
                      {attesiWeb.toFixed(2)} gol attesi dal campo contro {attesiMotore.toFixed(2)} dalle quote
                      {Math.abs(scarto) < 0.25
                        ? " — d'accordo"
                        : scarto < 0
                          ? ` — il campo dice ${Math.abs(scarto).toFixed(2)} gol in meno: partita più chiusa di come la prezza il book`
                          : ` — il campo dice ${scarto.toFixed(2)} gol in più: partita più aperta di come la prezza il book`}
                    </Text>
                    {typeof prediction.h2h_over_pct === "number" && (
                      <Text style={styles.xgScarto}>Scontri diretti: Over 2.5 nel {prediction.h2h_over_pct}% dei casi</Text>
                    )}
                  </View>
                );
              })()}
            </View>
          </View>
        )}

        {/* ============ QUICK ACTIONS — RIMOSSI (ora nella BARRA FISSA in basso) ============ */}

        {/* ============ CLUSTER RISULTATI (Top probabili) ============ */}
        {structural?.cluster && structural.cluster.length > 0 && (() => {
          const list = showClusterAll ? structural.cluster : structural.cluster.slice(0, 8);
          const maxP = Math.max(...structural.cluster.map((c) => c.p)) || 1;
          const realScore = match.result || "";
          return (
            <View style={styles.clusterBlock}>
              <View style={styles.structHeader}>
                <Ionicons name="bar-chart" size={14} color={colors.aiText} />
                <Text style={styles.structTitle}>CLUSTER RISULTATI</Text>
                <Text style={styles.clusterHint}>Top {list.length} · cluster Poisson</Text>
              </View>
              {list.map((c, i) => {
                const pct = (c.p / maxP) * 100;
                const compColor = c.compatibility === "high" ? colors.success
                  : c.compatibility === "medium" ? colors.primary : colors.textDim;
                const isReal = realScore === c.score;
                return (
                  <View key={`cls-${c.score}-${i}`} style={[styles.clusterRow, isReal && styles.clusterRowReal]}>
                    <View style={styles.clusterRank}>
                      <Text style={styles.clusterRankTxt}>{i + 1}</Text>
                    </View>
                    <Text style={[styles.clusterScore, isReal && { color: colors.success }]}>{c.score}{isReal ? "  ✓" : ""}</Text>
                    <View style={styles.clusterBarTrack}>
                      <View style={[styles.clusterBarFill, { width: `${pct}%`, backgroundColor: compColor }]} />
                    </View>
                    <Text style={[styles.clusterPct, { color: compColor }]}>{(c.p * 100).toFixed(1)}%</Text>
                  </View>
                );
              })}
              {structural.cluster.length > 8 && (
                <TouchableOpacity onPress={() => setShowClusterAll(!showClusterAll)} style={styles.altToggle}>
                  <Ionicons name={showClusterAll ? "chevron-up" : "chevron-down"} size={14} color={colors.primary} />
                  <Text style={styles.altToggleTxt}>{showClusterAll ? "Mostra solo top 8" : `Vedi tutti i ${structural.cluster.length} risultati`}</Text>
                </TouchableOpacity>
              )}
              {structural.explanation && (
                <Text style={styles.clusterExpl}>{structural.explanation}</Text>
              )}
            </View>
          );
        })()}

        {/* ============ RANKING STRUTTURALE (Coverage + Fragility) ============ */}
        {structural?.ranking && structural.ranking.length > 0 && (() => {
          // Solo quote >= 1,40, contando anche quelle STIMATE (01/10/2026: prima
          // passavano tutte, e sotto "quote >= 1.40" comparivano MG a 1,16).
          // Il numero di ogni riga e' la POSIZIONE VERA nel motore, la stessa
          // che usano consiglio AI e classifiche ("motore #10"): i mercati
          // nascosti lasciano un salto invece di rinumerare.
          const filtered = structural.ranking
            .map((r, pos) => ({ ...r, pos: pos + 1 }))
            .filter((r) => {
              if (nonGiocato(r.market)) return false;   // NG, U1.5, U2.5: mai giocati
              const o = r.odd ?? getMarketOdd(r.market, match.odds);
              if (o === undefined || o === null) return true;
              return o >= 1.40;
            });
          if (filtered.length === 0) return null;
          // 3 righe + "mostra tutti" (round 2, TICKET 1).
          const visibili = rankingTutto ? filtered : filtered.slice(0, 3);
          const pickNorm = pickVerdetto ? normalizeMarket(pickVerdetto) : null;
          return (
          <View style={styles.structRankBlock}>
            <View style={styles.structHeader}>
              <Ionicons name="ribbon" size={14} color={colors.aiText} />
              <Text style={styles.structTitle}>RANKING STRUTTURALE</Text>
              <Text style={styles.clusterHint}>posizione nel motore · solo quote ≥ 1,40 (* stimate)</Text>
            </View>
            {visibili.map((r, i) => {
              const cov = Math.round(r.coverage * 100);
              // Prima la quota del motore (combo stimate con Poisson o con la
              // formula GG + O2.5); getMarketOdd moltiplicava le due quote.
              const odd = r.odd ?? getMarketOdd(r.market, match.odds);
              const oddStimata = r.odd != null && !!r.odd_estimated;
              const fragColor = r.fragility_label === "bassa" ? colors.success
                : r.fragility_label === "media" ? colors.primary : colors.danger;
              return (
                <View key={`sr-${r.market}-${i}`} style={[styles.srRow, i === 0 && styles.srRowTop]}>
                  <View style={[styles.srRank, i === 0 && styles.srRankTop]}>
                    <Text style={[styles.srRankTxt, i === 0 && { color: "#FFF" }]}>{r.pos}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Text style={[styles.srMarket, i === 0 && { color: colors.aiText }]}>{r.market}</Text>
                      {odd != null && (
                        <Text style={[styles.srOdd, i === 0 && { color: colors.aiText }]}>{oddStimata ? "*" : "@"} {odd.toFixed(2)}</Text>
                      )}
                      <View style={[styles.srTag, { backgroundColor: "rgba(16,185,129,0.15)", borderColor: colors.success }]}>
                        <Text style={[styles.srTagTxt, { color: colors.success }]}>COV {cov}% Poisson</Text>
                      </View>
                      <View style={[styles.srTag, { backgroundColor: `${fragColor}22`, borderColor: fragColor }]}>
                        {/* La fragilita' e' 100 - COV: la percentuale ripeteva lo stesso
                            dato, resta solo l'etichetta colorata. */}
                        <Text style={[styles.srTagTxt, { color: fragColor }]}>fragilità {r.fragility_label}</Text>
                      </View>
                      {r.ml_adjustment && r.ml_adjustment.type !== "neutral" && (() => {
                        const isBoost = r.ml_adjustment.type === "boost";
                        const mlColor = isBoost ? colors.success : colors.danger;
                        const mlBg = isBoost ? "rgba(16,185,129,0.18)" : "rgba(239,68,68,0.18)";
                        return (
                          <View style={[styles.srTag, { backgroundColor: mlBg, borderColor: mlColor }]}>
                            <Ionicons name={isBoost ? "trending-up" : "trending-down"} size={9} color={mlColor} style={{ marginRight: 2 }} />
                            <Text style={[styles.srTagTxt, { color: mlColor }]}>ML {r.ml_adjustment.delta} ({r.ml_adjustment.win_rate}% in archivio, n={r.ml_adjustment.total})</Text>
                          </View>
                        );
                      })()}
                    </View>
                    {r.broken_by.length > 0 && pickNorm !== null && normalizeMarket(r.market) === pickNorm && (
                      <Text style={styles.srBroken}>Rotto da: {r.broken_by.join(", ")}</Text>
                    )}
                  </View>
                </View>
              );
            })}
            {filtered.length > 3 && (
              <TouchableOpacity testID="ranking-tutto" onPress={() => setRankingTutto(!rankingTutto)} style={styles.altToggle}>
                <Ionicons name={rankingTutto ? "chevron-up" : "chevron-down"} size={14} color={colors.primary} />
                <Text style={styles.altToggleTxt}>{rankingTutto ? "Mostra solo i primi 3" : `Mostra tutti (${filtered.length})`}</Text>
              </TouchableOpacity>
            )}
          </View>
          );
        })()}

        {/* Pre-pronostic family — local heuristic */}
        {(() => {
          // FASE 5 — se il backend manda la sua classifica PRE la usiamo: è una
          // sola implementazione invece di due copie da tenere allineate a mano.
          const fam = structural?.pre_ranking?.length
            ? structural.pre_ranking.map((c) => ({ market: c.market, odd: c.odd, family: "" }))
            : quickPredictionFamily(match.odds);
          if (fam.length === 0) return null;
          const llmMarkets = match.playable_markets?.map((p) => p.market) || (match.main_prediction ? [match.main_prediction] : []);
          // Solo i mercati che il pre-pronostico ha davvero in classifica:
          // rankPicks unisce anche quelli proposti dall'IA (marcati AI_ONLY), ma
          // mostrarli qui contraddice la didascalia — questa lista deve essere
          // il parere del pre-pronostico e basta. I mercati dell'IA hanno gia'
          // la loro sezione piu' sotto.
          const rankedRaw = rankPicks(fam, llmMarkets, marketStats)
            .filter((r) => r.source !== "ai")
            .filter((r) => !nonGiocato(r.market));   // NG, U1.5, U2.5: mai giocati
          // ============================================================
          // FILTRO STRUTTURALE: scarta mercati che violano floor/ceiling
          // (es. MG 2-4 quando floor=0, MG 1-3 quando floor=2-tetto=4,
          // U2.5 quando ceiling aperto, MG con range non coerente)
          // ============================================================
          const ranked = structural?.structure
            ? rankedRaw.filter((p) => ammessoDallaStruttura(p.market, structural.structure))
            : rankedRaw;
          if (ranked.length === 0) return null;
          // Sezione vuota = niente titolo (round 2, TICKET 1): a ricerca fatta
          // senza mercati resta solo la riga che spiega perche'.
          const storicoVuoto = !!storicoQuote && (!storicoQuote.ok || !(storicoQuote.mercati || []).length);
          return (
            <>
            {/* ===== STORICO QUOTE SIMILI =====
                "Partendo da queste quote, nelle partite passate con quote vicine
                com'e' andata a finire?" Le cinque quote (1, X, 2, Over 2.5, GG)
                si confrontano INSIEME, in blocco. Possibile solo dal 27/09/2026:
                con 432 partite concluse il 76% non ne trovava nemmeno una simile;
                con 7.855 la mediana e' 52. */}
            <View style={styles.preBlock}>
              {!storicoVuoto && (
                <View style={styles.preHeader}>
                  <Ionicons name="albums-outline" size={14} color={colors.primary} />
                  <Text style={styles.preTitle}>STORICO QUOTE SIMILI</Text>
                </View>
              )}
              {!storicoQuote && !caricoStorico && (
                <TouchableOpacity
                  testID="storico-quote"
                  onPress={async () => {
                    setCaricoStorico(true);
                    try { setStoricoQuote(await api.similarOdds(String(id))); }
                    catch (e: any) { notify("Errore", e?.message); }
                    finally { setCaricoStorico(false); }
                  }}
                  style={styles.storicoBtn}
                >
                  <Ionicons name="search-outline" size={16} color={colors.primary} />
                  <Text style={styles.storicoBtnTxt}>Cerca partite con quote simili</Text>
                </TouchableOpacity>
              )}
              {caricoStorico && <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} />}
              {storicoQuote && !storicoQuote.ok && (
                <Text style={styles.euristicaNota}>{storicoQuote.motivo || storicoQuote.error}</Text>
              )}
              {storicoQuote && storicoQuote.ok && (
                <>
                  <Text style={styles.euristicaNota}>
                    {storicoQuote.partite_simili} partite concluse con tutte e cinque le quote entro
                    ±{storicoQuote.tolleranza.toFixed(2)} da questa, su {storicoQuote.storico_totale} in archivio.
                    {storicoQuote.allargata ? " Tolleranza allargata: a ±0,15 il campione era troppo piccolo." : ""}
                    {storicoQuote.media_gol ? ` Media gol ${storicoQuote.media_gol}.` : ""}
                  </Text>
                  {(storicoQuote.punteggi_frequenti || []).length > 0 && (
                    <Text style={styles.storicoPunteggi}>
                      Punteggi più frequenti: {(storicoQuote.punteggi_frequenti || [])
                        .map((p) => `${p.punteggio} (${p.pct}%)`).join(" · ")}
                    </Text>
                  )}
                  {(storicoQuote.mercati || []).slice(0, 12).map((m) => (
                    <View key={m.market} style={styles.storicoRiga}>
                      <Text style={[styles.storicoPct, { color: (m.pct ?? 0) >= 60 ? colors.success : (m.pct ?? 0) >= 50 ? colors.primary : colors.textDim }]}>
                        {m.pct}%
                      </Text>
                      <Text style={[styles.storicoMercato, !m.giocabile && { color: colors.textDim }]}>
                        {m.market}{m.giocabile ? "" : "  (non fra i tuoi mercati)"}
                      </Text>
                      <Text style={styles.storicoConteggio}>{m.vinte}/{m.valutate}</Text>
                    </View>
                  ))}
                </>
              )}
            </View>

            {/* TERZO PARERE (round 2, TICKET 1): una riga sola, il pick del PRE con
                la sua quota. Prima qui c'era il blocco "EURISTICA RAPIDA" con il
                PICK CONSIGLIATO, la lista delle alternative e le "opportunita' non
                sfruttate": numeri costanti di famiglia, non di questa partita, con
                la stessa grafica dei numeri misurati. rankPicks resta: serve alla
                fusione, qui si toglie solo la visualizzazione. */}
            {ranked[0] && (
              <View style={styles.terzoParere} testID="terzo-parere">
                <Ionicons name="flash" size={12} color={colors.primary} />
                <Text style={styles.terzoParereLbl}>Terzo parere (solo quote):</Text>
                <Text style={styles.terzoParereMercato}>{ranked[0].market}</Text>
                {ranked[0].odd > 0 && <Text style={styles.terzoParereQuota}>@ {ranked[0].odd.toFixed(2)}</Text>}
              </View>
            )}
            </>
          );
        })()}

        {/* Il vecchio riquadro "Pronostico AI" (classifiche per fascia) e' stato tolto il
            07/10/2026: ora il Pronostico AI e' la lettura col modello scelto (tasto in alto). */}
          </>
        )}
        </>) : null}
        <View style={{ height: 12 }} />
      </ScrollView>

      {/* ============================================================
          BARRA FISSA CONTESTUALE — RIMOSSA
          I 3 tasti AI/Risultato/Quote sono ora nella BottomNav stessa,
          che diventa contestuale automaticamente quando l'utente entra
          in una route /match/, /risultato/, /quote/.
       ============================================================ */}
      {/* ============================================================
          BARRA DI SCORRIMENTO — IN FONDO, sopra la BottomNav
          ============================================================
          Prima stava sotto l'header, in cima: Rossi la cercava in fondo e non
          la trovava. Qui e' dove arriva il pollice, ed e' anche dove sta gia'
          "Salva -> Prossima" nella schermata risultato: stesso gesto, stesso
          posto. E' sempre presente, cosi' c'e' sempre una via d'uscita anche
          quando la partita non e' in Schedina; PREC e AVANTI compaiono solo
          quando c'e' davvero dove andare. */}
      <View style={[styles.selNavBar, { bottom: navHeight }]}>
        <TouchableOpacity
          testID="sel-exit"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          style={styles.selNavBtn}
        >
          <Ionicons name="close" size={15} color={colors.text} />
          <Text style={styles.selNavTxt}>ESCI</Text>
        </TouchableOpacity>

        {selIndex >= 0 && selList.length > 1 ? (
          <>
            {/* PREC e' quadrato e senza etichetta: e' il gesto meno frequente
                e cosi' resta larghezza per AVANTI, che e' quello che si usa. */}
            <TouchableOpacity
              testID="sel-prev"
              onPress={() => goToSel(prevSel)}
              disabled={!prevSel}
              style={[styles.selNavBtn, styles.selNavBtnIcon, !prevSel && styles.selNavBtnOff]}
              accessibilityLabel="Partita precedente"
            >
              <Ionicons name="chevron-back" size={17} color={prevSel ? colors.text : colors.textDim} />
            </TouchableOpacity>

            <View style={styles.selNavCount}>
              <Ionicons name="ticket-outline" size={12} color={colors.primary} />
              <Text style={styles.selNavCountTxt}>{selIndex + 1}/{selList.length}</Text>
            </View>

            <TouchableOpacity
              testID="sel-next"
              onPress={() => goToSel(nextSel)}
              disabled={!nextSel}
              style={[styles.selNavBtn, styles.selNavBtnMain, !nextSel && styles.selNavBtnOff]}
            >
              <Text style={[styles.selNavTxt, nextSel ? { color: "#FFF" } : { color: colors.textDim }]}>AVANTI</Text>
              <Ionicons name="chevron-forward" size={15} color={nextSel ? "#FFF" : colors.textDim} />
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.selNavHint} numberOfLines={1}>
            {selIndex >= 0 ? "Unica partita in Schedina" : "Partita non in Schedina"}
          </Text>
        )}
      </View>

      {/* La legenda delle famiglie era importata e il tasto "?" ne accendeva lo
          stato, ma il modale non veniva mai montato: il tasto non apriva nulla. */}

      <BottomNav />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  // Tutti i tasti della barra hanno la STESSA altezza (SELNAV_H) e lo stesso
  // raggio: prima ognuno si dimensionava sul proprio contenuto e in fila
  // risultavano di misure diverse. Sfondo identico alla BottomNav, cosi' le
  // due barre si leggono come un unico blocco invece che come due fasce.
  selNavBar: {
    position: "absolute", left: 0, right: 0,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    gap: 6, paddingHorizontal: 10, paddingVertical: 7,
    backgroundColor: "rgba(26,26,26,0.96)",
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  selNavHint: { flex: 1, textAlign: "right", color: colors.textDim, fontSize: 11, fontWeight: "700" },
  selNavBtn: {
    height: 38, minWidth: 38,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
    backgroundColor: colors.surfaceHi, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 14, borderRadius: 10,
  },
  selNavBtnIcon: { paddingHorizontal: 0, width: 38 },
  selNavBtnMain: { backgroundColor: colors.primary, borderColor: colors.primary },
  selNavBtnOff: { backgroundColor: colors.surface, borderColor: colors.border, opacity: 0.45 },
  selNavTxt: { color: colors.text, fontSize: 12, fontWeight: "900", letterSpacing: 0.6 },
  selNavCount: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 2 },
  selNavCountTxt: { color: colors.primary, fontSize: 13, fontWeight: "900", letterSpacing: 0.3 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  iconBtn: { padding: 8 },
  headerTitle: { flex: 1, fontFamily: fonts.heading, color: colors.text, fontSize: 17, fontWeight: "800", textAlign: "center", textTransform: "uppercase", letterSpacing: 0.5 },
  content: { padding: 16, gap: 16 },
  hero: { alignItems: "center", paddingVertical: 16, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border },
  heroDay: { color: colors.textMuted, fontSize: 11, fontWeight: "700", letterSpacing: 1, marginBottom: 12 },
  team: { fontFamily: fonts.heading, color: colors.text, fontSize: 22, fontWeight: "900", textTransform: "uppercase" },
  vs: { color: colors.textDim, fontSize: 12, fontWeight: "700", marginVertical: 4 },
  resultBox: { marginTop: 12, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.surfaceHi, borderRadius: 10, alignItems: "center" },
  resultLbl: { color: colors.textMuted, fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  resultVal: { color: colors.success, fontSize: 22, fontWeight: "900", marginTop: 2 },
  aiBlock: { backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, gap: 10 },
  aiHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  aiTitle: { color: colors.aiText, fontSize: 12, fontWeight: "900", letterSpacing: 1, flex: 1 },
  confBadge: { backgroundColor: colors.aiBg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  confTxt: { color: colors.aiText, fontSize: 10, fontWeight: "800" },
  mainPred: { padding: 12, borderRadius: 10, alignItems: "center" },
  mainPredLbl: { color: "#FFE4D9", fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  mainPredVal: { color: "#FFF", fontSize: 24, fontWeight: "900", marginTop: 4 },
  analysis: { color: colors.text, fontSize: 13, lineHeight: 20 },
  fasceRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  ricRow: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, marginTop: 8, gap: 4 },
  ricLbl: { color: colors.textMuted, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  ricMarket: { color: colors.text, fontSize: 16, fontWeight: "900" },
  ricOdd: { color: colors.textMuted, fontSize: 13, fontWeight: "700" },
  ricEsito: { fontSize: 12, fontWeight: "900" },
  ricVuoto: { color: colors.textMuted, fontSize: 11, marginTop: 6 },
  mainPredMeta: { color: "#FFF", fontSize: 11, fontWeight: "700", marginTop: 4, opacity: 0.9 },
  fasciaNota: { color: colors.textDim, fontSize: 11, marginTop: -4, marginBottom: 8 },
  golBox: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 10, padding: 12, gap: 3 },
  golTitolo: { color: colors.primary, fontSize: 11, fontWeight: "900", letterSpacing: 1, marginBottom: 4 },
  golRiga: { flexDirection: "row", alignItems: "center", gap: 6 },
  golEt: { flex: 1.1, color: colors.textMuted, fontSize: 11, fontWeight: "700" },
  golTesta: { flex: 1, color: colors.text, fontSize: 12, fontWeight: "900", textAlign: "center" },
  golVal: { flex: 1, color: colors.text, fontSize: 12, fontWeight: "700", textAlign: "center" },
  golSez: { color: colors.textDim, fontSize: 10, fontWeight: "900", letterSpacing: 1, marginTop: 8 },
  golTesto: { color: colors.text, fontSize: 12, lineHeight: 18 },
  golAvviso: { color: colors.warning, fontSize: 12, fontWeight: "700", lineHeight: 18, marginTop: 4 },
  consBox: { borderWidth: 2, borderColor: colors.success, backgroundColor: "rgba(16,185,129,0.08)", borderRadius: 14, padding: 14, gap: 3 },
  consLbl: { color: colors.success, fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  consVal: { color: colors.text, fontSize: 22, fontWeight: "900" },
  consMeta: { color: colors.textMuted, fontSize: 13, fontWeight: "700" },
  consTesto: { color: colors.text, fontSize: 13, lineHeight: 19, marginTop: 4 },
  consPic: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  consAvviso: { color: colors.warning, fontSize: 12, fontWeight: "700", lineHeight: 18, marginTop: 4 },
  consOk: { color: colors.success, fontSize: 12, fontWeight: "800", marginTop: 4 },
  tabBox: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 10, gap: 2 },
  tabRiga: { flexDirection: "row", gap: 6, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.border },
  tabRigaCons: { backgroundColor: "rgba(16,185,129,0.10)" },
  tabTesta: { borderBottomColor: colors.textMuted },
  tabTestaTxt: { color: colors.textMuted, fontWeight: "900", fontSize: 10 },
  tabC1: { flex: 2.2, color: colors.text, fontSize: 11 },
  tabC2: { flex: 0.9, color: colors.text, fontSize: 11, textAlign: "right" },
  tabC3: { flex: 1.1, color: colors.text, fontSize: 11, textAlign: "right" },
  tabC4: { flex: 3.6, color: colors.textMuted, fontSize: 10, lineHeight: 14 },
  proBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center", marginTop: 10, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, backgroundColor: colors.primary },
  proBtnTxt: { color: "#000", fontSize: 13, fontWeight: "900" },
  letturaAI: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 8, paddingTop: 4, gap: 2 },
  letturaBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1, borderColor: colors.primary, borderRadius: 8, alignSelf: "flex-start" },
  letturaBtnTxt: { color: colors.primary, fontSize: 13, fontWeight: "800" },
  approfBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 10 },
  approfTxt: { color: colors.textMuted, fontSize: 13, fontWeight: "700", flex: 1 },
  fasciaRiga: { flexDirection: "row", gap: 6, marginTop: 4, marginBottom: 6, flexWrap: "wrap" },
  fasciaChip: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10 },
  fasciaChipOn: { borderColor: colors.primary, backgroundColor: "rgba(255,87,34,0.18)" },
  fasciaChipTxt: { color: colors.text, fontSize: 13, fontWeight: "800" },
  golSquadra: { flex: 1, gap: 2, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 8 },
  golNum: { color: colors.textMuted, fontSize: 13 },
  golNumB: { color: colors.text, fontSize: 16, fontWeight: "900" },
  golPic: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  golRisultati: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  golRis: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8, alignItems: "center", minWidth: 62 },
  golRisPunt: { color: colors.text, fontSize: 15, fontWeight: "900" },
  golRisPct: { color: colors.textMuted, fontSize: 11, fontWeight: "700" },
  golNota: { color: colors.textDim, fontSize: 10, lineHeight: 15, marginTop: 6 },
  puntaBox: { borderWidth: 1, borderColor: colors.primary, backgroundColor: "rgba(255,87,34,0.10)", borderRadius: 10, padding: 12, gap: 2 },
  puntaLbl: { color: colors.primary, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  puntaVal: { color: colors.text, fontSize: 20, fontWeight: "900" },
  puntaMeta: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  puntaPerche: { color: colors.text, fontSize: 13, lineHeight: 19, marginTop: 6 },
  puntaSez: { color: colors.textDim, fontSize: 10, fontWeight: "900", letterSpacing: 1, marginTop: 8 },
  altRow: { marginTop: 4 },
  altNome: { color: colors.text, fontSize: 13, fontWeight: "800" },
  altMeta: { color: colors.textMuted, fontSize: 11, fontWeight: "600" },
  altPercheNo: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  puntaParere: { color: colors.textMuted, fontSize: 13, marginTop: 8 },
  puntaNota: { color: colors.textDim, fontSize: 11, lineHeight: 16, marginTop: 6 },
  puntaAvviso: { color: colors.warning, fontSize: 11, lineHeight: 16, marginTop: 4 },
  palettoBox: { borderWidth: 1, borderColor: colors.warning, backgroundColor: "rgba(245,158,11,0.12)", borderRadius: 8, padding: 8 },
  palettoOk: { borderColor: colors.success, backgroundColor: "rgba(16,185,129,0.10)" },
  palettoTxt: { color: colors.warning, fontSize: 12, fontWeight: "700", lineHeight: 17 },
  modelloTxt: { color: colors.textMuted, fontSize: 11, marginBottom: 6 },
  statVuoto: { color: colors.textMuted, fontSize: 11, paddingVertical: 6, textAlign: "center" },
  analisiBox: { backgroundColor: colors.surfaceHi, borderRadius: 10, padding: 10, gap: 4 },
  analisiTitolo: { color: colors.textMuted, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  scartatoTxt: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  fonteTxt: { color: colors.primary, fontSize: 11, paddingVertical: 3, paddingLeft: 20 },
  statTable: { backgroundColor: colors.surfaceHi, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  statRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  statHeadRow: { borderBottomWidth: 1 },
  statHead: { color: colors.text, fontWeight: "900", fontSize: 12 },
  statCell: { flex: 1, color: colors.text, fontSize: 12, lineHeight: 17 },
  statLbl: { width: 86, color: colors.textMuted, fontSize: 10, fontWeight: "800", letterSpacing: 0.5, textAlign: "center", textTransform: "uppercase", paddingTop: 2 },
  playableList: { gap: 8, marginTop: 4 },
  playableTitle: { color: colors.textMuted, fontSize: 10, fontWeight: "800", letterSpacing: 1, marginBottom: 4 },
  playableItem: { flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: colors.surfaceHi, padding: 10, borderRadius: 10 },
  rankBadge: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.border, alignItems: "center", justifyContent: "center" },
  rankBadgeTop: { backgroundColor: colors.primary },
  rankTxt: { color: colors.textMuted, fontWeight: "900", fontSize: 12 },
  playableMarket: { color: colors.text, fontSize: 14, fontWeight: "900" },
  playableReason: { color: colors.textMuted, fontSize: 11, marginTop: 2, lineHeight: 16 },
  preBlock: { backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "rgba(255,140,0,0.35)", gap: 8 },
  preHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  preTitle: { color: colors.primary, fontSize: 12, fontWeight: "900", letterSpacing: 1, flex: 1 },
  altToggle: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 8, marginTop: 4 },
  altToggleTxt: { color: colors.primary, fontSize: 11, fontWeight: "800" },
  preRankTop: { backgroundColor: colors.primary },
  aiBtn: { borderRadius: 12, overflow: "hidden" },
  aiBtnInner: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14 },
  aiBtnTxt: { color: "#FFF", fontSize: 14, fontWeight: "800" },
  regenBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 10, borderWidth: 1, borderColor: colors.primary,
    borderStyle: "dashed", borderRadius: 10, marginTop: 4,
  },
  regenBtnTxt: { color: colors.primary, fontSize: 12, fontWeight: "800", letterSpacing: 0.5 },
  sectionTitle: { color: colors.primary, fontSize: 11, fontWeight: "900", letterSpacing: 1, marginTop: 4 },
  famBlock: { gap: 8 },
  famName: { color: colors.text, fontSize: 13, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  famGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  famCard: {
    flex: 1, minWidth: 80, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: 10, paddingVertical: 12, position: "relative",
  },
  famCardTop: { backgroundColor: colors.primary, borderColor: colors.primary },
  famLbl: { color: colors.textMuted, fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  famVal: { color: colors.text, fontSize: 18, fontWeight: "900", marginTop: 2 },
  famEst: { color: colors.textDim, fontSize: 8, fontWeight: "700", marginTop: 2 },
  topMark: { position: "absolute", top: 4, right: 4 },
  resultBlock: { gap: 8 },
  saveResultBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: colors.primary, paddingVertical: 14, borderRadius: 12, marginTop: 8,
  },
  saveResultTxt: { color: "#FFF", fontWeight: "900", fontSize: 14, letterSpacing: 0.5 },

  // ===== STRUTTURA MATCH =====
  structBlock: {
    backgroundColor: colors.surface, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: "rgba(99,102,241,0.40)", gap: 10,
  },
  structHeader: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  structTitle: { color: colors.aiText, fontSize: 12, fontWeight: "900", letterSpacing: 1, flex: 1 },
  structFamilyTag: { backgroundColor: colors.aiBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  structFamilyTxt: { color: colors.aiText, fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },
  structGrid: { flexDirection: "row", gap: 8 },
  structCell: {
    flex: 1, backgroundColor: colors.surfaceHi, borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 8, alignItems: "center",
  },
  structLbl: { color: colors.textMuted, fontSize: 9, fontWeight: "800", letterSpacing: 0.8 },
  structVal: { color: colors.text, fontSize: 11, fontWeight: "800", marginTop: 4, textTransform: "uppercase" },
  structValBig: { color: colors.aiText, fontSize: 22, fontWeight: "900", marginTop: 2 },
  structSub: { color: colors.textDim, fontSize: 9, fontWeight: "600", marginTop: 2 },
  structLambdaRow: { alignItems: "center", paddingTop: 4, borderTopWidth: 1, borderTopColor: colors.border },

  // ===== QUICK ACTIONS (Genera Pronostico / Risultato + Quote) =====
  quickActions: {
    flexDirection: "row",
    gap: 10,
    marginVertical: 4,
  },
  qaBtnPrimary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    backgroundColor: colors.primary,
    borderRadius: 12,
  },
  qaBtnPrimaryTxt: { color: "#000", fontWeight: "900", fontSize: 14 },
  qaBtnSecondary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 12,
  },
  qaBtnSecondaryTxt: { color: colors.primary, fontWeight: "800", fontSize: 13 },

  // ===== BARRA FISSA AZIONI (sopra BottomNav, contestuale match page) =====
  fixedActionBar: {
    position: "absolute",
    left: 12,
    right: 12,
    flexDirection: "row",
    gap: 8,
    zIndex: 20,
  },
  fabAction: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
  },
  fabActionPrimary: {
    backgroundColor: colors.primary,
  },
  fabActionSecondary: {
    backgroundColor: "rgba(20,20,20,0.92)",
    borderWidth: 1,
    borderColor: colors.primary,
  },
  fabActionTxt: { color: "#000", fontWeight: "900", fontSize: 13 },
  aiPlaceholder: {
    alignItems: "center",
    paddingVertical: 16,
    gap: 6,
  },
  aiPlaceholderBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.primaryLight,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 999,
    shadowColor: colors.primaryLight,
    shadowOpacity: 0.5,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  aiPlaceholderBtnTxt: { color: "#000", fontWeight: "900", fontSize: 15 },
  aiPlaceholderTxt: { color: colors.textDim, fontSize: 12, fontStyle: "italic" },
  structLambda: { color: colors.aiText, fontWeight: "900" },

  // ===== CLUSTER RISULTATI =====
  clusterBlock: {
    backgroundColor: colors.surface, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: "rgba(99,102,241,0.40)", gap: 8,
  },
  clusterHint: { color: colors.textMuted, fontSize: 10, fontWeight: "700" },
  clusterRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 6, paddingHorizontal: 8,
    backgroundColor: colors.surfaceHi, borderRadius: 8,
  },
  clusterRowReal: { borderWidth: 1, borderColor: colors.success, backgroundColor: "rgba(16,185,129,0.10)" },
  clusterRank: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },
  clusterRankTxt: { color: colors.textMuted, fontSize: 10, fontWeight: "900" },
  clusterScore: { color: colors.text, fontSize: 13, fontWeight: "900", width: 50 },
  clusterBarTrack: { flex: 1, height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: "hidden" },
  clusterBarFill: { height: "100%", borderRadius: 4 },
  clusterPct: { fontSize: 11, fontWeight: "900", width: 50, textAlign: "right" },
  clusterExpl: {
    color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 6,
    paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border, fontStyle: "italic",
  },

  // ===== RANKING STRUTTURALE =====
  structRankBlock: {
    backgroundColor: colors.surface, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: "rgba(99,102,241,0.40)", gap: 8,
  },
  srRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 8, paddingHorizontal: 10,
    backgroundColor: colors.surfaceHi, borderRadius: 10,
  },
  srRowTop: { borderWidth: 2, borderColor: colors.aiText, backgroundColor: colors.aiBg },
  srRank: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },
  srRankTop: { backgroundColor: colors.aiText },
  srRankTxt: { color: colors.textMuted, fontSize: 11, fontWeight: "900" },
  srMarket: { color: colors.text, fontSize: 13, fontWeight: "900" },
  srOdd: { color: colors.primary, fontSize: 12, fontWeight: "800" },
  srTag: { borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  srTagTxt: { fontSize: 9, fontWeight: "900", letterSpacing: 0.3 },
  srBroken: { color: colors.textDim, fontSize: 10, marginTop: 4, fontStyle: "italic" },

  // ===== NOTA SCENARIO 1X2 (promemoria, sola lettura) =====
  scenarioNoteBox: {
    backgroundColor: colors.surface, borderRadius: 16, padding: 14,
    borderWidth: 2, borderColor: colors.primary, gap: 4,
  },
  scenarioNoteTitle: { color: colors.text, fontSize: 15, fontWeight: "900", letterSpacing: 0.8 },
  scenarioNoteSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  legendaFonti: { color: colors.primary, fontSize: 10, fontWeight: "700", marginTop: 2 },
  terzoParere: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", paddingVertical: 8, paddingHorizontal: 10, marginTop: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 10 },
  terzoParereLbl: { color: colors.textMuted, fontSize: 11, fontWeight: "700" },
  terzoParereMercato: { color: colors.text, fontSize: 12, fontWeight: "900" },
  terzoParereQuota: { color: colors.primary, fontSize: 12, fontWeight: "800" },
  scenarioNoteMarket: { color: colors.text, fontSize: 15, fontWeight: "800", lineHeight: 22 },
  scenarioNoteMarketVinto: { color: colors.success, fontWeight: "800" },

  // ===== VERDETTO FINALE =====
  verdictBlock: {
    backgroundColor: colors.surface, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: "#FFD700", gap: 10,
  },
  verdictHeader: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  verdictTitle: { color: "#FFD700", fontSize: 13, fontWeight: "900", letterSpacing: 1.2, flex: 1 },
  verdictHint: { color: colors.textMuted, fontSize: 10, lineHeight: 14, fontStyle: "italic" },
  sogliaWarn: {
    backgroundColor: "rgba(245,158,11,0.12)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.45)",
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    gap: 3,
  },
  sogliaWarnTitle: { color: colors.warning, fontSize: 13, fontWeight: "800" },
  sogliaWarnBody: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  minOddChipOltre: { borderColor: "rgba(245,158,11,0.55)" },
  minOddRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 10,
    flexWrap: "wrap",
  },
  minOddLabel: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  minOddChips: { flexDirection: "row", gap: 6 },
  minOddChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  minOddChipOn: {
    backgroundColor: "rgba(245,166,35,0.20)",
    borderColor: colors.primary,
  },
  minOddChipTxt: { color: colors.textDim, fontSize: 12, fontWeight: "700" },
  minOddChipTxtOn: { color: "#FFF" },
  verdictHero: {
    flexDirection: "row", gap: 12, alignItems: "center",
    backgroundColor: "rgba(255,215,0,0.10)", borderWidth: 1, borderColor: "rgba(255,215,0,0.40)",
    padding: 12, borderRadius: 12,
  },
  verdictMedal: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#FFD700", alignItems: "center", justifyContent: "center" },
  verdictLabel: { color: "#FFD700", fontSize: 10, fontWeight: "900", letterSpacing: 1.5 },
  verdictMarket: { color: colors.text, fontSize: 20, fontWeight: "900" },
  verdictOdd: { color: "#FFD700", fontSize: 15, fontWeight: "900" },
  verdictOutcome: { flexDirection: "row", alignItems: "center", gap: 3, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  verdictOutcomeTxt: { fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },
  verdictMeta: { color: colors.textMuted, fontSize: 10, marginTop: 4 },
  vSrcBadge: { flexDirection: "row", alignItems: "center", gap: 3, borderWidth: 1, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  vSrcTxt: { fontSize: 9, fontWeight: "900", letterSpacing: 0.3 },
  verdictAltTitle: { color: colors.textMuted, fontSize: 9, fontWeight: "900", letterSpacing: 1, marginBottom: 6 },
  verdictAltRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: colors.surfaceHi, borderRadius: 10, marginBottom: 6 },
  verdictAltRank: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.border, alignItems: "center", justifyContent: "center" },
  verdictAltRankTxt: { color: colors.textMuted, fontSize: 11, fontWeight: "900" },
  verdictAltMarket: { color: colors.text, fontSize: 13, fontWeight: "800" },
  verdictAltOdd: { color: colors.primary, fontSize: 12, fontWeight: "800" },
  verdictConcMini: { fontSize: 10, fontWeight: "900" },
  vetoTag: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: colors.danger, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  vetoTxt: { color: "#FFF", fontSize: 9, fontWeight: "900", letterSpacing: 0.3 },

  // Tasto "?" della legenda famiglie (era usato ma mai definito)

  aiFuoriWrap: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: 8, paddingVertical: 6, paddingHorizontal: 8,
    backgroundColor: "rgba(245, 158, 11, 0.12)", borderRadius: 8,
  },
  aiFuoriTxt: { flex: 1, color: colors.warning, fontSize: 11, fontWeight: "700" },

  // Avviso di divergenza fra il pick salvato (card della Schedina) e quello
  // ricalcolato qui: prima i due numeri potevano essere diversi in silenzio.
  divergenza: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: 8, paddingVertical: 6, paddingHorizontal: 8,
    backgroundColor: "rgba(245, 158, 11, 0.12)", borderRadius: 8,
  },
  divergenzaTxt: { flex: 1, color: colors.warning, fontSize: 11, lineHeight: 15 },

  // "Perche' questo pick": la somma dei correttivi, voce per voce.
  percheBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, paddingVertical: 8 },
  percheBtnTxt: { color: colors.textMuted, fontSize: 11, fontWeight: "900", letterSpacing: 1.2 },
  percheBox: {
    backgroundColor: colors.bg, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: colors.border,
  },
  percheAltro: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  percheMercato: { color: colors.text, fontSize: 13, fontWeight: "800", marginBottom: 6 },
  percheRiga: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 2 },
  perchePunti: { width: 52, textAlign: "right", fontSize: 12, fontWeight: "900", fontVariant: ["tabular-nums"] },
  percheVoce: { flex: 1, color: colors.textDim, fontSize: 12, lineHeight: 16 },
  percheNota: { color: colors.textDim, fontSize: 11, lineHeight: 15, marginTop: 10, fontStyle: "italic" },

  // Euristica rapida e storico quote simili
  verdictAltNota: { color: colors.textDim, fontSize: 10, fontStyle: "italic" },
  congelatoNota: { color: colors.textDim, fontSize: 10, lineHeight: 14, marginTop: 2, fontStyle: "italic" },
  xgRiga: { marginTop: 6, gap: 3 },
  xgScarto: { color: colors.textDim, fontSize: 11, lineHeight: 16 },

  euristicaNota: { color: colors.textDim, fontSize: 11, lineHeight: 16, marginBottom: 8, fontStyle: "italic" },
  storicoBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.primary,
    backgroundColor: "rgba(255,87,34,0.10)",
  },
  storicoBtnTxt: { color: colors.primary, fontSize: 13, fontWeight: "800" },
  storicoPunteggi: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginBottom: 8 },
  storicoRiga: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 3 },
  storicoPct: { width: 52, textAlign: "right", fontSize: 13, fontWeight: "900", fontVariant: ["tabular-nums"] },
  storicoMercato: { flex: 1, color: colors.text, fontSize: 12 },
  storicoConteggio: { color: colors.textDim, fontSize: 11, fontVariant: ["tabular-nums"] },
});
