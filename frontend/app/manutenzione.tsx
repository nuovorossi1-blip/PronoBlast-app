import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as XLSX from "xlsx";
import * as DocumentPicker from "expo-document-picker";
import BottomNav from "@/src/components/BottomNav";
import { colors } from "@/src/theme";
import { api, PendingMatch, Lavoro } from "@/src/api";
import { useLavoro, LavoroBox, riepilogoLavoro } from "@/src/components/LavoroBox";
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

  const caricaConteggio = useCallback(async () => {
    try {
      const r = await api.pendingMatches(true);
      setConteggio(r);
    } catch (e: any) {
      notify("Errore", e?.message);
    }
  }, []);

  useEffect(() => { caricaConteggio(); }, [caricaConteggio]);

  // I lavori lunghi girano sul server (01/10/2026): il tasto li avvia e basta,
  // continuano anche a schermo spento o in un'altra app (vedi /lavori).
  const finito = useCallback((l: Lavoro) => {
    if (l.tipo === "sync_risultati" || l.tipo === "import_risultati") {
      matchesCache.invalidate();
      daysCache.invalidate();
      caricaConteggio();
    }
    if (l.tipo === "sync_risultati") setDaVerificare(l.parziale?.da_controllare || []);
    const titolo = l.stato === "completato" ? "Lavoro completato" : l.stato === "annullato" ? "Lavoro fermato" : "Lavoro non riuscito";
    notify(titolo, `${riepilogoLavoro(l)}${l.stato === "errore" && l.errore ? `\n\n${l.errore}` : ""}`);
  }, [caricaConteggio]);
  const srv = useLavoro(finito);

  // Entrando in pagina: se l'ultimo lavoro era un aggiornamento risultati, le
  // righe da controllare restano visibili.
  useEffect(() => {
    if (srv.lavoro?.tipo === "sync_risultati" && srv.lavoro.stato === "completato") {
      setDaVerificare(srv.lavoro.parziale?.da_controllare || []);
    }
  }, [srv.lavoro?.id, srv.lavoro?.stato]); // eslint-disable-line react-hooks/exhaustive-deps

  const avvia = async (tipo: Parameters<typeof srv.avvia>[0], parametri: Record<string, any> = {}) => {
    try {
      await srv.avvia(tipo, parametri);
    } catch (e: any) {
      notify("Errore", `${e?.message || e}`);
    }
  };

  // --- 0. RICOSTRUZIONE DELL'APPRENDIMENTO ------------------------------
  const ricostruisci = () => confirmAction({
    title: "Ricostruire l'apprendimento?",
    message: "Svuota le tabelle e le riempie di nuovo rigiocando tutte le partite concluse. Serve dopo un azzeramento, che cancella e basta senza ricostruire niente. Il lavoro continua sul server anche a schermo spento.",
    confirmText: "Ricostruisci",
    onConfirm: () => avvia("ricostruzione"),
  });

  // --- 0bis. RICALCOLO STORICO CON LE REGOLE DI OGGI (01/10/2026) --------
  // Rigioca tutte le partite concluse IN ORDINE DI DATA: ogni partita usa solo
  // lo storico precedente. Scrive solo `ricalcolo`: il verdetto congelato non
  // si tocca. Ripartire da capo e' sempre sicuro (sovrascrive solo il ricalcolo).
  const ricalcolaTutto = () => confirmAction({
    title: "Ricalcolare tutto con le regole di oggi?",
    message: "Rigioca tutte le partite concluse in ordine di data, ognuna solo con lo storico che c'era prima. Il verdetto congelato NON viene toccato: il ricalcolo va in una riga a parte. Il pronostico AI resta fuori. Il lavoro continua sul server anche a schermo spento o in un'altra app.",
    confirmText: "Ricalcola",
    onConfirm: () => avvia("ricalcolo"),
  });

  // --- 1. RECUPERO AUTOMATICO -------------------------------------------
  // Il server fa tutto in una volta: una richiesta per giornata alle fonti,
  // abbinamento in locale. Gira come lavoro, cosi' il riepilogo non si perde.
  const recuperaAuto = () => avvia("sync_risultati", { days: giorniIndietro });

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

      // Le righe partono tutte in una volta; poi le applica il server a
      // blocchi, anche se il telefono si addormenta.
      if (compilateMale) notify("Attenzione", `${compilateMale} righe hanno gol_casa/gol_ospite non numerici e sono state ignorate.`);
      await srv.avvia("import_risultati", { items, overwrite: sovrascrivi });
    } catch (e: any) {
      notify("Errore", e?.message);
    } finally {
      setLavoro(null);
      setAvanzamento("");
    }
  };

  // Un lavoro alla volta: finche' il server ne ha uno in corso, i tasti aspettano.
  const occupato = lavoro !== null || srv.inCorso;
  const attivoSrv = (t: string) => srv.inCorso && srv.lavoro?.tipo === t;

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
          attivo={attivoSrv("ricostruzione")}
          disabilitato={occupato}
          onPress={ricostruisci}
        />

        <Passo
          numero="R"
          titolo="Ricalcola tutto con le regole di oggi"
          testo="Rigioca tutte le partite concluse in ordine di data, ognuna solo con lo storico che c'era prima. Il verdetto congelato resta com'è: il ricalcolo compare come seconda riga, verde se indovinato e rosso se sbagliato. Curva e pagella in Traccia."
          icona="git-compare-outline"
          attivo={attivoSrv("ricalcolo")}
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
          attivo={attivoSrv("sync_risultati")}
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
          attivo={lavoro === "import" || attivoSrv("import_risultati")}
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

        {lavoro !== null ? (
          <View style={styles.lavoroBox}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.lavoroTxt}>{avanzamento || "In corso…"}</Text>
          </View>
        ) : null}

        <LavoroBox lavoro={srv.lavoro} onFerma={srv.ferma} />

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
