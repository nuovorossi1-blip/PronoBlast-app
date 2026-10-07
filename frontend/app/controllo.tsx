import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { api, PagellaConsigliato } from "@/src/api";
import { colors, spacing } from "@/src/theme";
import BottomNav from "@/src/components/BottomNav";

/**
 * PAGELLA DEL CONSIGLIATO (07/10/2026, Rossi: "serve piu' a te per capire se
 * stiamo andando nella direzione giusta"). Si riempie da sola con le partite
 * finite che hanno i dati salvati dal 07/10. Vedi pagella-consigliato.ts.
 */
const pc = (v: number, n: number) => (n ? `${Math.round((v / n) * 1000) / 10}%` : "–");

export default function PagellaConsigliatoPagina() {
  const router = useRouter();
  const [d, setD] = useState<PagellaConsigliato | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const carica = useCallback(() => {
    setLoading(true);
    api.pagellaConsigliato()
      .then((r) => { setD(r); setErr(null); })
      .catch((e) => setErr(String(e?.message || e)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { carica(); }, [carica]);

  const riga = (et: string, v: string, nota?: string) => (
    <View style={styles.riga} key={et}>
      <Text style={styles.et}>{et}</Text>
      <Text style={styles.val}>{v}</Text>
      {nota ? <Text style={styles.nota}>{nota}</Text> : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Pagella del consigliato</Text>
          <Text style={styles.subtitle}>Stiamo andando nella direzione giusta?</Text>
        </View>
        <TouchableOpacity style={styles.backBtn} onPress={carica}>
          <Ionicons name="refresh" size={20} color={colors.text} />
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {loading ? <ActivityIndicator color={colors.primary} /> : null}
        {err ? <Text style={styles.err}>{err}</Text> : null}
        {d ? (
          <>
            <Text style={styles.intro}>
              {`Partite finite misurate: ${d.partite_misurate}. I dati si salvano dal 07/10/2026; con poche partite i numeri cambiano molto, servono almeno 50-100 partite per fidarsi.`}
            </Text>

            <Text style={styles.sez}>1. IL CONSIGLIATO</Text>
            {riga("Vinte", `${d.consigliato.vinte} su ${d.consigliato.n} · ${pc(d.consigliato.vinte, d.consigliato.n)}`)}
            {riga("Resa", d.consigliato.resa == null ? "–" : `${d.consigliato.resa > 0 ? "+" : ""}${d.consigliato.resa}%`, "guadagno medio per giocata con la sua quota (alcune quote sono stimate)")}
            {riga("Confermati dal Pronostico AI", `${d.confermati_ai.vinte} su ${d.confermati_ai.n} · ${pc(d.confermati_ai.vinte, d.confermati_ai.n)}`)}

            <Text style={styles.sez}>2. CAMBI DEL PRONOSTICO AI</Text>
            {riga("Partite cambiate", `${d.cambi_ai.n}`)}
            {riga("Aveva ragione l'AI", `${d.cambi_ai.ai_vinte} · ${pc(d.cambi_ai.ai_vinte, d.cambi_ai.n)}`)}
            {riga("Avrebbero vinto i numeri", `${d.cambi_ai.numeri_vinte} · ${pc(d.cambi_ai.numeri_vinte, d.cambi_ai.n)}`, "se l'AI vince più dei numeri, il cambio serve")}
            {d.cambi_ai.esempi.map((e) => <Text key={e} style={styles.esempio}>{e}</Text>)}

            <Text style={styles.sez}>3. PARTITE "DA LASCIARE"</Text>
            {riga("Se le avessi giocate", `${d.da_lasciare.vinte} su ${d.da_lasciare.n} · ${pc(d.da_lasciare.vinte, d.da_lasciare.n)}`, "se è molto più basso del consigliato, lasciarle è giusto")}

            <Text style={styles.sez}>4. LETTURE AI</Text>
            {Object.entries(d.letture).map(([chi, x]) => (
              <View key={chi} style={styles.lett}>
                <Text style={styles.lettNome}>{chi}</Text>
                <Text style={styles.nota}>
                  {`${x.n} partite · direzione giusta ${x.dir_ok} su ${x.dir_date} (${pc(x.dir_ok, x.dir_date)}) · gol totali nella forchetta ${pc(x.tot_ok, x.n)} · risultato fra i più vicini ${pc(x.ris_ok, x.n)}`}
                </Text>
              </View>
            ))}

            <Text style={styles.sez}>5. MULTIPLE DALLA MULTIPLA</Text>
            {riga("Messe in Schedina", `${d.multiple.n}`)}
            {riga("Vinte (fra le finite)", `${d.multiple.vinte} su ${d.multiple.finite} · ${pc(d.multiple.vinte, d.multiple.finite)}`,
              d.multiple.quote_vinte.length ? `quote vinte: ${d.multiple.quote_vinte.map((q) => q.toFixed(2)).join(", ")}` : undefined)}
          </>
        ) : null}
      </ScrollView>
      <BottomNav />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: { padding: spacing.xs, marginRight: spacing.sm },
  title: { color: colors.text, fontSize: 18, fontWeight: "700" },
  subtitle: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  body: { padding: spacing.lg, paddingBottom: 24, gap: 6 },
  intro: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  sez: { color: colors.primary, fontSize: 12, fontWeight: "900", letterSpacing: 1, marginTop: 14 },
  riga: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 6 },
  et: { color: colors.textMuted, fontSize: 12 },
  val: { color: colors.text, fontSize: 16, fontWeight: "900" },
  nota: { color: colors.textDim, fontSize: 11, lineHeight: 15 },
  esempio: { color: colors.textMuted, fontSize: 11, lineHeight: 15 },
  lett: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 6, gap: 2 },
  lettNome: { color: colors.text, fontSize: 13, fontWeight: "800" },
  err: { color: colors.warning, fontSize: 13 },
});
