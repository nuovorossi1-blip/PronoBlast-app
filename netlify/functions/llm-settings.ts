import { pgGet, pgPost, jsonResponse } from "./lib/supabaseRest";
import { LLM_OPTIONS, DEFAULT_LLM, isProviderUsable } from "./lib/llmProviders";
import { catalogoOpenRouter, creditoOpenRouter, economicoAttivo, opzioneDaId, PREFISSO_OR } from "./lib/llmScelta";

/**
 * GET  /llm-settings                 -> { options, selected_id, selected, openrouter }
 * GET  /llm-settings?catalogo=openrouter -> { modelli } (tutti i modelli OpenRouter dal vivo)
 * POST /llm-settings { id }          -> sceglie il modello (fisso o "or:<id OpenRouter>")
 * POST /llm-settings { economico }   -> interruttore "fornitore piu' economico" di OpenRouter
 * Porting di GET/POST /settings/llm (server.py). Ogni opzione include
 * "configured" (se la relativa API key c'e') cosi' il frontend mostra quali
 * modelli sono davvero utilizzabili. Modelli OpenRouter dal vivo: lib/llmScelta.ts.
 */
export default async (req: Request): Promise<Response> => {
  try {
    const url = new URL(req.url);
    if (req.method === "GET") {
      if (url.searchParams.get("catalogo") === "openrouter") {
        return jsonResponse({ modelli: await catalogoOpenRouter() });
      }
      const rows = await pgGet(`settings?key=eq.llm_model&select=value`);
      const selectedId = rows.length ? rows[0].value : DEFAULT_LLM;
      const options = LLM_OPTIONS.map((o) => ({ ...o, configured: isProviderUsable(o.provider) }));
      const [selected, credito, economico] = await Promise.all([
        opzioneDaId(selectedId), creditoOpenRouter(), economicoAttivo(),
      ]);
      return jsonResponse({
        options, selected_id: selectedId, selected,
        openrouter: { configurato: isProviderUsable("openrouter"), credito, economico },
      });
    }

    if (req.method === "POST") {
      const body = await req.json();
      if (typeof body?.economico === "boolean") {
        await pgPost("settings", { key: "openrouter_economico", value: body.economico }, "resolution=merge-duplicates,return=minimal");
        return jsonResponse({ ok: true, economico: body.economico });
      }
      const id = String(body?.id || "");
      let valido = LLM_OPTIONS.some((o) => o.id === id);
      if (!valido && id.startsWith(PREFISSO_OR)) {
        const modello = id.slice(PREFISSO_OR.length);
        valido = (await catalogoOpenRouter()).some((m) => m.id === modello);
      }
      if (!valido) return jsonResponse({ error: "LLM id non valido" }, 400);
      await pgPost(
        "settings",
        { key: "llm_model", value: id },
        "resolution=merge-duplicates,return=minimal"
      );
      return jsonResponse({ ok: true, selected_id: id });
    }

    return jsonResponse({ error: "Metodo non supportato" }, 405);
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 500);
  }
};
