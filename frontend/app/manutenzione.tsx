import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as XLSX from "xlsx";
import * as DocumentPicker from "expo-document-picker";
import BottomNav from "@/src/components/BottomNav";
import { colors } from "@/src/theme";
import { api, PendingMatch } from "@/src/api";
import { notify, confirmAction } from "@/src/utils/platform";
import { matchesCache, daysCache } from "@/src/utils/cache";

/**
 * MANUTENZIONE DEL DATABASE — schermata temporanea (27/09/2026).
 *
 * PERCHE' ESISTE. Nel database c'erano 11.997 partite ma solo 432 concluse:
 * tutte le altre avevano le quote e nessun esito, quindi non insegnavano niente
 * al motore. Con 432 partite lo storico per quote simili e' inutilizzabile — tre
 * quarti delle partite non ne trovano nemmeno una simile con le tolleranze che
 * usa Rossi (1X2 +-0,10, Over/GG +-0,15).
 *
 * TRE PASSI, in quest'ordine:
 *  1. recupero automatico da FotMob — fa il grosso senza lavoro manuale;
 *  2. esportazione in Excel di quello che resta;
 *  3. ricaricamento del foglio compilato.
 *
 * Quando il database sara' completo questa schermata puo' sparire: basta
 * togliere il tasto da Strumenti e questo file. Il passo 1 pero' resta utile
 * ogni volta che si accumulano partite non aggiornate.
 */

/** Quante righe per richiesta al caricamento. Applicare un risultato aggiorna
 *  pagella, punteggi per scenario e contatori: 300 e' il compromesso fra numero
 *  di richieste e limite di tempo. */
const BLOCCO_IMPORT = 300;

const COLONNE = [
  "id", "data", "ora", "campionato", "casa", "ospite",
  "gol_casa", "gol_ospite", "risultato",
  "1", "X", "2", "1X", "X2", "12",
  "U1.5", "O1.5", "U2.5", "O2.5", "U3.5", "O3.5", "GG", "NG",
];

