import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import BottomNav from "@/src/components/BottomNav";
import { colors } from "@/src/theme";
import { api, BacktestResponse, ManualeStatsResponse } from "@/src/api";
import { notify } from "@/src/utils/platform";

/**
 * TRACCIA DEI PRONOSTICI (28/09/2026).
 *
 * Rigioca il motore su tutte le partite gia' concluse e riporta, famiglia per
 * famiglia, quali pronostici avrebbe scelto, quanti ne ha azzeccati, quanti
 * sbagliati e quali occasioni si e' perso — cioe' quali mercati della whitelist
 * avrebbero vinto senza essere scelti.
 *
 * NON INFLUENZA NIENTE. Nessuna scrittura, nessun effetto sul motore: e' una
 * fotografia, non una modifica. Serve a rispondere a domande che finora non
 * avevano risposta, tipo "su questa famiglia quanto ci prende davvero?".
 *
 * Confronta anche i LAMBDA nuovi (ricerca sulla griglia, 28/09) con la vecchia
 * formula lineare, sulle stesse identiche partite. E' la misura che mancava
 * quando i lambda sono stati sostituiti.
 */

type Somma = {
  esaminate: number; con_pick: number; senza_pick: number; vinte: number; perse: number;
  per_famiglia: Record<string, { partite: number; vinte: number; perse: number; senzaPick: number }>;
  pick_per_famiglia: Record<string, Record<string, { scelte: number; vinte: number; perse: number }>>;
  occasioni_perse: Record<string, Record<string, number>>;
};

const vuota = (): Somma => ({
  esaminate: 0, con_pick: 0, senza_pick: 0, vinte: 0, perse: 0,
  per_famiglia: {}, pick_per_famiglia: {}, occasioni_perse: {},
});

/** Somma un blocco nel totale: il server ne restituisce uno per volta. */
function accumula(t: Somma, r: BacktestResponse): Somma {
  t.esaminate += r.esaminate; t.con_pick += r.con_pick;
  t.senza_pick += r.senza_pick; t.vinte += r.vinte; t.perse += r.perse;
  for (const [fam, v] of Object.entries(r.per_famiglia || {})) {
    const f = t.per_famiglia[fam] || { partite: 0, vinte: 0, perse: 0, senzaPick: 0 };
    f.partite += v.partite; f.vinte += v.vinte; f.perse += v.perse; f.senzaPick += v.senzaPick;
    t.per_famiglia[fam] = f;
  }
  for (const [fam, mercati] of Object.entries(r.pick_per_famiglia || {})) {
    t.pick_per_famiglia[fam] = t.pick_per_famiglia[fam] || {};
    for (const [m, c] of Object.entries(mercati)) {
      const x = t.pick_per_famiglia[fam][m] || { scelte: 0, vinte: 0, perse: 0 };
      x.scelte += c.scelte; x.vinte += c.vinte; x.perse += c.perse;
      t.pick_per_famiglia[fam][m] = x;
    }
  }
  for (const [fam, mercati] of Object.entries(r.occasioni_perse || {})) {
    t.occasioni_perse[fam] = t.occasioni_perse[fam] || {};
    for (const [m, n] of Object.entries(mercati)) {
      t.occasioni_perse[fam][m] = (t.occasioni_perse[fam][m] || 0) + n;
    }
  }
  return t;
}

const SOGLIE = [1.35, 1.40, 1.50, 1.60];

/** Le regole a confronto. La fusione completa non c'e': ha bisogno del
 *  pronostico AI, che esiste su ~600 partite su 8.251, quindi darebbe numeri
 *  su un campione diverso dagli altri e inconfrontabile. */
const REGOLE: { id: "motore" | "maxprob" | "pre"; nome: string; spiega: string }[] = [
  { id: "motore", nome: "Motore", spiega: "primo mercato ammesso del ranking, con la regola della direzione" },
  { id: "maxprob", nome: "Max probabilità", spiega: "la probabilità più alta fra i mercati ammessi, senza regola di direzione" },
  { id: "pre", nome: "Pre-pronostico", spiega: "il primo della voce PRE" },
];

