import React, { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";

import { api, Match, evaluateMarketOutcome, Lavoro } from "@/src/api";
import { useLavoro, LavoroBox, riepilogoLavoro } from "@/src/components/LavoroBox";
import { colors } from "@/src/theme";
import { ScoreInput } from "@/src/components/ScoreInput";
import { apriConPrompt, confirmAction, notify } from "@/src/utils/platform";
import { parseLeagueCode } from "@/src/utils/leagues";
import { useBottomNav } from "@/src/components/BottomNavContext";
import { useToast } from "@/src/components/Toast";
import { selectedListCache, matchesCache, marketStatsCache, mlStatsCache } from "@/src/utils/cache";
import BottomNav from "@/src/components/BottomNav";
import { AI_CHAT_URL, AI_CHAT_NAME, ARENA_URL, ARENA_NAME } from "@/src/utils/aiChat";

export default function Selected() {
  const router = useRouter();
  const bottomNav = useBottomNav();
  const toast = useToast();
  const [items, setItems] = useState<Match[]>([]);
  const [results, setResults] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // STALE-WHILE-REVALIDATE. Prima questa schermata faceva setLoading(true) e
  // una fetch bloccante ad OGNI ingresso, ignorando `selectedListCache` che
  // pure importava: da qui lo spinner ogni volta che si apriva la Schedina,
  // anche solo per tornarci indietro dopo due secondi.
  const applyList = useCallback((list: Match[]) => {
    setItems(list);
    const r: Record<string, string> = {};
    list.forEach((m) => { if (m.result) r[m.id] = m.result; });
    setResults(r);
  }, []);

  const load = useCallback(async (force = false) => {
    const cached = selectedListCache.get() as Match[] | null;
    if (cached) {
      applyList(cached);
      setLoading(false);
      if (!force && !selectedListCache.isStale()) return;
    } else {
      setLoading(true);
    }
    try {
      const list = await api.selectedList();
      selectedListCache.set(list);
      applyList(list);
    } catch {
      // con la lista gia' a schermo un errore di rete non deve svuotarla
    } finally {
      setLoading(false);
    }
  }, [applyList]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const [fetchingResults, setFetchingResults] = useState(false);
  const [reviewList, setReviewList] = useState<any[]>([]);

  // RISULTATI (01/10/2026): la stessa ricerca di "Aggiorna risultati" di
  // Manutenzione (API-Football + FotMob, scrive solo se e' sicuro), ma solo
  // sulle partite in Schedina. Le partite saltate dicono perche'.
  const autoFetchResults = async () => {
    if (items.length === 0) {
      notify("Vuoto", "Nessuna partita selezionata");
      return;
    }
    setFetchingResults(true);
    try {
      const res = await api.syncResultsScelte(items.map((m) => m.id));
      marketStatsCache.invalidate();
      mlStatsCache.invalidate();
      matchesCache.invalidate();
      await load(true);
      const esiti = res.esiti || [];
      const righe = esiti.map((e) => `• ${e.partita}: ${e.esito}${e.risultato ? ` (${e.risultato})` : ""}`);
      notify(
        "Risultati della Schedina",
        `Scritti ${res.scritte} su ${items.length}.${righe.length ? `\n\n${righe.join("\n")}` : ""}`,
      );
    } catch (e: any) {
      notify("Errore", e?.message || "Ricerca risultati fallita");
    } finally {
      setFetchingResults(false);
    }
  };

  // PRONOSTICI AI DELLA SCHEDINA (01/10/2026): genera il pronostico AI di ogni
  // partita selezionata, una alla volta dalla prima, come si faceva a mano.
  // Gira sul server: continua anche a schermo spento.
  const aiFinito = useCallback((l: Lavoro) => {
    if (l.tipo !== "ai_schedina") return;
    selectedListCache.invalidate();
    matchesCache.invalidate();
    load(true);
    notify(l.stato === "completato" ? "Pronostici AI pronti" : "Pronostici AI interrotti", riepilogoLavoro(l));
  }, [load]);
  const srv = useLavoro(aiFinito);
  const generaAI = () => {
    const ids = items.filter((m) => !m.result).map((m) => m.id);
    if (!ids.length) { notify("Niente da fare", "Tutte le partite in Schedina sono gia' concluse."); return; }
    confirmAction({
      title: "Pronostico AI su tutta la Schedina?",
      message: `Per ${ids.length} partite, una alla volta, con il modello scelto in LLM & Budget (lo stesso tasto "Pronostico AI" della scheda partita). Solo quelle non ancora iniziate. Il consigliato di ogni partita viene confermato, o cambiato se l'AI trova una notizia vera. Il lavoro continua sul server anche a schermo spento.`,
      confirmText: "Genera",
      onConfirm: async () => {
        try { await srv.avvia("ai_schedina", { ids }); }
        catch (e: any) { notify("Errore", e?.message || String(e)); }
      },
    });
  };

  const applyReview = async (item: any) => {
    try {
      await api.applyResultManual(item.id, item.score);
      setReviewList(reviewList.filter((x) => x.id !== item.id));
      marketStatsCache.invalidate();
      mlStatsCache.invalidate();
      await load(true);
    } catch (e: any) {
      notify("Errore", e?.message || "Errore");
    }
  };

  const removeFromSelection = async (id: string) => {
    const m = items.find((x) => x.id === id);
    setItems((arr) => arr.filter((x) => x.id !== id));
    selectedListCache.invalidate();
    if (m?.day) matchesCache.invalidate(m.day);
    if (m) toast.show(`Rimossa: ${m.squadra1} vs ${m.squadra2}`, "info");
    try { await api.updateSelection([id], false); } catch {}
  };

  const clearAll = () => {
    confirmAction({
      title: "Deseleziona tutte?",
      message: "Tutte le partite selezionate verranno rimosse dalla selezione.",
      confirmText: "Svuota",
      destructive: true,
      onConfirm: async () => {
        // Optimistic UI
        setItems([]);
        selectedListCache.invalidate();
        matchesCache.invalidate(); // tutti i giorni
        try { await api.clearSelection(); } catch (e) { console.warn(e); }
        await load(true);
        toast.show("Selezione svuotata", "info");
      },
    });
  };

  const saveAll = async () => {
    const payload = Object.entries(results)
      .filter(([, v]) => v.trim())
      .map(([id, result]) => ({ id, result: result.trim() }));
    if (payload.length === 0) {
      notify("Vuoto", "Inserisci almeno un risultato");
      return;
    }
    try {
      const out = await api.bulkResults(payload);
      // Invalida le cache (altrimenti tornando su questa schermata o sulla
      // lista partite si rivedrebbero i dati vecchi) e ricarica per riflettere
      // subito i risultati salvati (necessario anche per il colore vinto/perso).
      selectedListCache.invalidate();
      for (const { id } of payload) {
        const m = items.find((x) => x.id === id);
        if (m?.day) matchesCache.invalidate(m.day);
      }
      // Ogni risultato salvato aggiorna anche market_scores/family_counters
      // (lo storico usato dal Profilo e dal correttivo del motore): senza
      // invalidare queste cache, il Profilo potrebbe mostrare numeri vecchi
      // fino a 5 minuti dopo il salvataggio.
      marketStatsCache.invalidate();
      mlStatsCache.invalidate();
      await load(true);
      notify("Salvato", `${out.updated} risultati aggiornati`);
    } catch (e: any) {
      notify("Errore", e?.message);
    }
  };

  /**
   * Analisi delle SOLE partite selezionate su un sito esterno.
   *
   * 19/09/2026 — La logica era scritta dentro l'onPress del tasto TypingMind.
   * Ora le destinazioni sono due (TypingMind e Battle Agent Arena) con lo
   * STESSO prompt, quindi la stessa identica funzione serve a entrambi i tasti:
   * cambia solo l'indirizzo. Il comportamento del tasto TypingMind non cambia
   * di una virgola — copia prima e apre dopo, perche' aprendo prima il
   * documento perde il fuoco e la copia negli appunti fallisce.
   */
  const apriAnalisiEsterna = async (url: string, nomeSito: string) => {
    if (items.length === 0) { notify("Vuoto", "Nessuna partita selezionata"); return; }
    try {
      // 16/09/2026 — NIENTE PIU' INVOLUCRO. Il prompt del server veniva
      // infilato dentro AISTUDIO_FRAMEWORK al posto di {{CSV}}: quel framework
      // e' una consegna DIVERSA ("raccoglitore dati web, non fare EV
      // matematico") e si aspettava una semplice tabella di quote. Ricevendo un
      // prompt completo, il modello si trovava due consegne opposte e seguiva
      // la prima. Il testo di /aistudio-prompt va incollato cosi' com'e'.
      const { csv: filled, count } = await api.aiStudioPrompt();

      // Copia e apertura stanno in apriConPrompt: browser, PWA installata e
      // guscio Android si comportano diversamente e vanno gestiti in un posto solo.
      const { copiato, aperto } = await apriConPrompt(url, filled);
      if (!copiato) {
        notify("Prompt non copiato", `Ho aperto ${nomeSito}, ma il telefono non mi ha lasciato scrivere negli appunti. Riprova toccando di nuovo il tasto.`);
        return;
      }
      if (!aperto) {
        notify("Prompt copiato ✓", `${count} partite. Non sono riuscito ad aprire ${nomeSito}: vai su ${url} e incolla.`);
        return;
      }
      notify("Prompt copiato ✓", `${count} partite. Incolla in ${nomeSito}.`);
    } catch (e: any) { notify("Errore", e?.message); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity testID="sel-back" onPress={() => router.replace("/")} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Selezionate ({items.length})</Text>
        <TouchableOpacity testID="sel-clear" onPress={clearAll} style={styles.iconBtn}>
          <Ionicons name="trash-outline" size={20} color={colors.danger} />
        </TouchableOpacity>
      </View>

      {/* I tasti azione stanno su una riga propria: 19/09/2026, con l'aggiunta di
          BATTLE ARENA erano quattro elementi piu' il titolo nella stessa riga e
          su un telefono stretto finivano schiacciati o fuori schermo. La riga
          scorre in orizzontale, cosi' regge anche schermi piccoli. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // Senza questo la ScrollView, che ha flexGrow 1 di suo, si mangerebbe
        // l'altezza della lista sottostante.
        style={styles.azioniWrap}
        contentContainerStyle={styles.azioni}
      >
        <TouchableOpacity
          testID="sel-aistudio"
          onPress={() => apriAnalisiEsterna(AI_CHAT_URL, AI_CHAT_NAME)}
          style={styles.aiStudioBtn}
        >
          <Ionicons name="planet" size={14} color={colors.primary} />
          <Text style={styles.aiStudioBtnTxt}>TYPINGMIND</Text>
        </TouchableOpacity>
        {/* Stessa analisi, stesso prompt, altro sito (19/09/2026). */}
        <TouchableOpacity
          testID="sel-arena"
          onPress={() => apriAnalisiEsterna(ARENA_URL, ARENA_NAME)}
          style={[styles.aiStudioBtn, { borderColor: "#A78BFA" }]}
        >
          <Ionicons name="rocket" size={14} color="#A78BFA" />
          <Text style={[styles.aiStudioBtnTxt, { color: "#A78BFA" }]}>BATTLE ARENA</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="sel-ai"
          onPress={generaAI}
          disabled={srv.inCorso || items.length === 0}
          style={[styles.aiStudioBtn, { borderColor: colors.primary, opacity: items.length === 0 || srv.inCorso ? 0.5 : 1 }]}
        >
          {srv.inCorso && srv.lavoro?.tipo === "ai_schedina" ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <>
              <Ionicons name="sparkles" size={14} color={colors.primary} />
              <Text style={styles.aiStudioBtnTxt}>PRONOSTICI AI</Text>
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          testID="sel-autofetch"
          onPress={autoFetchResults}
          disabled={fetchingResults || items.length === 0}
          style={[styles.aiStudioBtn, { borderColor: "#10B981", opacity: items.length === 0 ? 0.5 : 1 }]}
        >
          {fetchingResults ? (
            <ActivityIndicator size="small" color="#10B981" />
          ) : (
            <>
              <Ionicons name="refresh-circle" size={14} color="#10B981" />
              <Text style={[styles.aiStudioBtnTxt, { color: "#10B981" }]}>RISULTATI</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
      {srv.lavoro?.tipo === "ai_schedina" && srv.inCorso ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <LavoroBox lavoro={srv.lavoro} onFerma={srv.ferma} />
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="albums-outline" size={56} color={colors.textDim} />
          <Text style={styles.emptyTxt}>Nessuna partita selezionata</Text>
        </View>
      ) : (
        <>
          {reviewList.length > 0 && (
            <View style={styles.reviewBanner}>
              <Ionicons name="warning" size={16} color="#F59E0B" />
              <View style={{ flex: 1 }}>
                <Text style={styles.reviewTitle}>{reviewList.length} risultati da confermare</Text>
                <Text style={styles.reviewHint}>Confidence sotto soglia (80%). Verifica e conferma manualmente.</Text>
              </View>
            </View>
          )}
          {reviewList.map((r, i) => {
            const matched = items.find((m) => m.id === r.id);
            return (
              <View key={i} style={styles.reviewItem}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.reviewMatch}>{matched ? `${matched.squadra1} – ${matched.squadra2}` : r.id}</Text>
                  <Text style={styles.reviewSub}>Sofascore: {r.matched} → {r.score} (conf {r.confidence}%)</Text>
                </View>
                <TouchableOpacity onPress={() => applyReview(r)} style={styles.reviewApply}>
                  <Ionicons name="checkmark" size={14} color="#FFF" />
                  <Text style={styles.reviewApplyTxt}>Conferma</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setReviewList(reviewList.filter((x) => x.id !== r.id))} style={styles.reviewSkip}>
                  <Ionicons name="close" size={14} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            );
          })}
          <ScrollView contentContainerStyle={styles.list} onScroll={(e) => bottomNav.handleScroll(e.nativeEvent.contentOffset.y)} scrollEventThrottle={16} decelerationRate="fast">
            {items.map((m) => {
              // 27/09/2026 — La card mostrava `quickPrediction`, un'euristica
              // calcolata sul momento dalle sole quote, che non conosce ne' il
              // motore ne' l'IA ne' lo storico. Sembrava un pronostico del
              // sistema e non lo era. Ora mostra `pick_finale`, cioe' il
              // VERDETTO vero della fusione; l'euristica e' rimasta dove ha
              // senso, nelle statistiche del dettaglio partita, con scritto
              // cos'e'. Quando il verdetto non c'e' ancora (partita mai
              // aperta), la card lo dice invece di inventare.
              const verdetto = m.pick_finale || null;
              const lc = parseLeagueCode(m.manifestazione);
              const preOutcome = m.result && verdetto ? evaluateMarketOutcome(verdetto, m.result) : null;
              const aiOutcome = m.result && m.main_prediction ? evaluateMarketOutcome(m.main_prediction, m.result) : null;
              const outcomeStyle = (o: boolean | null) =>
                o === true ? { backgroundColor: "rgba(16,185,129,0.20)", borderColor: colors.success }
                : o === false ? { backgroundColor: "rgba(239,68,68,0.20)", borderColor: colors.danger }
                : null;
              return (
              <View key={m.id} style={styles.card}>
                <TouchableOpacity
                  testID={`sel-open-${m.id}`}
                  onPress={() => router.push(`/match/${m.id}`)}
                  style={styles.cardLeft}
                >
                  <Text style={styles.cardLeague}>{lc.shortLabel}</Text>
                  <Text style={styles.cardTeams}>{m.squadra1} – {m.squadra2}</Text>
                  <Text style={styles.cardWhen}>{m.day} · {m.time}</Text>
                  <View style={styles.predRow}>
                    {verdetto ? (
                      <View style={[styles.preTag, outcomeStyle(preOutcome)]}>
                        <Ionicons name="flash" size={10} color={colors.primary} />
                        <Text style={styles.preTagTxt}>{verdetto}</Text>
                        {m.pick_finale_prob ? (
                          <Text style={styles.preTagOdd}>{Math.round(m.pick_finale_prob * 100)}%</Text>
                        ) : null}
                      </View>
                    ) : (
                      <View style={[styles.preTag, { borderStyle: "dashed" }]}>
                        <Ionicons name="help-circle-outline" size={10} color={colors.textDim} />
                        <Text style={[styles.preTagTxt, { color: colors.textDim }]}>apri per il verdetto</Text>
                      </View>
                    )}
                    {/* IL CONSIGLIATO (07/10/2026): lo stesso della scheda partita,
                        confermato o cambiato dal Pronostico AI. */}
                    {(m as any).consigliato?.market ? (
                      <View style={[styles.predTag, outcomeStyle(m.result ? evaluateMarketOutcome((m as any).consigliato.market, m.result) : null)]}>
                        <Ionicons name={(m as any).consigliato.ai ? "sparkles" : "checkmark-circle"} size={10} color={colors.aiText} />
                        <Text style={styles.predTagTxt}>
                          {`${(m as any).consigliato.nome} ${(m as any).consigliato.stimata ? "≈" : "@"}${Number((m as any).consigliato.quota).toFixed(2)}`}
                          {(m as any).consigliato.ai === "confermato" ? " · ✓ AI" : (m as any).consigliato.ai === "cambiato" ? " · cambiato dall'AI" : ""}
                        </Text>
                      </View>
                    ) : (m as any).consigliato?.daLasciare ? (
                      <View style={[styles.predTag, { borderStyle: "dashed" }]}>
                        <Text style={[styles.predTagTxt, { color: colors.warning }]}>da lasciare</Text>
                      </View>
                    ) : null}
                  </View>
                </TouchableOpacity>
                <View style={styles.cardRight}>
                  <ScoreInput
                    value={results[m.id] || ""}
                    onChange={(v) => setResults({ ...results, [m.id]: v })}
                    size="sm"
                    testIDPrefix={`sel-res-${m.id}`}
                  />
                  <TouchableOpacity
                    testID={`sel-remove-${m.id}`}
                    onPress={() => removeFromSelection(m.id)}
                    style={styles.removeBtn}
                  >
                    <Ionicons name="close" size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              </View>
              );
            })}
            <View style={{ height: 100 }} />
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity testID="save-all" onPress={saveAll} style={styles.saveAllBtn}>
              <Ionicons name="save" size={18} color="#FFF" />
              <Text style={styles.saveAllTxt}>Salva Tutti i Risultati</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
      <BottomNav />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { padding: 8 },
  title: { flex: 1, color: colors.text, fontSize: 16, fontWeight: "800", textAlign: "center" },
  azioniWrap: { flexGrow: 0, flexShrink: 0 },
  azioni: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  aiStudioBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(255,87,34,0.15)", borderWidth: 1, borderColor: colors.primary,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
  },
  aiStudioBtnTxt: { color: colors.primary, fontWeight: "900", fontSize: 10, letterSpacing: 0.5 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  emptyTxt: { color: colors.textMuted, fontSize: 14 },
  // La BottomNav sta NEL FLUSSO in fondo alla schermata: lo spazio se lo prende
  // da sola, quindi qui basta un margine di respiro. I 130px precedenti erano
  // pensati per una barra flottante e lasciavano un buco in fondo a ogni lista.
  list: { padding: 16, paddingBottom: 24, gap: 10 },
  card: { flexDirection: "row", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, gap: 10 },
  cardLeft: { flex: 1 },
  cardLeague: { color: colors.primary, fontSize: 10, fontWeight: "900", letterSpacing: 1, textTransform: "uppercase" },
  cardTeams: { color: colors.text, fontSize: 14, fontWeight: "800", marginTop: 2 },
  cardWhen: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  predTag: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", backgroundColor: colors.aiBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  predTagTxt: { color: colors.aiText, fontSize: 10, fontWeight: "800" },
  predRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  preTag: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", backgroundColor: "rgba(255,140,0,0.18)", borderWidth: 1, borderColor: "rgba(255,140,0,0.45)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  preTagTxt: { color: colors.primary, fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },
  preTagOdd: { color: colors.text, fontSize: 10, fontWeight: "700", opacity: 0.85 },
  cardRight: { alignItems: "flex-end", gap: 6 },
  resInput: { width: 70, backgroundColor: colors.surfaceHi, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, color: colors.text, textAlign: "center", fontWeight: "700" },
  removeBtn: { padding: 4 },
  footer: { padding: 16, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg },
  saveAllBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.primary, paddingVertical: 14, borderRadius: 12 },
  saveAllTxt: { color: "#FFF", fontWeight: "900", fontSize: 14, letterSpacing: 0.5 },
  reviewBanner: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, marginHorizontal: 16, marginTop: 8, backgroundColor: "rgba(245,158,11,0.10)", borderWidth: 1, borderColor: "rgba(245,158,11,0.35)", borderRadius: 10 },
  reviewTitle: { color: "#F59E0B", fontSize: 12, fontWeight: "900" },
  reviewHint: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  reviewItem: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, marginHorizontal: 16, marginTop: 6, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8 },
  reviewMatch: { color: colors.text, fontSize: 12, fontWeight: "800" },
  reviewSub: { color: colors.textMuted, fontSize: 10, marginTop: 2 },
  reviewApply: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#10B981", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  reviewApplyTxt: { color: "#FFF", fontWeight: "900", fontSize: 10 },
  reviewSkip: { padding: 6 },
});
