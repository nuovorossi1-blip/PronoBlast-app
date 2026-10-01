import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { colors } from "@/src/theme";
import { api, Lavoro, TipoLavoro, NOMI_LAVORO, SommaBacktest } from "@/src/api";
import { confirmAction } from "@/src/utils/platform";

/**
 * LAVORI IN BACKGROUND (01/10/2026) — lato app.
 *
 * Il lavoro gira sul server (`/lavori`): l'app lo avvia e poi GUARDA soltanto.
 * Qui c'e' il gancio che legge lo stato (e da' una spinta se il server lo
 * segnala fermo) e il riquadro che mostra avanzamento, esito e il tasto Ferma.
 * Spegnere lo schermo, cambiare app o pagina non ferma niente: il lavoro lo
 * porta avanti l'orologio in Supabase.
 *
 * LEGGERE POCO (01/10/2026, app "lentissima" dopo la PR #8). La prima versione
 * leggeva ogni 3 secondi SEMPRE: anche senza lavori in corso e anche dalle
 * pagine rimaste sotto (Strumenti apre Manutenzione e Traccia con push, quindi
 * resta montata), e ogni lettura ridisegnava l'intera pagina con un oggetto
 * nuovo identico al vecchio. Ora:
 *  - si legge solo con la pagina IN PRIMO PIANO (useFocusEffect);
 *  - entrando basta una lettura; ogni 3 s solo finche' un lavoro e' in corso;
 *  - lo stato si aggiorna solo se la risposta e' davvero cambiata.
 */
export function useLavoro(onFinito?: (l: Lavoro) => void) {
  const [lavoro, setLavoro] = useState<Lavoro | null>(null);
  const [inVista, setInVista] = useState(false);
  /** "id:stato" dell'ultima lettura: serve a vedere il passaggio in_corso -> finito. */
  const prec = useRef<string | null>(null);
  /** Ultima risposta come testo: se e' uguale, niente ridisegno. */
  const ultimo = useRef<string>("");
  const cb = useRef(onFinito);
  cb.current = onFinito;

  const aggiorna = useCallback((l: Lavoro | null) => {
    const testo = JSON.stringify(l);
    if (testo === ultimo.current) return;
    ultimo.current = testo;
    setLavoro(l);
  }, []);

  const leggi = useCallback(async () => {
    try {
      const { lavoro: l } = await api.lavoroStato();
      aggiorna(l);
      if (l?.fermo) api.lavoroSpinta();
      if (l && prec.current === `${l.id}:in_corso` && l.stato !== "in_corso") cb.current?.(l);
      prec.current = l ? `${l.id}:${l.stato}` : null;
    } catch {
      // rete assente: si riprova al giro dopo
    }
  }, [aggiorna]);

  // Una lettura ogni volta che la pagina torna in primo piano.
  useFocusEffect(useCallback(() => {
    setInVista(true);
    leggi();
    return () => setInVista(false);
  }, [leggi]));

  // Lettura periodica solo con la pagina in vista E un lavoro in corso.
  const inCorso = lavoro?.stato === "in_corso";
  useEffect(() => {
    if (!inVista || !inCorso) return;
    const t = setInterval(leggi, 3000);
    return () => clearInterval(t);
  }, [inVista, inCorso, leggi]);

  const avvia = useCallback(async (tipo: TipoLavoro, parametri: Record<string, any> = {}) => {
    const r = await api.lavoroAvvia(tipo, parametri);
    aggiorna(r.lavoro);
    prec.current = `${r.lavoro.id}:in_corso`;
    api.lavoroSpinta();
  }, [aggiorna]);

  const ferma = useCallback(async () => {
    await api.lavoroAnnulla();
    await leggi();
  }, [leggi]);

  return { lavoro, inCorso: lavoro?.stato === "in_corso", avvia, ferma };
}

const n = (x: number | undefined) => (x || 0).toLocaleString("it-IT");