/**
 * DIVISIONE TEMPORALE. Le tabelle di apprendimento sono state costruite DA
 * queste stesse partite: senza dividere, una regola che le usa risponde a
 * domande di cui ha gia' visto le risposte, e i numeri escono belli senza
 * reggere sul futuro. Misurando solo dopo questa data il confronto e' onesto.
 */
const SPLIT = "2026-08-31";

export default function Traccia() {
  const [minOdd, setMinOdd] = useState(1.4);
  const [nuovi, setNuovi] = useState<Somma | null>(null);
  const [vecchi, setVecchi] = useState<Somma | null>(null);
  const [lavoro, setLavoro] = useState<string | null>(null);
  const [avanzamento, setAvanzamento] = useState("");
  const [apri, setApri] = useState<string | null>(null);
  const stop = useRef(false);

  const [regola, setRegola] = useState<"motore" | "maxprob" | "pre">("motore");
  const [soloDopoSplit, setSoloDopoSplit] = useState(true);

  // Ticket 8: misura del manuale per scenario (sola lettura, calcolata viva).
  const [manuale, setManuale] = useState<ManualeStatsResponse | null>(null);
  useEffect(() => {
    let alive = true;
    api.manualeStats()
      .then((r) => { if (alive) setManuale(r); })
      .catch((e) => { console.error("[manuale-stats]", e); });
    return () => { alive = false; };
  }, []);

  const gira = async (lambdaVecchi: boolean) => {
    stop.current = false;
    setLavoro(lambdaVecchi ? "vecchi" : "nuovi");
    const tot = vuota();
    try {
      let da = 0;
      for (;;) {
        if (stop.current) break;
        const r = await api.backtest(da, minOdd, lambdaVecchi, regola, soloDopoSplit ? SPLIT : "");
        accumula(tot, r);
        setAvanzamento(`${da + r.elaborate} di ${r.totale_concluse} partite`);
        if (lambdaVecchi) setVecchi({ ...tot }); else setNuovi({ ...tot });
        if (r.finito || r.prossimo === null) break;
        da = r.prossimo;
      }
    } catch (e: any) {
      notify("Errore", e?.message);
    } finally {
      setLavoro(null);
      setAvanzamento("");
    }
  };

  const pct = (v: number, t: number) => (t ? `${Math.round((v / t) * 1000) / 10}%` : "—");
  const occupato = lavoro !== null;

  const riepilogo = (s: Somma | null, titolo: string) => {
    if (!s) return null;
    const giocate = s.vinte + s.perse;
    return (
      <View style={st.box}>
        <Text style={st.boxTit}>{titolo}</Text>
        <Text style={st.grande}>{pct(s.vinte, giocate)}</Text>
        <Text style={st.hint}>
          {s.vinte} vinte su {giocate} giocate · {s.esaminate} partite esaminate ·
          {" "}{s.senza_pick} senza pronostico sopra soglia
        </Text>
      </View>
    );
  };

  const famiglie = Object.keys(nuovi?.per_famiglia || {}).sort(
    (a, b) => (nuovi!.per_famiglia[b].partite) - (nuovi!.per_famiglia[a].partite),
  );

  return (
    <SafeAreaView style={st.safe} edges={["top"]}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => router.replace("/strumenti")} style={st.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={st.title}>Traccia dei pronostici</Text>
      </View>

      <ScrollView contentContainerStyle={st.body}>
        <Text style={st.hint}>
          Rigioca il motore su tutte le partite concluse e riporta cosa avrebbe scelto e come sarebbe
          andata. Non tocca niente: è una fotografia, non una modifica.
        </Text>

        <View style={st.box}>
          <Text style={st.boxTit}>QUOTA MINIMA</Text>
          <View style={st.chips}>
            {SOGLIE.map((v) => (
              <TouchableOpacity
                key={v}
                onPress={() => { setMinOdd(v); setNuovi(null); setVecchi(null); }}
                disabled={occupato}
                style={[st.chip, minOdd === v && st.chipOn]}
              >
                <Text style={[st.chipTxt, minOdd === v && st.chipTxtOn]}>{v.toFixed(2)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={st.box}>
          <Text style={st.boxTit}>REGOLA DA PROVARE</Text>
          <View style={st.chips}>
            {REGOLE.map((r) => (
              <TouchableOpacity
                key={r.id}
                onPress={() => { setRegola(r.id); setNuovi(null); setVecchi(null); }}
                disabled={occupato}
                style={[st.chip, regola === r.id && st.chipOn]}
              >
                <Text style={[st.chipTxt, regola === r.id && st.chipTxtOn]}>{r.nome}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={st.hint}>{REGOLE.find((r) => r.id === regola)?.spiega}</Text>
        </View>

        <View style={st.box}>
          <Text style={st.boxTit}>MANUALE PER SCENARIO — QUANTO HA RISPOSTO FINORA</Text>
          <Text style={st.hint}>
            I mercati da manuale del banner in cima alla scheda, valutati su tutte le partite concluse con
            quello scenario. Solo misura: non tocca il verdetto. Rimborsi (DNB) e mezze (AH -0,75) fuori dal %.
          </Text>
          {!manuale ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />
          ) : (
            Object.entries(manuale.scenari || {})
              .sort(([, a], [, b]) => b.partite - a.partite)
              .map(([chiave, sc]) => (
                <View key={chiave}>
                  <Text style={st.sotto}>
                    {sc.scenario.toUpperCase()}{sc.favorita ? ` (favorita ${sc.favorita})` : ""} · {sc.partite} partite
                  </Text>
                  {Object.entries(sc.mercati).map(([m, c]) => {
                    const n = c.vinte + c.perse;
                    const extra = [c.rimborsi ? `${c.rimborsi} rimborsi` : "", c.mezze ? `${c.mezze} mezze` : ""].filter(Boolean).join(", ");
                    return (
                      <View key={m} style={st.riga}>
                        <Text style={[st.rigaPct, { color: colors.primary }]}>{c.pct === null ? "—" : `${c.pct.toFixed(1)}%`}</Text>
                        <Text style={st.rigaNome}>{m}</Text>
                        <Text style={st.rigaN}>{c.vinte}/{n}{extra ? ` · ${extra}` : ""}</Text>
                      </View>
                    );
                  })}
                </View>
              ))
          )}
        </View>

        {/* PAGELLA DEI SISTEMI (01/10/2026): l'AI al comando migliora la %?
            Pick registrati PRIMA della partita, valutati col risultato. */}
        {manuale?.pagella && (
          <View style={st.box}>
            <Text style={st.boxTit}>PAGELLA DEI SISTEMI — % DI PRONOSTICI INDOVINATI</Text>
            <Text style={st.hint}>
              Pick salvati prima della partita. "Stesse partite" confronta i quattro solo dove tutti avevano un pick:
              è il confronto alla pari.
            </Text>
            <Text style={st.sotto}>Tutte le partite con un pick</Text>
            {Object.entries(manuale.pagella.sistemi).map(([k, t]) => (
              <View key={k} style={st.riga}>
                <Text style={[st.rigaPct, { color: colors.primary }]}>{t.pct === null ? "—" : `${t.pct.toFixed(1)}%`}</Text>
                <Text style={st.rigaNome}>{k}</Text>
                <Text style={st.rigaN}>{t.vinte}/{t.vinte + t.perse}</Text>
              </View>
            ))}
            <Text style={st.sotto}>Stesse partite · {manuale.pagella.stesse_partite.partite}</Text>
            {Object.entries(manuale.pagella.stesse_partite.sistemi).map(([k, t]) => (
              <View key={k} style={st.riga}>
                <Text style={[st.rigaPct, { color: colors.primary }]}>{t.pct === null ? "—" : `${t.pct.toFixed(1)}%`}</Text>
                <Text style={st.rigaNome}>{k}</Text>
                <Text style={st.rigaN}>{t.vinte}/{t.vinte + t.perse}</Text>
              </View>
            ))}
          </View>
        )}

        {/* GAP TECNICO PER PROFILO: la regola direzionale (favorita netta +
            DIFENSIVA -> direzione + pochi gol) regge oltre Belgio-Galles? */}
        {manuale?.confronto_profilo && Object.keys(manuale.confronto_profilo).length > 0 && (
          <View style={st.box}>
            <Text style={st.boxTit}>GAP TECNICO PER PROFILO — DIREZIONE O GOL?</Text>
            <Text style={st.hint}>
              Partite con favorita netta, divise per profilo. Se in DIFENSIVA "favorita + U4.5" non tiene il passo di O2.5,
              la regola direzionale va rivista.
            </Text>
            {Object.entries(manuale.confronto_profilo).sort(([a], [b]) => a.localeCompare(b)).map(([k, g]) => (
              <View key={k}>
                <Text style={st.sotto}>{k} · {g.partite} partite</Text>
                {Object.entries(g.mercati).map(([m, t]) => (
                  <View key={m} style={st.riga}>
                    <Text style={[st.rigaPct, { color: colors.primary }]}>{t.pct === null ? "—" : `${t.pct.toFixed(1)}%`}</Text>
                    <Text style={st.rigaNome}>{m}</Text>
                    <Text style={st.rigaN}>{t.vinte}/{t.vinte + t.perse}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        )}

        <TouchableOpacity
          onPress={() => { setSoloDopoSplit(!soloDopoSplit); setNuovi(null); setVecchi(null); }}
          disabled={occupato}
          style={st.box}
        >
          <Text style={st.boxTit}>
            {soloDopoSplit ? `SOLO PARTITE DOPO IL ${SPLIT}` : "TUTTO L'ARCHIVIO"}
          </Text>
          <Text style={st.hint}>
            {soloDopoSplit
              ? "Misura onesta: le tabelle di apprendimento sono state costruite dalle partite precedenti, quindi misurare anche su quelle gonfierebbe i numeri. Tocca per cambiare."
              : "Attenzione: include le partite con cui il sistema ha imparato. I numeri usciranno più belli di quanto siano. Tocca per tornare alla misura onesta."}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => gira(false)} disabled={occupato} style={[st.tasto, occupato && { opacity: 0.5 }]}>
          {lavoro === "nuovi" ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="play" size={16} color={colors.primary} />}
          <Text style={st.tastoTxt}>Rigioca con i λ attuali</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => gira(true)} disabled={occupato} style={[st.tasto, occupato && { opacity: 0.5 }]}>
          {lavoro === "vecchi" ? <ActivityIndicator color={colors.textMuted} /> : <Ionicons name="time-outline" size={16} color={colors.textMuted} />}
          <Text style={[st.tastoTxt, { color: colors.textMuted }]}>Rigioca con i λ vecchi (confronto)</Text>
        </TouchableOpacity>

        {occupato && (
          <View style={st.lavoro}>
            <ActivityIndicator color={colors.primary} />
            <Text style={st.lavoroTxt}>{avanzamento || "In corso…"}</Text>
            <TouchableOpacity onPress={() => { stop.current = true; }} style={st.stop}>
              <Text style={st.stopTxt}>FERMA</Text>
            </TouchableOpacity>
          </View>
        )}

        {riepilogo(nuovi, "CON I λ ATTUALI")}
        {riepilogo(vecchi, "CON I λ VECCHI")}

        {nuovi && vecchi && (
          <Text style={st.confronto}>
            Differenza: {(((nuovi.vinte / Math.max(1, nuovi.vinte + nuovi.perse)) -
              (vecchi.vinte / Math.max(1, vecchi.vinte + vecchi.perse))) * 100).toFixed(1)} punti
            a favore dei λ {nuovi.vinte / Math.max(1, nuovi.vinte + nuovi.perse) >=
              vecchi.vinte / Math.max(1, vecchi.vinte + vecchi.perse) ? "attuali" : "vecchi"}.
          </Text>
        )}

        {famiglie.map((fam) => {
          const f = nuovi!.per_famiglia[fam];
          const giocate = f.vinte + f.perse;
          const mercati = Object.entries(nuovi!.pick_per_famiglia[fam] || {})
            .sort((a, b) => b[1].scelte - a[1].scelte);
          const perse = Object.entries(nuovi!.occasioni_perse[fam] || {})
            .sort((a, b) => b[1] - a[1]).slice(0, 6);
          return (
            <View key={fam} style={st.box}>
              <TouchableOpacity onPress={() => setApri(apri === fam ? null : fam)} style={st.famTesta}>
                <Text style={st.famNome}>{fam.replace(/_/g, " ")}</Text>
                <Text style={st.famPct}>{pct(f.vinte, giocate)}</Text>
                <Ionicons name={apri === fam ? "chevron-down" : "chevron-forward"} size={14} color={colors.textDim} />
              </TouchableOpacity>
              <Text style={st.hint}>
                {f.partite} partite · {giocate} giocate ({f.vinte} vinte, {f.perse} perse) ·
                {" "}{f.senzaPick} senza pronostico
              </Text>
              {apri === fam && (
                <>
                  <Text style={st.sotto}>PRONOSTICI SCELTI</Text>
                  {mercati.map(([m, c]) => (
                    <View key={m} style={st.riga}>
                      <Text style={[st.rigaPct, { color: c.vinte / Math.max(1, c.scelte) >= 0.6 ? colors.success : colors.textMuted }]}>
                        {pct(c.vinte, c.vinte + c.perse)}
                      </Text>
                      <Text style={st.rigaNome}>{m}</Text>
                      <Text style={st.rigaN}>{c.vinte}/{c.scelte}</Text>
                    </View>
                  ))}
                  <Text style={st.sotto}>OCCASIONI PERSE</Text>
                  <Text style={st.hint}>
                    Mercati che avrebbero vinto senza essere scelti. Un numero alto non è per forza un
                    errore: molti mercati vincono insieme, e giocarne uno solo è il punto.
                  </Text>
                  {perse.map(([m, n]) => (
                    <View key={m} style={st.riga}>
                      <Text style={[st.rigaPct, { color: colors.warning }]}>{n}</Text>
                      <Text style={st.rigaNome}>{m}</Text>
                    </View>
                  ))}
                </>
              )}
            </View>
          );
        })}
      </ScrollView>

      <BottomNav />
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  iconBtn: { padding: 6 },
  title: { color: colors.text, fontSize: 17, fontWeight: "900" },
  body: { padding: 16, paddingBottom: 24, gap: 12 },

  box: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: 12, padding: 14, gap: 4,
  },
  boxTit: { color: colors.textDim, fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  grande: { color: colors.primary, fontSize: 30, fontWeight: "900" },
  hint: { color: colors.textDim, fontSize: 11, lineHeight: 16 },

  chips: { flexDirection: "row", gap: 8, marginTop: 6 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  chipOn: { borderColor: colors.primary, backgroundColor: "rgba(255,87,34,0.15)" },
  chipTxt: { color: colors.textMuted, fontSize: 13, fontWeight: "800" },
  chipTxtOn: { color: colors.primary },

  tasto: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tastoTxt: { color: colors.primary, fontSize: 13, fontWeight: "800" },

  lavoro: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "rgba(255,87,34,0.10)", borderWidth: 1, borderColor: colors.primary,
    borderRadius: 12, padding: 12,
  },
  lavoroTxt: { flex: 1, color: colors.text, fontSize: 12, fontWeight: "700" },
  stop: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.danger },
  stopTxt: { color: "#FFF", fontSize: 11, fontWeight: "900" },

  confronto: { color: colors.text, fontSize: 12, fontWeight: "800", lineHeight: 17 },

  famTesta: { flexDirection: "row", alignItems: "center", gap: 8 },
  famNome: { flex: 1, color: colors.text, fontSize: 13, fontWeight: "800" },
  famPct: { color: colors.primary, fontSize: 14, fontWeight: "900" },
  sotto: { color: colors.textDim, fontSize: 10, fontWeight: "900", letterSpacing: 1, marginTop: 10 },
  riga: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 2 },
  rigaPct: { width: 52, textAlign: "right", fontSize: 12, fontWeight: "800", fontVariant: ["tabular-nums"] },
  rigaNome: { flex: 1, color: colors.text, fontSize: 12 },
  rigaN: { color: colors.textDim, fontSize: 11, fontVariant: ["tabular-nums"] },
});