export default function Manutenzione() {
  const [conteggio, setConteggio] = useState<{ da_completare: number; prima_data?: string | null; ultima_data?: string | null } | null>(null);
  const [lavoro, setLavoro] = useState<string | null>(null);
  const [avanzamento, setAvanzamento] = useState("");
  const [sovrascrivi, setSovrascrivi] = useState(false);
  /** Quanti giorni indietro guardare. 3 di partenza: la finestra scorre da sola
   *  ogni giorno, quindi con un uso quotidiano non resta mai scoperta. */
  const [giorniIndietro, setGiorniIndietro] = useState(3);
  const [daVerificare, setDaVerificare] = useState<any[]>([]);
  /** Messo a true dal tasto Ferma: il ciclo lo controlla a ogni blocco. */
  const stop = useRef(false);

  const caricaConteggio = useCallback(async () => {
    try {
      const r = await api.pendingMatches(true);
      setConteggio(r);
    } catch (e: any) {
      notify("Errore", e?.message);
    }
  }, []);

  useEffect(() => { caricaConteggio(); }, [caricaConteggio]);

  // --- 0. RICOSTRUZIONE DELL'APPRENDIMENTO ------------------------------
  const ricostruisci = () => confirmAction({
    title: "Ricostruire l'apprendimento?",
    message: "Svuota le tabelle e le riempie di nuovo rigiocando tutte le partite concluse. Serve dopo un azzeramento, che cancella e basta senza ricostruire niente.",
    confirmText: "Ricostruisci",
    onConfirm: async () => {
      stop.current = false;
      setLavoro("rebuild");
      setAvanzamento("Svuoto e riparto…");
      try {
        let da = 0, primo = true, tot = 0, scen = 0, fam = 0;
        for (;;) {
          if (stop.current) break;
          const r = await api.rebuildLearning(da, primo);
          primo = false;
          tot = r.totale_concluse;
          scen += r.scenari_aggiornati;
          fam += r.famiglie_aggiornate;
          setAvanzamento(`${da + r.elaborate} di ${tot} partite rigiocate`);
          if (r.finito || r.prossimo === null) break;
          da = r.prossimo;
        }
        notify(
          stop.current ? "Ricostruzione fermata" : "Apprendimento ricostruito",
          `Partite rigiocate: ${tot}.\nPunteggi per scenario e pagella dei sistemi: ${scen}.\nPunteggi per famiglia di mercato: ${fam} (solo le partite che avevano un pronostico AI salvato).`,
        );
      } catch (e: any) {
        notify("Errore", e?.message);
      } finally {
        setLavoro(null);
        setAvanzamento("");
      }
    },
  });

  // --- 0bis. RICALCOLO STORICO CON LE REGOLE DI OGGI (01/10/2026) --------
  // Rigioca tutte le partite concluse IN ORDINE DI DATA: ogni partita usa solo
  // lo storico precedente. Scrive solo `ricalcolo`: il verdetto congelato non
  // si tocca. Ripartire da capo e' sempre sicuro (sovrascrive solo il ricalcolo).
  const ricalcolaTutto = () => confirmAction({
    title: "Ricalcolare tutto con le regole di oggi?",
    message: "Rigioca tutte le partite concluse in ordine di data, ognuna solo con lo storico che c'era prima. Il verdetto congelato NON viene toccato: il ricalcolo va in una riga a parte. Il pronostico AI resta fuori. Ci vogliono alcuni minuti.",
    confirmText: "Ricalcola",
    onConfirm: async () => {
      stop.current = false;
      setLavoro("ricalcolo");
      setAvanzamento("Riparto dalla partita più vecchia…");
      try {
        let da = 0, primo = true, tot = 0, scritte = 0, saltate = 0;
        for (;;) {
          if (stop.current) break;
          const r = await api.ricalcolo(da, primo);
          primo = false;
          tot = r.totale_concluse;
          scritte += r.scritte;
          saltate += r.saltate;
          setAvanzamento(`${(da + r.elaborate).toLocaleString("it-IT")} di ${tot.toLocaleString("it-IT")} partite ricalcolate`);
          if (r.finito || r.prossimo === null) break;
          da = r.prossimo;
        }
        notify(
          stop.current ? "Ricalcolo fermato" : "Ricalcolo completato",
          stop.current
            ? `Ricalcolate ${scritte} partite. Per completare va rilanciato da capo (in ordine di data non si riprende a metà).`
            : `Partite ricalcolate: ${scritte} su ${tot}${saltate ? ` (${saltate} saltate: risultato o quote illeggibili)` : ""}.\nCurva e pagella sono in Traccia.`,
        );
      } catch (e: any) {
        notify("Errore", `${e?.message || e}\n\nSe dice che manca la colonna 'ricalcolo', va creata su Supabase.`);
      } finally {
        setLavoro(null);
        setAvanzamento("");
      }
    },
  });

  // --- 1. RECUPERO AUTOMATICO -------------------------------------------
  const recuperaAuto = async () => {
    stop.current = false;
    setLavoro("auto");
    setAvanzamento("Interrogo le fonti…");
    try {
      // Il server fa tutto in una volta: una richiesta per giornata alle fonti,
      // abbinamento in locale. Prima si mandava una ricerca per PARTITA.
      const r = await api.syncResults(giorniIndietro);
      matchesCache.invalidate();
      daysCache.invalidate();
      await caricaConteggio();
      setDaVerificare(r.da_controllare || []);
      const righe = [
        `Partite esaminate: ${r.partite_esaminate}`,
        `Risultati scritti: ${r.scritte}`,
        r.da_verificare ? `Da controllare (nomi poco simili): ${r.da_verificare}` : "",
        r.ambigue ? `Ambigue, non scritte: ${r.ambigue}` : "",
        r.supplementari ? `Ai supplementari, non scritte: ${r.supplementari}` : "",
        r.non_finite ? `Non ancora finite: ${r.non_finite}` : "",
        r.non_trovate ? `Non trovate: ${r.non_trovate}` : "",
        Object.keys(r.per_fonte || {}).length ? `Fonti: ${Object.entries(r.per_fonte).map(([k, v]) => `${k} ${v}`).join(", ")}` : "",
        (r.fonti_non_raggiungibili || []).length ? "Alcune fonti non hanno risposto (normale: ESPN e SofaScore bloccano i server)." : "",
      ].filter(Boolean);
      notify("Aggiornamento completato", righe.join("\n"));
    } catch (e: any) {
      notify("Errore", e?.message);
    } finally {
      setLavoro(null);
      setAvanzamento("");
    }
  };

  // --- 2. ESPORTAZIONE ---------------------------------------------------
  const esporta = async () => {
    setLavoro("export");
    setAvanzamento("Scarico le partite…");
    try {
      const r = await api.pendingMatches();
      const righe = (r.matches || []) as PendingMatch[];
      if (!righe.length) { notify("Niente da esportare", "Tutte le partite passate hanno gia' un risultato."); return; }

      setAvanzamento(`Preparo il foglio con ${righe.length} partite…`);
      const dati = righe.map((m) => ({
        id: m.id,
        data: m.day,
        ora: m.time || "",
        campionato: m.manifestazione,
        casa: m.squadra1,
        ospite: m.squadra2,
        gol_casa: "",
        gol_ospite: "",
        risultato: "",
        "1": m.odd_1, X: m.odd_x, "2": m.odd_2,
        "1X": m.odd_1x, X2: m.odd_x2, "12": m.odd_12,
        "U1.5": m.odd_u15, "O1.5": m.odd_o15,
        "U2.5": m.odd_u25, "O2.5": m.odd_o25,
        "U3.5": m.odd_u35, "O3.5": m.odd_o35,
        GG: m.odd_gg, NG: m.odd_ng,
      }));

      const ws = XLSX.utils.json_to_sheet(dati, { header: COLONNE });
      ws["!cols"] = [
        { wch: 38 }, { wch: 11 }, { wch: 6 }, { wch: 10 }, { wch: 22 }, { wch: 22 },
        { wch: 9 }, { wch: 10 }, { wch: 10 },
        ...COLONNE.slice(9).map(() => ({ wch: 7 })),
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Da completare");
      XLSX.writeFile(wb, `pronoblast-da-completare-${new Date().toISOString().slice(0, 10)}.xlsx`);

      notify(
        "Foglio creato ✓",
        `${righe.length} partite. Compila SOLO gol_casa e gol_ospite (due numeri interi). Non toccare la colonna id: è quella che fa ritrovare la partita.`,
      );
    } catch (e: any) {
      notify("Errore", e?.message);
    } finally {
      setLavoro(null);
      setAvanzamento("");
    }
  };

  // --- 3. CARICAMENTO ----------------------------------------------------
  const carica = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel", "*/*"],
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets?.length) return;

    stop.current = false;
    setLavoro("import");
    setAvanzamento("Leggo il foglio…");
    try {
      const file = res.assets[0];
      const buf = await (await fetch(file.uri)).arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const righe: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

      // gol_casa/gol_ospite hanno la precedenza: sono due numeri interi, che
      // Excel non puo' reinterpretare. La colonna `risultato` resta come
      // alternativa libera per chi preferisce scrivere "2-1".
      const items: { id: string; result: string }[] = [];
      let compilateMale = 0;
      for (const r of righe) {
        const id = String(r.id || "").trim();
        if (!id) continue;
        const c = String(r.gol_casa ?? "").trim();
        const o = String(r.gol_ospite ?? "").trim();
        if (c !== "" && o !== "") {
          if (/^\d+$/.test(c) && /^\d+$/.test(o)) items.push({ id, result: `${c}-${o}` });
          else compilateMale++;
          continue;
        }
        const libero = String(r.risultato ?? "").trim();
        if (libero) items.push({ id, result: libero });
      }

      if (!items.length) {
        notify("Nessun risultato nel foglio", compilateMale
          ? `${compilateMale} righe hanno gol_casa/gol_ospite non numerici. Devono essere due numeri interi.`
          : "Compila gol_casa e gol_ospite di almeno una riga.");
        return;
      }

      const tot = { applicate: 0, sovrascritte: 0, gia_presenti: 0, saltate: 0, illeggibili: 0, non_trovate: 0 };
      for (let i = 0; i < items.length; i += BLOCCO_IMPORT) {
        if (stop.current) break;
        const blocco = items.slice(i, i + BLOCCO_IMPORT);
        const out = await api.resultsImport(blocco, sovrascrivi);
        tot.applicate += out.applicate;
        tot.sovrascritte += out.sovrascritte;
        tot.gia_presenti += out.gia_presenti;
        tot.saltate += out.saltate_perche_diverse;
        tot.illeggibili += out.illeggibili;
        tot.non_trovate += out.non_trovate;
        setAvanzamento(`${Math.min(i + BLOCCO_IMPORT, items.length)} di ${items.length} — applicate ${tot.applicate}`);
      }

      matchesCache.invalidate();
      daysCache.invalidate();
      await caricaConteggio();

      const righeMsg = [
        `Risultati nel foglio: ${items.length}`,
        `Applicati: ${tot.applicate}`,
        tot.sovrascritte ? `Sovrascritti: ${tot.sovrascritte}` : "",
        tot.gia_presenti ? `Già presenti (identici): ${tot.gia_presenti}` : "",
        tot.saltate ? `Saltati perché diversi da quelli salvati: ${tot.saltate}` : "",
        tot.illeggibili ? `Illeggibili: ${tot.illeggibili}` : "",
        tot.non_trovate ? `Partita non trovata: ${tot.non_trovate}` : "",
        compilateMale ? `Righe con gol non numerici: ${compilateMale}` : "",
      ].filter(Boolean);
      notify(stop.current ? "Caricamento fermato" : "Caricamento completato", righeMsg.join("\n"));
    } catch (e: any) {
      notify("Errore", e?.message);
    } finally {
      setLavoro(null);
      setAvanzamento("");
    }
  };

  const occupato = lavoro !== null;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace("/strumenti")} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Manutenzione database</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.box}>
          <Text style={styles.boxTitle}>PARTITE DA COMPLETARE</Text>
          {conteggio ? (
            <>
              <Text style={styles.numero}>{conteggio.da_completare}</Text>
              <Text style={styles.hint}>
                {conteggio.da_completare
                  ? `Partite già giocate ma senza risultato, dal ${conteggio.prima_data} al ${conteggio.ultima_data}. Finché non hanno un esito non insegnano niente al motore.`
                  : "Tutte le partite passate hanno un risultato. Non c'è niente da fare qui."}
              </Text>
            </>
          ) : (
            <ActivityIndicator color={colors.primary} />
          )}
        </View>

        <Passo
          numero="0"
          titolo="Ricostruisci l'apprendimento"
          testo="Da usare dopo un azzeramento: quel tasto cancella e basta, non ricostruisce niente. Qui il motore rigioca tutte le partite concluse e rifà i conteggi."
          icona="refresh-outline"
          attivo={lavoro === "rebuild"}
          disabilitato={occupato}
          onPress={ricostruisci}
        />

        <Passo
          numero="R"
          titolo="Ricalcola tutto con le regole di oggi"
          testo="Rigioca tutte le partite concluse in ordine di data, ognuna solo con lo storico che c'era prima. Il verdetto congelato resta com'è: il ricalcolo compare come seconda riga, verde se indovinato e rosso se sbagliato. Curva e pagella in Traccia."
          icona="git-compare-outline"
          attivo={lavoro === "ricalcolo"}
          disabilitato={occupato}
          onPress={ricalcolaTutto}
        />

        <View style={styles.box}>
          <Text style={styles.boxTitle}>GIORNI DA GUARDARE</Text>
          <View style={styles.giorniRow}>
            {[1, 3, 7, 15, 30].map((g) => (
              <TouchableOpacity
                key={g}
                onPress={() => setGiorniIndietro(g)}
                disabled={occupato}
                style={[styles.giornoChip, giorniIndietro === g && styles.giornoChipOn]}
              >
                <Text style={[styles.giornoTxt, giorniIndietro === g && styles.giornoTxtOn]}>{g}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.hint}>
            Il piano gratuito di API-Football copre solo gli ultimi due giorni: oltre resta FotMob, che trova molto meno.
            Con un uso quotidiano 3 bastano; se salti qualche giorno, alza il numero.
          </Text>
        </View>

        <Passo
          numero="1"
          titolo="Aggiorna risultati"
          testo="Una richiesta per giornata a API-Football e FotMob, abbinamento in locale. Scrive solo quando è sicuro: ambigue, incerte e partite ai supplementari restano vuote."
          icona="cloud-download-outline"
          attivo={lavoro === "auto"}
          disabilitato={occupato || !conteggio?.da_completare}
          onPress={recuperaAuto}
        />

        <Passo
          numero="2"
          titolo="Esporta in Excel quelle che restano"
          testo="Un foglio con data, campionato, squadre e tutte le quote. Compila solo gol_casa e gol_ospite, due numeri interi. Non toccare la colonna id."
          icona="download-outline"
          attivo={lavoro === "export"}
          disabilitato={occupato || !conteggio?.da_completare}
          onPress={esporta}
        />

        <Passo
          numero="3"
          titolo="Carica il foglio compilato"
          testo="Le righe vuote vengono ignorate, quindi puoi caricare lo stesso file più volte, un pezzo per volta."
          icona="cloud-upload-outline"
          attivo={lavoro === "import"}
          disabilitato={occupato}
          onPress={carica}
        />

        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchTxt}>Sovrascrivi i risultati già salvati</Text>
            <Text style={styles.hint}>
              Spento, una partita che ha già un risultato diverso viene saltata e segnalata: un errore di compilazione non cancella dati buoni.
            </Text>
          </View>
          <Switch value={sovrascrivi} onValueChange={setSovrascrivi} disabled={occupato} />
        </View>

        {occupato ? (
          <View style={styles.lavoroBox}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.lavoroTxt}>{avanzamento || "In corso…"}</Text>
            <TouchableOpacity
              onPress={() => confirmAction({
                title: "Fermare?",
                message: "Quello che è già stato salvato resta. Puoi riprendere quando vuoi.",
                confirmText: "Ferma",
                destructive: true,
                onConfirm: () => { stop.current = true; },
              })}
              style={styles.stopBtn}
            >
              <Text style={styles.stopTxt}>FERMA</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {daVerificare.length ? (
          <View style={styles.box}>
            <Text style={styles.boxTitle}>DA CONTROLLARE</Text>
            <Text style={styles.hint}>
              Righe scritte con nomi poco simili, o non scritte perché ambigue. Controllale nel dettaglio partita.
            </Text>
            {daVerificare.slice(0, 20).map((v, i) => (
              <Text key={i} style={styles.verifica}>
                {v.giorno} · {v.partita} — {v.motivo}
                {v.risultato ? ` → ${v.risultato} (${v.fonte}, somiglianza ${v.somiglianza})` : ""}
              </Text>
            ))}
          </View>
        ) : null}

        <Text style={styles.nota}>
          Ricaricare due volte lo stesso risultato è innocuo: il motore riconosce un esito identico e non lo conta una seconda volta.
        </Text>
      </ScrollView>

      <BottomNav />
    </SafeAreaView>
  );
}

function Passo({ numero, titolo, testo, icona, attivo, disabilitato, onPress }: {
  numero: string; titolo: string; testo: string; icona: any;
  attivo: boolean; disabilitato: boolean; onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabilitato}
      style={[styles.passo, disabilitato && !attivo && { opacity: 0.45 }, attivo && styles.passoOn]}
    >
      <View style={styles.passoNum}><Text style={styles.passoNumTxt}>{numero}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.passoTitolo}>{titolo}</Text>
        <Text style={styles.hint}>{testo}</Text>
      </View>
      {attivo ? <ActivityIndicator color={colors.primary} /> : <Ionicons name={icona} size={22} color={colors.primary} />}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  iconBtn: { padding: 6 },
  title: { color: colors.text, fontSize: 17, fontWeight: "900" },
  body: { padding: 16, paddingBottom: 24, gap: 14 },

  box: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: 12, padding: 14, gap: 6,
  },
  boxTitle: { color: colors.textDim, fontSize: 11, fontWeight: "900", letterSpacing: 1.5 },
  numero: { color: colors.primary, fontSize: 34, fontWeight: "900" },

  passo: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: 12, padding: 14,
  },
  passoOn: { borderColor: colors.primary },
  passoNum: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: colors.bg,
    alignItems: "center", justifyContent: "center",
  },
  passoNumTxt: { color: colors.primary, fontSize: 13, fontWeight: "900" },
  passoTitolo: { color: colors.text, fontSize: 15, fontWeight: "800", marginBottom: 3 },

  hint: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
  switchRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: 12, padding: 14,
  },
  switchTxt: { color: colors.text, fontSize: 14, fontWeight: "700", marginBottom: 3 },

  lavoroBox: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "rgba(255,87,34,0.10)", borderWidth: 1, borderColor: colors.primary,
    borderRadius: 12, padding: 14,
  },
  lavoroTxt: { flex: 1, color: colors.text, fontSize: 13, fontWeight: "700" },
  stopBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.danger },
  stopTxt: { color: "#FFF", fontSize: 12, fontWeight: "900" },

  giorniRow: { flexDirection: "row", gap: 8, marginTop: 4, marginBottom: 6 },
  giornoChip: {
    minWidth: 44, paddingVertical: 8, borderRadius: 10, alignItems: "center",
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  giornoChipOn: { borderColor: colors.primary, backgroundColor: "rgba(255,87,34,0.15)" },
  giornoTxt: { color: colors.textMuted, fontSize: 14, fontWeight: "800" },
  giornoTxtOn: { color: colors.primary },
  verifica: { color: colors.warning, fontSize: 11, lineHeight: 16, marginTop: 4 },

  nota: { color: colors.textDim, fontSize: 11, lineHeight: 16, fontStyle: "italic" },
});
