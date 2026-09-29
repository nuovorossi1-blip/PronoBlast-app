/**
 * DISPATCHER UNICO per tutte le rotte di /api su Vercel.
 *
 * PERCHE' NON C'E' UN FILE PER FUNZIONE (11/09/2026)
 * --------------------------------------------------
 * Il primo tentativo aveva 27 involucri, uno per funzione, com'e' su Netlify.
 * Il build passava (l'esportazione Expo e la compilazione delle 27 function
 * andavano a buon fine) ma il deploy falliva subito dopo, al passo "Deploying
 * outputs", senza niente nei log del build: il piano Hobby di Vercel accetta
 * al massimo **12 Serverless Function per deploy**, e noi ne creavamo 27.
 *
 * Qui invece c'e' UNA SOLA function che riceve tutte le rotte e smista al
 * gestore giusto in base all'ultimo pezzo del percorso. Gli import sono
 * statici, non dinamici, perche' il bundler deve poterli seguire a tempo di
 * compilazione.
 *
 * `upload-excel.mjs` resta un file a se': e' gia' un bundle con xlsx dentro,
 * ed e' JavaScript, non TypeScript. Importarlo da qui creerebbe problemi di
 * risoluzione senza alcun vantaggio. Totale: 2 function, contro un tetto di 12.
 *
 * Le implementazioni non sono state toccate: vivono ancora in
 * netlify/functions/, le stesse che girano su Netlify.
 */
import ai_predict from "../netlify/functions/ai-predict";
import aistudio_prompt from "../netlify/functions/aistudio-prompt";
import budget from "../netlify/functions/budget";
import build_multipla from "../netlify/functions/build-multipla";
import db_stats from "../netlify/functions/db-stats";
import pending_matches from "../netlify/functions/pending-matches";
import results_import from "../netlify/functions/results-import";
import sync_results from "../netlify/functions/sync-results";
import rebuild_learning from "../netlify/functions/rebuild-learning";
import similar_odds from "../netlify/functions/similar-odds";
import manuale_stats from "../netlify/functions/manuale-stats";
import web_probe from "../netlify/functions/web-probe";
import af_probe from "../netlify/functions/af-probe";
import backtest from "../netlify/functions/backtest";
import verdetto from "../netlify/functions/verdetto";
import apif_probe from "../netlify/functions/apif-probe";
import delete_all from "../netlify/functions/delete-all";
import export_db from "../netlify/functions/export-db";
import import_db from "../netlify/functions/import-db";
import llm_settings from "../netlify/functions/llm-settings";
import match_candidates from "../netlify/functions/match-candidates";
import match_detail from "../netlify/functions/match-detail";
import match_history from "../netlify/functions/match-history";
import match_result from "../netlify/functions/match-result";
import matches_days from "../netlify/functions/matches-days";
import matches_list from "../netlify/functions/matches-list";
import ml_stats from "../netlify/functions/ml-stats";
import odd_settings from "../netlify/functions/odd-settings";
import predict from "../netlify/functions/predict";
import results_apply from "../netlify/functions/results-apply";
import results_bulk from "../netlify/functions/results-bulk";
import results_fetch from "../netlify/functions/results-fetch";
import save_verdict from "../netlify/functions/save-verdict";
import selected_list from "../netlify/functions/selected-list";
import selection_clear from "../netlify/functions/selection-clear";
import selection_update from "../netlify/functions/selection-update";
import stats_reset from "../netlify/functions/stats-reset";
import stats_scores from "../netlify/functions/stats-scores";
import upload_skipped from "../netlify/functions/upload-skipped";

type Handler = (req: Request) => Promise<Response>;

const ROUTES: Record<string, Handler> = {
  "ai-predict": ai_predict,
  "aistudio-prompt": aistudio_prompt,
  "budget": budget,
  "build-multipla": build_multipla,
  "db-stats": db_stats,
  "pending-matches": pending_matches,
  "results-import": results_import,
  "sync-results": sync_results,
  "rebuild-learning": rebuild_learning,
  "similar-odds": similar_odds,
  "manuale-stats": manuale_stats,
  "web-probe": web_probe,
  "af-probe": af_probe,
  "backtest": backtest,
  "verdetto": verdetto,
  "apif-probe": apif_probe,
  "delete-all": delete_all,
  "export-db": export_db,
  "import-db": import_db,
  "llm-settings": llm_settings,
  "match-candidates": match_candidates,
  "match-detail": match_detail,
  "match-history": match_history,
  "match-result": match_result,
  "matches-days": matches_days,
  "matches-list": matches_list,
  "ml-stats": ml_stats,
  "odd-settings": odd_settings,
  "predict": predict,
  "results-apply": results_apply,
  "results-bulk": results_bulk,
  "results-fetch": results_fetch,
  "save-verdict": save_verdict,
  "selected-list": selected_list,
  "selection-clear": selection_clear,
  "selection-update": selection_update,
  "stats-reset": stats_reset,
  "stats-scores": stats_scores,
  "upload-skipped": upload_skipped,
};

async function dispatch(req: Request): Promise<Response> {
  // L'ultimo segmento del percorso e' il nome della rotta. Funziona sia se
  // arriva come /predict (rotta pulita, riscritta da vercel.json) sia come
  // /api/predict (chiamata diretta), cosi' non dipendiamo da come Vercel
  // presenta l'URL dopo un rewrite.
  let name = "";
  try {
    name = new URL(req.url).pathname.split("/").filter(Boolean).pop() || "";
  } catch {
    name = "";
  }

  const handler = ROUTES[name];
  if (!handler) {
    return new Response(
      JSON.stringify({ error: `Rotta sconosciuta: "${name}"` }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }
  return handler(req);
}

export const GET = dispatch;
export const POST = dispatch;
export const PUT = dispatch;
export const PATCH = dispatch;
export const DELETE = dispatch;
export const OPTIONS = dispatch;
