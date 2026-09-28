import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/src/theme";
import { api, PickLocaleResponse, VocePattern } from "@/src/api";
import { notify } from "@/src/utils/platform";

/**
 * PICK LOCALE — i sei passi, a schermo.
 *
 * Sostituisce il blocco "EURISTICA RAPIDA", che mostrava il risultato di una
 * scaletta di soglie fisse sulle quote, senza modello sotto e senza modo di
 * capire da dove uscisse il pick.
 *
 * Qui si vede tutto il ragionamento: quote depurate, lambda cercati, i due
 * cluster dei risultati attesi (teorico da Poisson e reale dalle partite con
 * quote simili), quanto ognuno dei 15 pattern li copre, cosa e' stato scartato
 * e perche', e la classifica divisa per fasce di quota.
 *
 * Si carica a richiesta: il server deve confrontare le quote con ottomila
 * partite concluse, non ha senso farlo all'apertura di ogni scheda.
 */
export default function PickLocale({ matchId }: { matchId: string }) {
  const [dati, setDati] = useState<PickLocaleResponse | null>(null);
  const [carico, setCarico] = useState(false);
  const [apri, setApri] = useState<"cluster" | "pattern" | "scarti" | null>(null);

  const calcola = async () => {
    setCarico(true);
    try {
      setDati(await api.pickLocale(matchId));
    } catch (e: any) {
      notify("Errore", e?.message);
    } finally {
      setCarico(false);
    }
  };

  const teo = dati?.passo3_cluster_teorico;
  const rea = dati?.passo3_cluster_reale;
  const conReale = !!rea?.voci?.length;

  /** La probabilita' su cui si ordina: il reale quando c'e', il teorico quando
   *  il campione e' troppo piccolo. Entrambi restano visibili. */
  const prob = (v: VocePattern) => v.reale_clu ?? v.teorico_clu;

  return (
    <View style={s.blocco}>
      <View style={s.testa}>
        <Ionicons name="calculator-outline" size={14} color={colors.primary} />
        <Text style={s.titolo}>PICK LOCALE · sei passi</Text>
      </View>

      {!dati && !carico && (
        <>
          <Text style={s.nota}>
            Depura le quote, cerca i λ che le riproducono meglio, costruisce i risultati attesi
            (dalla teoria e dalle partite con quote simili), misura quanto ognuno dei 15 pattern li copre,
            scarta sotto 1,35 e ordina per fasce di quota.
          </Text>
          <TouchableOpacity testID="calcola-pick-locale" onPress={calcola} style={s.tasto}>
            <Ionicons name="play-outline" size={16} color={colors.primary} />
            <Text style={s.tastoTxt}>Calcola</Text>
          </TouchableOpacity>
        </>
      )}

      {carico && <ActivityIndicator color={colors.primary} style={{ marginVertical: 14 }} />}

      {dati && !dati.ok && <Text style={s.nota}>{dati.motivo || dati.error}</Text>}

      {dati?.ok && (
        <>
          {/* PASSI 1 e 2 */}
          <Text style={s.riga}>
            Quote depurate (aggio {dati.passo1_depurate?.aggio_1x2}%): 1 {dati.passo1_depurate?.["1"]}% ·
            X {dati.passo1_depurate?.X}% · 2 {dati.passo1_depurate?.["2"]}% · O2.5 {dati.passo1_depurate?.["O2.5"]}% ·
            GG {dati.passo1_depurate?.GG}%
          </Text>
          <Text style={s.riga}>
            λ cercati · Casa <Text style={s.forte}>{dati.passo2_lambda?.casa.toFixed(2)}</Text> ·
            Ospite <Text style={s.forte}>{dati.passo2_lambda?.ospite.toFixed(2)}</Text> ·
            Totale {dati.passo2_lambda?.totale.toFixed(2)} (errore {dati.passo2_lambda?.errore})
          </Text>

          {/* PASSO 6 — la classifica per fasce, il pezzo che serve davvero */}
          <Text style={s.sezione}>MIGLIORE PER FASCIA DI QUOTA</Text>
          {(dati.passo6_per_fascia || []).map((f) => (
            <View key={f.etichetta} style={s.fascia}>
              <Text style={s.fasciaTit}>{f.etichetta}</Text>
              {f.voci.slice(0, 4).map((v, i) => (
                <View key={v.pattern} style={s.vocePat}>
                  <Text style={[s.pct, i === 0 && { color: colors.primary }]}>{prob(v)}%</Text>
                  <Text style={[s.nomePat, i === 0 && s.forte]}>{v.pattern}</Text>
                  <Text style={s.quota}>
                    @{v.quota?.toFixed(2)}{v.quota_reale ? "" : "~"}
                  </Text>
                </View>
              ))}
            </View>
          ))}
          <Text style={s.nota}>
            La tilde dopo la quota vuol dire stimata dal motore, non letta dal bookmaker: i multigol
            Sisal non li quota, quindi il valore vero potrebbe essere diverso e cadere in un’altra fascia.
            {conReale
              ? ` Ordinato sulle ${rea?.partite_simili} partite con quote simili (±${rea?.tolleranza}).`
              : ` ${rea?.motivo || "Nessun campione storico: ordinato sul solo Poisson."}`}
          </Text>

          {/* PASSO 3 — i risultati attesi */}
          <TouchableOpacity onPress={() => setApri(apri === "cluster" ? null : "cluster")} style={s.apri}>
            <Ionicons name={apri === "cluster" ? "chevron-down" : "chevron-forward"} size={14} color={colors.textMuted} />
            <Text style={s.apriTxt}>RISULTATI ATTESI</Text>
          </TouchableOpacity>
          {apri === "cluster" && (
            <View style={s.riquadro}>
              <Text style={s.sotto}>Teoria (Poisson) · {teo?.risultati} risultati per l’{teo?.massa}%</Text>
              <Text style={s.punteggi}>{(teo?.voci || []).map((v) => `${v.punteggio} ${v.pct}%`).join(" · ")}</Text>
              {conReale ? (
                <>
                  <Text style={[s.sotto, { marginTop: 10 }]}>
                    Storia ({rea?.partite_simili} partite simili) · {rea?.risultati} risultati per l’85%
                  </Text>
                  <Text style={s.punteggi}>{(rea?.voci || []).map((v) => `${v.punteggio} ${v.pct}%`).join(" · ")}</Text>
                </>
              ) : (
                <Text style={[s.nota, { marginTop: 8 }]}>{rea?.motivo}</Text>
              )}
            </View>
          )}

          {/* PASSO 4 — la tabella completa */}
          <TouchableOpacity onPress={() => setApri(apri === "pattern" ? null : "pattern")} style={s.apri}>
            <Ionicons name={apri === "pattern" ? "chevron-down" : "chevron-forward"} size={14} color={colors.textMuted} />
            <Text style={s.apriTxt}>COPERTURA DEI 15 PATTERN</Text>
          </TouchableOpacity>
          {apri === "pattern" && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
              <View style={s.riquadro}>
                <View style={s.vocePat}>
                  <Text style={[s.pct, s.intestazione]}>teoria</Text>
                  <Text style={[s.pct, s.intestazione]}>storia</Text>
                  <Text style={[s.pct, s.intestazione]}>scarto</Text>
                  <Text style={[s.nomePat, s.intestazione]}>pattern</Text>
                </View>
                {[...(dati.passo4_copertura || [])].sort((a, b) => prob(b) - prob(a)).map((v) => (
                  <View key={v.pattern} style={s.vocePat}>
                    <Text style={s.pct}>{v.teorico_clu}%</Text>
                    <Text style={s.pct}>{v.reale_clu != null ? `${v.reale_clu}%` : "—"}</Text>
                    <Text style={[s.pct, v.scarto != null && Math.abs(v.scarto) >= 4
                      ? { color: v.scarto > 0 ? colors.success : colors.warning } : undefined]}>
                      {v.scarto != null ? `${v.scarto > 0 ? "+" : ""}${v.scarto}` : "—"}
                    </Text>
                    <Text style={[s.nomePat, !v.ammesso && { color: colors.textDim, textDecorationLine: "line-through" }]}>
                      {v.pattern}
                    </Text>
                  </View>
                ))}
                <Text style={s.nota}>
                  Scarto oltre 4 punti evidenziato: è dove la storia smentisce la teoria. Poisson tende a
                  sottostimare i mercati con GG, perché assume i due attacchi indipendenti.
                </Text>
              </View>
            </ScrollView>
          )}

          {/* PASSO 5 — chi è stato scartato e perché */}
          {(dati.passo5_scartati || []).length > 0 && (
            <>
              <TouchableOpacity onPress={() => setApri(apri === "scarti" ? null : "scarti")} style={s.apri}>
                <Ionicons name={apri === "scarti" ? "chevron-down" : "chevron-forward"} size={14} color={colors.textMuted} />
                <Text style={s.apriTxt}>SCARTATI DALL’IMBUTO ({dati.passo5_scartati?.length})</Text>
              </TouchableOpacity>
              {apri === "scarti" && (
                <View style={s.riquadro}>
                  {(dati.passo5_scartati || []).map((x) => (
                    <Text key={x.pattern} style={s.scarto}>
                      {x.pattern} — {x.motivo}
                    </Text>
                  ))}
                </View>
              )}
            </>
          )}
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  blocco: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: 14, padding: 14, marginBottom: 14,
  },
  testa: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  titolo: { color: colors.primary, fontSize: 11, fontWeight: "900", letterSpacing: 1.2 },
  nota: { color: colors.textDim, fontSize: 11, lineHeight: 16, marginTop: 8 },
  riga: { color: colors.textMuted, fontSize: 11, lineHeight: 17, marginTop: 3 },
  forte: { color: colors.text, fontWeight: "900" },
  tasto: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    marginTop: 10, paddingVertical: 12, borderRadius: 10,
    borderWidth: 1, borderColor: colors.primary, backgroundColor: "rgba(255,87,34,0.10)",
  },
  tastoTxt: { color: colors.primary, fontSize: 13, fontWeight: "800" },

  sezione: { color: colors.textDim, fontSize: 10, fontWeight: "900", letterSpacing: 1.2, marginTop: 14, marginBottom: 6 },
  fascia: { marginBottom: 8 },
  fasciaTit: { color: colors.textMuted, fontSize: 11, fontWeight: "800", marginBottom: 2 },
  vocePat: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 2 },
  pct: { width: 54, textAlign: "right", color: colors.text, fontSize: 12, fontWeight: "800", fontVariant: ["tabular-nums"] },
  intestazione: { color: colors.textDim, fontSize: 9, fontWeight: "900", letterSpacing: 0.5 },
  nomePat: { flex: 1, minWidth: 130, color: colors.text, fontSize: 12 },
  quota: { color: colors.textDim, fontSize: 11, fontVariant: ["tabular-nums"] },

  apri: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, paddingVertical: 6 },
  apriTxt: { color: colors.textMuted, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  riquadro: { backgroundColor: colors.bg, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border },
  sotto: { color: colors.textMuted, fontSize: 11, fontWeight: "800" },
  punteggi: { color: colors.textDim, fontSize: 11, lineHeight: 17, marginTop: 3 },
  scarto: { color: colors.textDim, fontSize: 11, lineHeight: 16 },
});
