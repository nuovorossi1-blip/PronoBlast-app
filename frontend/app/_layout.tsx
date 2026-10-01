import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as NavigationBar from "expo-navigation-bar";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { BottomNavProvider } from "@/src/components/BottomNavContext";
import { ToastProvider } from "@/src/components/Toast";
import NativeUpdater from "@/src/components/NativeUpdater";
import { useSwipeBack } from "@/src/hooks/useSwipeBack";
// FabBack rimosso il 10/09/2026: la freccia circolare flottante duplicava
// il tasto indietro che ogni schermata ha gia' in alto a sinistra, e da quando
// c'e' la barra ESCI/PREC/AVANTI nel dettaglio partita ci finiva pure sopra.
// Il componente resta in src/components/ se dovesse servire di nuovo.

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useIconFonts();
  // Trascinamento da sinistra a destra = indietro (01/10/2026).
  useSwipeBack();

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    (async () => {
      try {
        // ============================================================
        // ANDROID NAVIGATION BAR: SEMPRE VISIBILE con spazio dedicato
        // ============================================================
        // I tasti di sistema (back/home/recents) devono SEMPRE essere
        // visibili e MAI sovrapposti alla BottomNav app.
        // - setBehaviorAsync("inset-swipe") → comportamento standard
        //   (la app NON disegna sotto la nav bar, il SO le dà spazio dedicato)
        // - setVisibilityAsync("visible") → MAI nascosti (no swipe-up per mostrare)
        // - setBackgroundColorAsync → match con tema scuro app
        await NavigationBar.setBehaviorAsync("inset-swipe");
        await NavigationBar.setVisibilityAsync("visible");
        await NavigationBar.setBackgroundColorAsync("#0A0A0A");
        await NavigationBar.setButtonStyleAsync("light");
      } catch (e) {}
    })();
  }, []);

  if (!loaded && !error) return null;

  return (
    <SafeAreaProvider>
      <BottomNavProvider>
        <ToastProvider>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#0A0A0A" }, animation: "slide_from_right", animationDuration: 160 }} />
          {/* Avviso aggiornamento APK: attivo solo dentro il guscio Android (18/09/2026) */}
          <NativeUpdater />
        </ToastProvider>
      </BottomNavProvider>
    </SafeAreaProvider>
  );
}
