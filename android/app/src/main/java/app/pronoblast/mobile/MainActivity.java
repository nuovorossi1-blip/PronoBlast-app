package app.pronoblast.mobile;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin nativo per scaricare e installare un APK nuovo (stesso di GymBuilder).
        // Registrato PRIMA di super.onCreate, altrimenti il bridge non lo vede.
        registerPlugin(ApkUpdaterPlugin.class);
        super.onCreate(savedInstanceState);

        // TASTO INDIETRO (19/10/2026, Rossi: "con i tre pulsanti si chiude l'app, e lo swipe con la
        // navigazione a gesti non funziona"). Senza il plugin App di Capacitor il tasto indietro (e lo
        // swipe dal bordo, che per Android e' lo stesso comando) chiudeva sempre l'app. Ora va alla pagina
        // precedente finche' c'e'; sulla prima pagina il sito mostra "Premi di nuovo indietro per uscire"
        // (useBackGuard.ts) e solo il secondo indietro chiude.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView != null && webView.canGoBack()) {
                    webView.goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                    setEnabled(true);
                }
            }
        });
    }
}
