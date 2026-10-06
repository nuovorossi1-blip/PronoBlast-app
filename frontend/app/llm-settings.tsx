import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, TextInput, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api";
import { colors } from "@/src/theme";
import BottomNav from "@/src/components/BottomNav";
import { confirmAction, notify, openExternalUrl } from "@/src/utils/platform";

export default function LlmSettings() {
  const router = useRouter();
  const [options, setOptions] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [budget, setBudget] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  // Modelli OpenRouter dal vivo (06/10/2026): credito, interruttore "piu'
  // economico", ricerca su tutto il catalogo. Il catalogo si carica solo
  // quando si apre la sezione (sono ~400 modelli).
  const [orInfo, setOrInfo] = useState<any>(null);
  const [selected, setSelected] = useState<any>(null);
  const [catalogo, setCatalogo] = useState<any[] | null>(null);
  const [caricoCatalogo, setCaricoCatalogo] = useState(false);
  const [cerca, setCerca] = useState("");
  const [filtro, setFiltro] = useState<"tutti" | "gratis" | "strumenti">("tutti");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [llm, bud] = await Promise.all([api.getLlmSettings(), api.getBudget()]);
      setOptions(llm.options);
      setSelectedId(llm.selected_id);
      setSelected(llm.selected);
      setOrInfo(llm.openrouter);
      setBudget(bud);
    } finally { setLoading(false); }
  }, []);

  const apriCatalogo = async () => {
    setCaricoCatalogo(true);
    try { setCatalogo((await api.getCatalogoOpenRouter()).modelli); }
    catch (e: any) { notify("Errore", e?.message); }
    finally { setCaricoCatalogo(false); }
  };

  const cambiaEconomico = async (v: boolean) => {
    setOrInfo((x: any) => ({ ...x, economico: v }));
    try { await api.setOpenRouterEconomico(v); } catch (e: any) { notify("Errore", e?.message); load(); }
  };

  const opzioniDi = (provider: string[]) => options.filter((o) => provider.includes(o.provider));
  const opzione = (o: any) => {
    const active = o.id === selectedId;
    const attivo = o.configured !== false;
    return (
      <TouchableOpacity key={o.id} testID={`llm-${o.id}`}
        onPress={() => attivo ? select(o.id) : notify("Modello non attivo", `${o.label}: manca la chiave API sul server.`)}
        style={[styles.opt, active && styles.optActive, !attivo && { opacity: 0.45 }]}>
        <View style={[styles.radio, active && styles.radioOn]}>{active && <Ionicons name="checkmark" size={14} color="#FFF" />}</View>
        <View style={{ flex: 1 }}>
          <Text style={styles.optLabel}>{o.label}</Text>
          <Text style={styles.optDesc}>{o.desc}</Text>
          <View style={styles.optMeta}>
            <Text style={styles.tag}>{o.speed}</Text>
            <Text style={styles.tag}>{o.quality}</Text>
            <Text style={styles.tagCost}>{o.cost_per_pred > 0 ? `$${o.cost_per_pred.toFixed(4)}/pred · ~€${(o.cost_per_pred * 40 * 30 * 0.93).toFixed(2)}/mese` : "Gratis"}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const filtrati = (catalogo || []).filter((m) => {
    if (filtro === "gratis" && !m.gratis) return false;
    if (filtro === "strumenti" && !m.strumenti) return false;
    const q = cerca.trim().toLowerCase();
    return !q || m.id.toLowerCase().includes(q) || m.nome.toLowerCase().includes(q);
  });

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const select = async (id: string) => {
    setSelectedId(id);
    try { await api.setLlmSettings(id); await load(); } catch (e: any) { notify("Errore", e?.message); }
  };

  const resetBudget = () => confirmAction({
    title: "Azzerare conteggio?", message: "Verrà azzerato il contatore di spesa stimato.", confirmText: "Azzera", destructive: true,
    onConfirm: async () => { await api.resetBudget(); load(); },
  });

  if (loading) return <SafeAreaView style={styles.safe}><ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace("/strumenti")} style={styles.iconBtn}><Ionicons name="chevron-back" size={22} color={colors.text} /></TouchableOpacity>
        <Text style={styles.title}>LLM & Budget</Text>
        <TouchableOpacity onPress={resetBudget} style={styles.iconBtn}><Ionicons name="refresh-outline" size={20} color={colors.danger} /></TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {/* Budget card */}
        {budget && (
          <View style={styles.budgetCard}>
            <Text style={styles.budgetLbl}>SPESA AI STIMATA DA PRONOBLAST</Text>
            <Text style={styles.budgetVal}>${budget.estimated_spent_usd.toFixed(4)}</Text>
            <Text style={styles.budgetDetail}>{budget.predictions_made} pronostici AI dall'ultimo azzeramento</Text>
            <Text style={styles.budgetDetail}>Modello in uso: {budget.current_model} · ~${budget.cost_per_prediction_usd.toFixed(4)} a pronostico</Text>
            <Text style={styles.budgetHint}>È una stima fatta dall'app (costo medio × pronostici), non il conto vero dei fornitori: quello è sui loro siti. Il tasto ↻ in alto la azzera.</Text>
            {budget.cost_per_prediction_usd > 0 ? (
              <>
                <TouchableOpacity onPress={() => openExternalUrl(budget.topup_url)} style={styles.topupBtn}>
                  <Ionicons name="card-outline" size={16} color="#FFF" />
                  <Text style={styles.topupTxt}>RICARICA CREDITO</Text>
                </TouchableOpacity>
                <Text style={styles.budgetHint}>Apre la pagina di ricarica di {budget.current_model}</Text>
              </>
            ) : (
              <Text style={styles.budgetHint}>✓ {budget.current_model} è gratuito — nessuna ricarica necessaria</Text>
            )}
          </View>
        )}
        {/* Crediti della ricerca web (Tavily): dato vero letto da Tavily, non una stima */}
        {budget?.tavily && (
          <View style={styles.budgetCard}>
            <Text style={styles.budgetLbl}>RICERCA WEB (TAVILY) · CREDITI DEL MESE</Text>
            <Text style={[styles.budgetVal, budget.tavily.usati >= budget.tavily.tetto && { color: colors.danger }]}>
              {budget.tavily.usati}<Text style={styles.budgetDetail}> / {budget.tavily.limite ?? "?"}</Text>
            </Text>
            <Text style={styles.budgetDetail}>Piano {budget.tavily.piano || "?"} · ricerca ferma a {budget.tavily.tetto} crediti</Text>
            <Text style={styles.budgetHint}>
              {budget.tavily.usati >= budget.tavily.tetto
                ? "Tetto raggiunto: i pronostici si fanno senza dati dal web fino al mese prossimo"
                : `~${Math.floor((budget.tavily.tetto - budget.tavily.usati) / 6)} pronostici nuovi con il web · "Rigenera" riusa il dossier salvato`}
            </Text>
          </View>
        )}
        <Text style={styles.section}>SCEGLI MODELLO LLM</Text>

        {/* Modelli divisi per servizio (06/10/2026): prima erano tutti in fila e
            non si capiva quali passavano da OpenRouter e quali no. */}
        <Text style={styles.gruppo}>DEEPSEEK · DIRETTO</Text>
        <Text style={styles.gruppoNota}>Chiave DeepSeek: si paga sul sito di DeepSeek.</Text>
        {opzioniDi(["deepseek"]).map(opzione)}

        <Text style={styles.gruppo}>OPENROUTER</Text>
        <Text style={styles.gruppoNota}>Credito OpenRouter (sotto). I modelli "gratis" non lo consumano: usano le richieste gratuite del giorno.</Text>
        {opzioniDi(["openrouter"]).map(opzione)}
        {selectedId?.startsWith("or:") && selected && (
          <View style={[styles.opt, styles.optActive]}>
            <View style={[styles.radio, styles.radioOn]}><Ionicons name="checkmark" size={14} color="#FFF" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.optLabel}>{selected.label}</Text>
              <Text style={styles.optDesc}>{selected.model} · {selected.desc}</Text>
              <View style={styles.optMeta}>
                <Text style={styles.tagCost}>${Number(selected.cost_per_pred || 0).toFixed(4)}/pred · ~€{(Number(selected.cost_per_pred || 0) * 40 * 30 * 0.93).toFixed(2)}/mese</Text>
              </View>
            </View>
          </View>
        )}
        {/* Tutti i modelli OpenRouter dal vivo */}
        {orInfo?.configurato && (
          <>
            <Text style={styles.gruppoNota}>Tutti i modelli OpenRouter, letti dal vivo:</Text>
            <View style={styles.budgetCard}>
              <Text style={styles.budgetLbl}>CREDITO OPENROUTER</Text>
              {orInfo.credito ? (
                <>
                  <Text style={styles.budgetVal}>${orInfo.credito.residuo.toFixed(2)}</Text>
                  <Text style={styles.budgetDetail}>residuo · caricati ${orInfo.credito.caricato.toFixed(2)} · usati ${orInfo.credito.usato.toFixed(2)}</Text>
                  {orInfo.credito.gratis_oggi && (
                    <Text style={styles.budgetDetail}>Richieste gratuite oggi: {orInfo.credito.gratis_oggi.used} usate su {orInfo.credito.gratis_oggi.limit}</Text>
                  )}
                </>
              ) : <Text style={styles.budgetDetail}>Credito non disponibile</Text>}
              <TouchableOpacity onPress={() => openExternalUrl("https://openrouter.ai/settings/credits")} style={styles.topupBtn}>
                <Ionicons name="card-outline" size={16} color="#FFF" />
                <Text style={styles.topupTxt}>RICARICA OPENROUTER</Text>
              </TouchableOpacity>
            </View>
            <View style={[styles.opt, { justifyContent: "space-between" }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.optLabel}>Fornitore più economico automatico</Text>
                <Text style={styles.optDesc}>Ogni pronostico va al fornitore OpenRouter più conveniente del momento: gli sconti si prendono da soli.</Text>
              </View>
              <Switch value={!!orInfo.economico} onValueChange={cambiaEconomico} trackColor={{ true: colors.primary, false: colors.borderLight }} />
            </View>
            {!catalogo ? (
              <TouchableOpacity onPress={apriCatalogo} style={styles.opt} disabled={caricoCatalogo}>
                {caricoCatalogo ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="list-outline" size={20} color={colors.primary} />}
                <Text style={styles.optLabel}>Mostra tutti i modelli OpenRouter</Text>
              </TouchableOpacity>
            ) : (
              <>
                <TextInput value={cerca} onChangeText={setCerca} placeholder="Cerca (deepseek, glm, nemotron, claude…)"
                  placeholderTextColor={colors.textDim} style={styles.cerca} autoCapitalize="none" autoCorrect={false} />
                <View style={styles.optMeta}>
                  {(["tutti", "gratis", "strumenti"] as const).map((f) => (
                    <TouchableOpacity key={f} onPress={() => setFiltro(f)}>
                      <Text style={filtro === f ? styles.tagCost : styles.tag}>{f === "tutti" ? "Tutti" : f === "gratis" ? "Gratis" : "Con strumenti"}</Text>
                    </TouchableOpacity>
                  ))}
                  <Text style={styles.tag}>{filtrati.length} modelli</Text>
                </View>
                {filtrati.slice(0, 60).map((m) => {
                  const id = `or:${m.id}`;
                  const active = id === selectedId;
                  return (
                    <TouchableOpacity key={m.id} onPress={() => select(id)} style={[styles.opt, active && styles.optActive]}>
                      <View style={[styles.radio, active && styles.radioOn]}>{active && <Ionicons name="checkmark" size={14} color="#FFF" />}</View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.optLabel}>{m.nome}</Text>
                        <Text style={styles.optDesc}>{m.id}</Text>
                        <View style={styles.optMeta}>
                          <Text style={styles.tagCost}>{m.gratis ? "Gratis" : m.costo != null ? `$${m.costo.toFixed(4)}/pred · ~€${(m.costo * 40 * 30 * 0.93).toFixed(2)}/mese` : "prezzo ?"}</Text>
                          {!m.gratis && m.in_m != null && <Text style={styles.tag}>${m.in_m} / ${m.out_m} per M</Text>}
                          {!m.strumenti && <Text style={styles.tag}>no strumenti</Text>}
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}
                {filtrati.length > 60 && <Text style={styles.budgetHint}>Mostrati i primi 60 (dal più economico): usa la ricerca per gli altri.</Text>}
              </>
            )}
          </>
        )}

        <Text style={styles.gruppo}>GROQ · GRATIS</Text>
        <Text style={styles.gruppoNota}>Gratis, ma il pronostico completo (~10.000 token) supera il limite del piano gratuito: di solito non risponde.</Text>
        {opzioniDi(["groq"]).map(opzione)}

        {opzioniDi(["gemini", "anthropic", "openai"]).length > 0 && (
          <>
            <Text style={styles.gruppo}>NON ATTIVI · MANCA LA CHIAVE</Text>
            <Text style={styles.gruppoNota}>Per usarli serve la loro chiave API sul server. Claude, GPT e Gemini si possono usare anche da OpenRouter, nell'elenco sopra.</Text>
            {opzioniDi(["gemini", "anthropic", "openai"]).map(opzione)}
          </>
        )}
        <View style={{ height: 100 }} />
      </ScrollView>
      <BottomNav />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { padding: 8 },
  title: { flex: 1, color: colors.text, fontSize: 18, fontWeight: "900", textAlign: "center" },
  list: { padding: 16, paddingBottom: 28, gap: 10 },
  budgetCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.border, alignItems: "center", gap: 6 },
  budgetLbl: { color: colors.textMuted, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  budgetVal: { color: colors.primary, fontSize: 36, fontWeight: "900" },
  budgetDetail: { color: colors.textMuted, fontSize: 12 },
  topupBtn: { flexDirection: "row", gap: 6, backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10, marginTop: 8 },
  topupTxt: { color: "#FFF", fontWeight: "900", fontSize: 12, letterSpacing: 0.5 },
  budgetHint: { color: colors.textDim, fontSize: 10, marginTop: 4 },
  section: { color: colors.primary, fontSize: 11, fontWeight: "900", letterSpacing: 1.5, marginTop: 12 },
  opt: { flexDirection: "row", gap: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, alignItems: "center" },
  optActive: { borderColor: colors.primary, backgroundColor: "rgba(255,140,66,0.08)" },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.borderLight, alignItems: "center", justifyContent: "center" },
  radioOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  optLabel: { color: colors.text, fontSize: 14, fontWeight: "900" },
  optDesc: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  optMeta: { flexDirection: "row", gap: 6, marginTop: 6 },
  tag: { backgroundColor: colors.surfaceHi, color: colors.textMuted, fontSize: 9, fontWeight: "700", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tagCost: { backgroundColor: "rgba(255,140,66,0.15)", color: colors.primary, fontSize: 9, fontWeight: "800", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  gruppo: { color: colors.text, fontSize: 12, fontWeight: "900", letterSpacing: 1, marginTop: 14 },
  gruppoNota: { color: colors.textMuted, fontSize: 11, marginTop: -4 },
  cerca: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, fontSize: 13 },
});
