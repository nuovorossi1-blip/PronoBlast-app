import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated from "react-native-reanimated";
import { colors } from "@/src/theme";
import { api } from "@/src/api";
import { useBottomNav } from "@/src/components/BottomNavContext";
import { selectedListCache } from "@/src/utils/cache";
import { requestSelectedList } from "@/src/utils/matchPreload";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

// Tabs normali (hub pages)
const TABS: { route: string; label: string; icon: IconName; testID: string }[] = [
  { route: "/profilo", label: "Profilo", icon: "person-circle-outline", testID: "tab-profile" },
  { route: "/strumenti", label: "Strumenti", icon: "construct-outline", testID: "tab-tools" },
  { route: "/", label: "Partite", icon: "trophy-outline", testID: "tab-home" },
  { route: "/selected", label: "Schedina", icon: "ticket-outline", testID: "tab-schedina" },
  { route: "/book", label: "Book", icon: "book-outline", testID: "tab-book" },
];

// Tabs contestuali quando l'utente è dentro una partita (sostituiscono i tab normali)
// Le 3 azioni AI / Risultato / Quote diventano la nav principale del flusso match.
const MATCH_PATTERN = /^\/(match|risultato|quote)\//;
function getContextualTabs(matchId: string, currentPath: string): { route: string; label: string; icon: IconName; testID: string }[] {
  // Quando l'utente è GIÀ sulla pagina /match e clicca "PRONOSTICO AI",
  // aggiungiamo un query param per forzare la generazione (gen=timestamp).
  // La pagina match ascolta il param e fa partire runPrediction() automaticamente.
  const isOnMatch = currentPath.startsWith("/match/");
  const aiRoute = isOnMatch
    ? `/match/${matchId}?gen=${Date.now()}`
    : `/match/${matchId}`;
  return [
    { route: aiRoute, label: "Pronostico AI", icon: "sparkles", testID: "tab-ai" },
    { route: `/risultato/${matchId}`, label: "Risultato", icon: "checkmark-done-circle-outline", testID: "tab-risultato" },
    { route: `/quote/${matchId}`, label: "Quote", icon: "pricetags-outline", testID: "tab-quote" },
  ];
}

/**
 * Misure della barra in basso, esportate perche' chi si appoggia SOPRA di lei
 * (la barra ESCI/PREC/AVANTI del dettaglio partita) non debba indovinarle.
 * Prima erano ricopiate a mano in match/[id].tsx con numeri leggermente
 * diversi, e si vedeva: fra le due barre restava una striscia di sfondo.
 */
const NAV_CONTENT_HEIGHT = 46; // icona 22 + gap + etichetta 10

export function useNavMetrics() {
  const insets = useSafeAreaInsets();
  let isAndroidUA = false;
  try {
    if (typeof navigator !== "undefined" && navigator.userAgent) {
      isAndroidUA = /android/i.test(navigator.userAgent);
    }
  } catch {}
  // Prima era Math.max(insets.bottom, 24) + 12: sotto le etichette restava una
  // fascia nera vuota grande quanto le etichette stesse. insets.bottom gia'
  // tiene conto della barra di sistema, quindi il minimo forzato serve solo
  // come rete di sicurezza e puo' essere piccolo.
  const bottomPadding = Math.max(insets.bottom, isAndroidUA ? 8 : 0) + 6;
  return { bottomPadding, height: bottomPadding + 6 + NAV_CONTENT_HEIGHT };
}

export default function BottomNav() {
  const router = useRouter();
  const path = usePathname();
  const { show } = useBottomNav();
  const [selCount, setSelCount] = useState(0);

  // Ogni cambio rotta → forza la BottomNav visibile + aggiorna selCount via cache
  useEffect(() => {
    show();
    const cached = selectedListCache.get();
    if (cached) setSelCount(cached.length);
    if (selectedListCache.isStale()) {
      let active = true;
      requestSelectedList().then(list => {
        if (active) setSelCount(list.length);
      }).catch(() => {});
      return () => { active = false; };
    }
  }, [path, show]);

  // ============================================================
  // Scelta TABS in base alla route corrente
  // SSR-safe: gestisce path null, query params, edge cases
  // ============================================================
  let matchId: string | null = null;
  try {
    if (path) {
      const matchCtx = path.match(MATCH_PATTERN);
      if (matchCtx) {
        // Estrai id ignorando eventuali query params (?foo=bar) o trailing slash
        const parts = path.split("/").filter(Boolean);
        if (parts.length >= 2) {
          matchId = (parts[1] || "").split("?")[0].split("#")[0] || null;
          if (!matchId) matchId = null;
        }
      }
    }
  } catch {}
  const TABS_RENDER = matchId ? getContextualTabs(matchId, path || "") : TABS;

  const { bottomPadding } = useNavMetrics();

  // ============================================================
  // 10/09/2026 — AUTO-HIDE DISATTIVATO (richiesta esplicita di Rossi).
  // ============================================================
  // Questa barra si nascondeva scorrendo verso il basso, insieme all'header.
  // Ma qui ci sono i tasti di navigazione dell'app (Profilo, Strumenti,
  // Partite, Schedina, Book): devono restare raggiungibili MENTRE si scorre,
  // altrimenti per cambiare schermata bisogna prima risalire.
  //
  // La SharedValue `visible` resta in piedi e continua a comandare header e
  // striscia dei giorni nella home: e' li' che il comportamento ha senso,
  // perche' guadagna spazio di lettura senza togliere comandi.
  // Per riattivarlo qui basta rimettere `animStyle` nello style qui sotto.
  return (
    <Animated.View style={[styles.wrap, { paddingBottom: bottomPadding }]}>
      {TABS_RENDER.map((t) => {
        const active = (t.route === "/" && path === "/") || (t.route !== "/" && path?.startsWith(t.route));
        const isSchedina = t.route === "/selected";
        return (
          <TouchableOpacity
            key={t.route}
            testID={t.testID}
            onPress={() => router.replace(t.route as any)}
            style={styles.tab}
            activeOpacity={0.6}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
          >
            <View>
              <Ionicons name={t.icon} size={22} color={active ? colors.primary : colors.textMuted} />
              {isSchedina && selCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeTxt}>{selCount > 99 ? "99+" : selCount}</Text>
                </View>
              )}
            </View>
            <Text style={[styles.label, { color: active ? colors.primary : colors.textMuted }]}>
              {t.label}{isSchedina && selCount > 0 ? ` (${selCount})` : ""}
            </Text>
          </TouchableOpacity>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    backgroundColor: "rgba(10,10,10,0.96)",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 6,
    paddingHorizontal: 4,
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3 },
  label: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" },
  badge: {
    position: "absolute", top: -4, right: -8,
    minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: 8,
    backgroundColor: colors.primary, alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: colors.bg,
  },
  badgeTxt: { color: "#FFF", fontSize: 9, fontWeight: "900" },
});
