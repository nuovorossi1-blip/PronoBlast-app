import { pgGet, pgPost, jsonResponse } from "./lib/supabaseRest";
import { LLM_OPTIONS } from "./lib/llmProviders";
import { modelloScelto } from "./lib/llmScelta";
import { creditiTavily, tettoTavily } from "./lib/webSearch";

const PROVIDER_TOPUP_URL: Record<string, string> = {
  deepseek: "https://platform.deepseek.com/usage",
  groq: "https://console.groq.com/", // gratuito, nessuna ricarica necessaria
  gemini: "https://aistudio.google.com/",
  openrouter: "https://openrouter.ai/settings/credits",
  anthropic: "https://console.anthropic.com/settings/billing",
  openai: "https://platform.openai.com/settings/organization/billing",
};

/**
 * GET  /budget       -> spesa stimata, modello attuale, link di ricarica del provider giusto
 * POST /budget/reset  (via ?reset=true) -> azzera i contatori
 * Porting di GET /settings/budget e POST /settings/budget/reset (server.py).
 * Non esiste piu' un "topup_url" unico (era la Universal Key di Emergent):
 * ogni provider ha il proprio link di ricarica.
 */
export default async (req: Request): Promise<Response> => {
  try {
    const url = new URL(req.url);
    const isReset = req.method === "POST" && url.searchParams.get("reset") === "true";

    if (isReset) {
      await pgPost("settings", { key: "ai_spent", value: 0 }, "resolution=merge-duplicates,return=minimal");
      await pgPost("settings", { key: "ai_count", value: 0 }, "resolution=merge-duplicates,return=minimal");
      return jsonResponse({ ok: true });
    }

    if (req.method !== "GET") return jsonResponse({ error: "Metodo non supportato" }, 405);

    const [spentRows, countRows, selected, tavily, tetto] = await Promise.all([
      pgGet(`settings?key=eq.ai_spent&select=value`),
      pgGet(`settings?key=eq.ai_count&select=value`),
      modelloScelto().catch(() => LLM_OPTIONS[0]),
      creditiTavily((process.env.TAVILY_API_KEY || "").trim()),
      tettoTavily(),
    ]);
    const spent = spentRows.length ? Number(spentRows[0].value) || 0 : 0;
    const count = countRows.length ? Number(countRows[0].value) || 0 : 0;

    return jsonResponse({
      estimated_spent_usd: Math.round(spent * 10000) / 10000,
      predictions_made: count,
      current_model: selected.label,
      cost_per_prediction_usd: selected.cost_per_pred,
      topup_url: PROVIDER_TOPUP_URL[selected.provider] || "",
      // Crediti della ricerca web, letti da Tavily (null se non risponde).
      tavily: tavily ? { ...tavily, tetto } : null,
    });
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 500);
  }
};