/** Il riepilogo di fine lavoro, lo stesso che prima dava il popup. */
export function riepilogoLavoro(l: Lavoro): string {
  const p = l.parziale || {};
  switch (l.tipo) {
    case "ricalcolo":
      return `Partite ricalcolate: ${n(p.scritte)} su ${n(l.totale)}${p.saltate ? ` (${n(p.saltate)} saltate: risultato o quote illeggibili)` : ""}. Curva e pagella sono in Traccia.`;
    case "ricostruzione":
      return `Partite rigiocate: ${n(l.pos)} su ${n(l.totale)}. Punteggi per scenario e pagella dei sistemi: ${n(p.scenari)}. Punteggi per famiglia di mercato: ${n(p.famiglie)}.`;
    case "pagella": {
      const s = p as SommaBacktest;
      const g = (s.vinte || 0) + (s.perse || 0);
      return `${n(s.vinte)} vinte su ${n(g)} giocate${g ? ` (${Math.round((s.vinte / g) * 1000) / 10}%)` : ""} · ${n(s.esaminate)} partite esaminate.`;
    }
    case "import_risultati":
      return [
        `Righe: ${n(l.totale)}`, `Applicati: ${n(p.applicate)}`,
        p.sovrascritte ? `Sovrascritti: ${n(p.sovrascritte)}` : "",
        p.gia_presenti ? `Già presenti: ${n(p.gia_presenti)}` : "",
        p.saltate_perche_diverse ? `Saltati perché diversi: ${n(p.saltate_perche_diverse)}` : "",
        p.illeggibili ? `Illeggibili: ${n(p.illeggibili)}` : "",
        p.non_trovate ? `Partita non trovata: ${n(p.non_trovate)}` : "",
      ].filter(Boolean).join(" · ");
    case "ai_schedina": {
      const esiti: { partita: string; esito: string }[] = p.esiti || [];
      const conta = (f: (x: string) => boolean) => esiti.filter((e) => f(e.esito)).length;
      const righe = esiti.map((e) => `• ${e.partita}: ${e.esito}`).join("\n");
      return `Generati ${conta((x) => x === "pronostico AI generato")} · gia' presenti ${conta((x) => x.includes("gia' presente"))} · saltate ${conta((x) => x.includes("iniziata") || x.includes("non trovata"))} · errori ${conta((x) => x.startsWith("errore"))}${righe ? `\n${righe}` : ""}`;
    }
    case "sync_risultati":
      return [
        `Partite esaminate: ${n(p.partite_esaminate)}`, `Risultati scritti: ${n(p.scritte)}`,
        p.da_verificare ? `Da controllare: ${n(p.da_verificare)}` : "",
        p.ambigue ? `Ambigue: ${n(p.ambigue)}` : "",
        p.non_finite ? `Non ancora finite: ${n(p.non_finite)}` : "",
        p.non_trovate ? `Non trovate: ${n(p.non_trovate)}` : "",
      ].filter(Boolean).join(" · ");
  }
}

const ora = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })} ${d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`;
};

export function LavoroBox({ lavoro, onFerma }: { lavoro: Lavoro | null; onFerma: () => void }) {
  if (!lavoro) return null;
  const nome = NOMI_LAVORO[lavoro.tipo] || lavoro.tipo;

  if (lavoro.stato === "in_corso") {
    const avanz = lavoro.totale
      ? `${n(lavoro.pos)} di ${n(lavoro.totale)}${lavoro.tipo === "sync_risultati" ? "" : " partite"}`
      : "Avvio…";
    return (
      <View style={[st.box, st.boxOn]}>
        <View style={st.riga}>
          <ActivityIndicator color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={st.nome}>{nome}</Text>
            <Text style={st.testo}>{avanz}</Text>
          </View>
          <TouchableOpacity
            onPress={() => confirmAction({
              title: "Fermare?",
              message: "Quello che è già stato salvato resta.",
              confirmText: "Ferma",
              destructive: true,
              onConfirm: onFerma,
            })}
            style={st.stop}
          >
            <Text style={st.stopTxt}>FERMA</Text>
          </TouchableOpacity>
        </View>
        {lavoro.errore ? <Text style={st.avviso}>Intoppo, riprovo da solo: {lavoro.errore}</Text> : null}
        <Text style={st.nota}>Puoi spegnere lo schermo o cambiare app: il lavoro continua sul server.</Text>
      </View>
    );
  }

  const ok = lavoro.stato === "completato";
  const titolo = ok ? "completato" : lavoro.stato === "annullato" ? "fermato" : "non riuscito";
  return (
    <View style={st.box}>
      <View style={st.riga}>
        <Ionicons
          name={ok ? "checkmark-circle" : lavoro.stato === "annullato" ? "pause-circle" : "alert-circle"}
          size={22}
          color={ok ? colors.success : lavoro.stato === "annullato" ? colors.textDim : colors.danger}
        />
        <View style={{ flex: 1 }}>
          <Text style={st.nome}>Ultimo lavoro: {nome} — {titolo}</Text>
          <Text style={st.nota}>{ora(lavoro.finito_il || lavoro.aggiornato)}</Text>
        </View>
      </View>
      <Text style={st.testo}>{riepilogoLavoro(lavoro)}</Text>
      {!ok && lavoro.errore ? <Text style={st.avviso}>{lavoro.errore}</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  box: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: 12, padding: 14, gap: 6,
  },
  boxOn: { backgroundColor: "rgba(255,87,34,0.10)", borderColor: colors.primary },
  riga: { flexDirection: "row", alignItems: "center", gap: 12 },
  nome: { color: colors.text, fontSize: 14, fontWeight: "800" },
  testo: { color: colors.text, fontSize: 13, lineHeight: 18 },
  nota: { color: colors.textDim, fontSize: 11, lineHeight: 16 },
  avviso: { color: colors.warning, fontSize: 11, lineHeight: 16 },
  stop: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.danger },
  stopTxt: { color: "#FFF", fontSize: 12, fontWeight: "900" },
});
