/**
 * Elenco modelli disponibili (porting di LLM_OPTIONS in server.py, con Groq
 * aggiunto). DeepSeek e Groq sono entrambi compatibili con l'API OpenAI,
 * quindi condividono lo stesso "adapter" generico — cambia solo base URL,
 * chiave e nome modello.
 */

export type LlmOption = {
  id: string;
  label: string;
  provider: "deepseek" | "groq" | "openrouter" | "gemini" | "anthropic" | "openai";
  model: string;
  cost_per_pred: number;
  speed: string;
  quality: string;
  desc: string;
  /** Solo OpenRouter: chiedere il fornitore piu' economico del momento (llmScelta.ts). */
  economico?: boolean;
};

export const LLM_OPTIONS: LlmOption[] = [
  { id: "deepseek-chat", label: "DeepSeek V4 Lite", provider: "deepseek", model: "deepseek-v4-flash",
    cost_per_pred: 0.0014, speed: "Veloce", quality: "Buono", desc: "Economicissimo (~€1,56/mese per 40 pred/giorno)" },
  { id: "deepseek-reasoner", label: "DeepSeek V4 Pro", provider: "deepseek", model: "deepseek-v4-pro",
    cost_per_pred: 0.0027, speed: "Lento", quality: "Ottimo", desc: "Ragionamento profondo, costo ridotto (~€3/mese)" },
  { id: "groq-gpt-oss-120b", label: "GPT-OSS 120B (Groq)", provider: "groq", model: "openai/gpt-oss-120b",
    cost_per_pred: 0, speed: "Veloce", quality: "Ottimo", desc: "Gratuito — miglior qualità disponibile su Groq, nessun costo" },
  { id: "groq-gpt-oss-20b", label: "GPT-OSS 20B (Groq)", provider: "groq", model: "openai/gpt-oss-20b",
    cost_per_pred: 0, speed: "Velocissimo", quality: "Buono", desc: "Gratuito — più leggero e ancora più veloce, nessun costo" },
  // OpenRouter: un solo endpoint per moltissimi modelli, sempre in formato
  // OpenAI, quindi usa lo stesso adapter generico di DeepSeek e Groq.
  { id: "openrouter-nemotron-ultra", label: "Nemotron 3 Ultra (OpenRouter)", provider: "openrouter",
    model: "nvidia/nemotron-3-ultra-550b-a55b:free",
    cost_per_pred: 0, speed: "Molto lento", quality: "Ottimo",
    desc: "Gratuito — ragionamento profondo ma lentissimo: puo' andare in timeout. Max 50 richieste/giorno (1.000 con credito)" },
  { id: "openrouter-nemotron-super", label: "Nemotron 3 Super (OpenRouter)", provider: "openrouter",
    model: "nvidia/nemotron-3-super-120b-a12b:free",
    cost_per_pred: 0, speed: "Medio", quality: "Buono",
    desc: "Gratuito — fratello piu' piccolo e piu' veloce di Ultra: da provare se Ultra va in timeout" },
  { id: "gemini-flash", label: "Gemini 2.5 Flash", provider: "gemini", model: "gemini-2.5-flash",
    cost_per_pred: 0.002, speed: "Veloce", quality: "Buono", desc: "Veloce e bilanciato" },
  { id: "gemini-pro", label: "Gemini 2.5 Pro", provider: "gemini", model: "gemini-2.5-pro",
    cost_per_pred: 0.025, speed: "Medio", quality: "Ottimo", desc: "Ragionamento più profondo" },
  { id: "claude-haiku", label: "Claude Haiku 4.5", provider: "anthropic", model: "claude-haiku-4-5-20251001",
    cost_per_pred: 0.005, speed: "Veloce", quality: "Buono", desc: "Bilanciato economia/qualità" },
  { id: "claude-sonnet", label: "Claude Sonnet 4.5", provider: "anthropic", model: "claude-sonnet-4-5-20250929",
    cost_per_pred: 0.016, speed: "Medio", quality: "Eccellente", desc: "Top ragionamento, più costoso" },
  { id: "gpt-4o-mini", label: "GPT-4o Mini", provider: "openai", model: "gpt-4o-mini",
    cost_per_pred: 0.003, speed: "Veloce", quality: "Buono", desc: "Veloce e ben bilanciato" },
  { id: "gpt-4o", label: "GPT-4o", provider: "openai", model: "gpt-4o",
    cost_per_pred: 0.020, speed: "Medio", quality: "Ottimo", desc: "Eccellente per analisi complesse" },
];

export const DEFAULT_LLM = "deepseek-chat";

/** Provider gia' collegati con una chiave funzionante (aggiornato man mano che l'utente le fornisce). */
export const CONFIGURED_PROVIDERS = new Set(["deepseek", "groq", "openrouter"]);

const PROVIDER_BASE_URL: Record<string, string> = {
  deepseek: "https://api.deepseek.com",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

const PROVIDER_ENV_KEY: Record<string, string> = {
  deepseek: "DEEPSEEK_API_KEY",
  groq: "GROQ_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

declare const Netlify: { env: { get(key: string): string | undefined } } | undefined;

function readEnv(key: string): string | undefined {
  try {
    // Le variabili segnate come "secret" su Netlify non sono esposte su
    // process.env per motivi di sicurezza: vanno lette con Netlify.env.get().
    // @ts-ignore — Netlify e' un global iniettato a runtime dalla piattaforma
    if (typeof Netlify !== "undefined" && Netlify?.env?.get) {
      // @ts-ignore
      const v = Netlify.env.get(key);
      if (v) return v;
    }
  } catch {
    /* Netlify global non disponibile in questo contesto, uso il fallback */
  }
  return process.env[key];
}

/**
 * Vero se il provider ha un adapter E la sua chiave e' davvero su Netlify.
 * Serve a llm-settings per dire al frontend quali modelli sono utilizzabili
 * ADESSO: prima bastava essere nell'elenco, e un modello senza chiave
 * risultava "configurato" fino al momento in cui lo si usava e falliva.
 */
export function isProviderUsable(provider: string): boolean {
  if (!CONFIGURED_PROVIDERS.has(provider)) return false;
  const envKey = PROVIDER_ENV_KEY[provider];
  return !!(envKey && readEnv(envKey));
}

export async function callLlm(
  option: LlmOption,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  if (!CONFIGURED_PROVIDERS.has(option.provider)) {
    throw new Error(
      `Provider "${option.provider}" non ancora configurato (manca la API key). Scegli DeepSeek o Groq, oppure fornisci la chiave per abilitare "${option.label}".`
    );
  }

  const baseUrl = PROVIDER_BASE_URL[option.provider];
  const apiKey = readEnv(PROVIDER_ENV_KEY[option.provider]);
  if (!apiKey) {
    throw new Error(`Variabile d'ambiente ${PROVIDER_ENV_KEY[option.provider]} non configurata su Netlify`);
  }

  const isReasoningModel =
    option.id === "deepseek-reasoner" || option.model.includes("r1") ||
    option.model.includes("gpt-oss") || option.model.includes("nemotron");
  // Su OpenRouter il tetto resta piu' basso: i modelli :free sono lenti e con
  // 8000 token di uscita la funzione Netlify va in timeout prima della fine.
  // Meglio una risposta corta che arriva di una lunga che non arriva mai.
  // 01/10/2026: 2000 non bastavano piu' (consiglio motivato, 4 fasce,
  // alternative, statistiche): Israele-Kosovo arrivava troncato a meta' JSON.
  const maxTokens = isReasoningModel ? 8000 : 4500;

  // DeepSeek V4 (sia Flash che Pro) attiva di default la "thinking mode" —
  // diversamente dal vecchio V3.2 (deepseek-chat), che non ragionava affatto.
  // Per l'opzione "Lite/Veloce" (deepseek-chat, non reasoner) vogliamo lo
  // stesso comportamento di prima: risposta diretta senza catena di
  // ragionamento, altrimenti con soli 2000 token la risposta viene troncata
  // a metà ragionamento e non arriva mai al JSON finale (il fallback su
  // reasoning_content qui sotto resterebbe con testo incompleto).
  const disableThinking = option.provider === "deepseek" && option.id !== "deepseek-reasoner";

  // Le Netlify Function vengono uccise dalla piattaforma intorno ai 26
  // secondi, senza spiegazioni. Tagliando noi a 22 l'errore che arriva a
  // schermo dice cosa e' successo davvero, invece di un 502 muto.
  const controller = new AbortController();
  // Quanto tempo abbiamo davvero dipende dalla piattaforma che ci ospita:
  // Netlify uccide le function intorno ai 26 secondi, Vercel ce ne concede 60
  // (impostati in vercel.json). La variabile VERCEL la mette Vercel da sola.
  // Durante la migrazione l'app gira su entrambe, quindi il valore va scelto a
  // tempo di esecuzione e non scritto fisso.
  const onVercel = !!readEnv("VERCEL");

  // Il budget si calcola UNA VOLTA, partendo dal tetto della piattaforma, e
  // non si scrive a mano. L'11/09 avevamo 60s di tetto e 55s di taglio: cinque
  // secondi di margine per le ~10 chiamate a Supabase che stanno prima e dopo
  // questa funzione. Risultato: la piattaforma uccideva la function prima che
  // il nostro messaggio potesse uscire, e Rossi vedeva un 504 muto.
  //
  // La riserva serve proprio a quello: il tempo che NON e' della chiamata al
  // modello. Se un giorno cambia maxDuration in vercel.json, va cambiato anche
  // platformCapMs qui — sono due numeri che devono restare in accordo.
  //
  // SERVER NOSTRO (06/10/2026): sul PC di casa, e domani sulla VPS, nessuno
  // uccide la richiesta. Prima qui si cadeva nel caso Netlify (21 s) e i
  // modelli gratuiti di OpenRouter, che ci mettono minuti, venivano sempre
  // interrotti. Il server (server-locale/server.ts) mette
  // LIMITE_PIATTAFORMA_SECONDI; si puo' anche scrivere nel .env.
  const limiteProprio = Number(readEnv("LIMITE_PIATTAFORMA_SECONDI")) || 0;
  const platformCapMs = limiteProprio > 0 ? limiteProprio * 1000
    : onVercel ? 300_000 : 26_000; // vercel.json / limite Netlify
  const reserveMs = limiteProprio > 0 ? 30_000 : onVercel ? 45_000 : 5_000;
  const timeoutMs = Math.max(10_000, platformCapMs - reserveMs);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal: controller.signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // OpenRouter chiede di identificare l'applicazione chiamante: serve per
      // le statistiche e per non essere trattati come traffico anonimo.
      ...(option.provider === "openrouter"
        ? { "HTTP-Referer": "https://pronoblast.netlify.app", "X-Title": "ScoreBlast" }
        : {}),
    },
    body: JSON.stringify({
      model: option.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt + "\n\nIMPORTANTE: rispondi SOLO con il JSON, niente testo introduttivo, niente ragionamento, solo l'oggetto JSON." },
      ],
      temperature: 0.2,
      max_tokens: maxTokens,
      ...(disableThinking ? { thinking: { type: "disabled" } } : {}),
      // Fornitore piu' economico del momento, scelto da OpenRouter fra quelli
      // che l'account puo' usare (con la "conservazione zero dei dati" attiva
      // alcuni fornitori scontati rifiutano). Provato il 06/10 su un pronostico
      // di 12.000 token: 0,08 cent contro 0,13 senza; un ordine calcolato da noi
      // finiva sulle riserve perche' i primi fornitori rifiutavano.
      ...(option.provider === "openrouter" && option.economico && !option.model.endsWith(":free")
        ? { provider: { sort: "price" } } : {}),
    }),
  });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error(
        `${option.label} non ha risposto entro ${Math.round(timeoutMs / 1000)} secondi. I modelli gratuiti su OpenRouter sono molto lenti: prova Nemotron 3 Super, che e' lo stesso modello in versione piu' piccola e veloce.`
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const errText = await res.text();
    // 429 = tetto di richieste superato. Vale la pena dirlo in chiaro, perche'
    // sui modelli :free si arriva a 50 richieste al giorno molto in fretta.
    if (res.status === 429) {
      throw new Error(
        `${option.label}: tetto di richieste superato (20 al minuto, 50 al giorno sui modelli gratuiti). Riprova piu' tardi o scegli un altro modello. Dettaglio: ${errText}`
      );
    }
    throw new Error(`Errore ${option.provider} (${res.status}): ${errText}`);
  }

  const data = await res.json();
  // OpenRouter puo' restituire un errore dentro una risposta 200.
  if (data?.error) {
    throw new Error(`Errore ${option.provider}: ${data.error.message || JSON.stringify(data.error)}`);
  }
  const msg = data?.choices?.[0]?.message;
  // OpenRouter espone il ragionamento come `reasoning`, DeepSeek come
  // `reasoning_content`: proviamo entrambi prima di arrenderci.
  let text: string = msg?.content || "";
  if (!text.trim()) text = msg?.reasoning_content || msg?.reasoning || "";
  return text;
}
