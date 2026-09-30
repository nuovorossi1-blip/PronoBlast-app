-- =============================================================================
-- docs/database.sql — lo schema Supabase che il codice si aspetta
-- =============================================================================
-- Progetto Supabase: "emergent-app-db" (id zjucgmngettxfwgxazxl).
--
-- COME SI USA: Supabase → SQL Editor → incolla tutto → Run.
-- E' RILANCIABILE quante volte si vuole: solo ADD COLUMN IF NOT EXISTS e SELECT.
-- Nessun DROP, nessun UPDATE, nessun DELETE: non tocca i dati esistenti.
--
-- REGOLA: ogni modifica al codice che richiede una colonna/tabella/funzione nuova
-- aggiunge qui la sua riga (con la data e la PR), oltre alla voce nel CHANGELOG.md.
-- Le colonne e le funzioni sono state create a mano su Supabase nel tempo: questo
-- file e' l'unico posto nel repo in cui sono scritte tutte insieme.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. CONTROLLO: quali colonne ci sono oggi (solo lettura)
-- -----------------------------------------------------------------------------
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name in ('matches', 'predictions')
order by table_name, ordinal_position;


-- -----------------------------------------------------------------------------
-- 1. matches — una riga per partita
-- -----------------------------------------------------------------------------
-- Le colonne base (id, day, time, squadre, campionato, quote, result, family,
-- main_prediction, selected, ...) esistono dalla creazione del progetto.
-- Queste sono state aggiunte dopo:

-- Verdetto congelato a partita finita (log 2026-09-28 (2)). E' la prova storica:
-- non va mai riscritto dal ricalcolo.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS pick_finale text;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS pick_finale_prob double precision;

-- Migration "fase0_pagella_tre_sistemi" (2026-09-17): pick del motore Poisson e
-- del PRE, scritti da predict.ts; servono all'apprendimento per sistema
-- (applyResult.ts) e alla pagella (manuale.ts). Stessa migration: pick_finale,
-- pick_finale_prob, scenario, tabella system_scorecard, RPC increment_system_score.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS pick_strutturale text;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS pick_pre text;

-- Scenario della partita (lib/scenario.ts), usato da scenario_market_scores.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS scenario text;

-- Ricalcolo storico con le regole di oggi, in ordine di data (PR #7, 2026-09-30).
-- Scritto SOLO da netlify/functions/ricalcolo.ts; pick_finale resta intatto.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS ricalcolo jsonb;


-- -----------------------------------------------------------------------------
-- 2. predictions — pronostici AI (piu' righe per partita, vale l'ultima)
-- -----------------------------------------------------------------------------
-- xG letti dal web e h2h (log 2026-09-28). Mancavano in produzione: i log Vercel
-- mostravano il salvataggio che li scartava.
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS xg_casa numeric;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS xg_ospite numeric;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS h2h_over_pct numeric;

-- Tabella casa | ospite della scheda AI (Ticket 10, PR #2).
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS statistiche_squadre jsonb;

-- Classifica e verdetto dell'AI per fascia 1.40/1.50/1.60/1.75, fonti web (PR #3).
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS fasce jsonb;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS fonti_web jsonb;

-- true = pronostico generato dopo il calcio d'inizio: non conta ne' nel verdetto
-- ne' nella pagella (PR #4).
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS post_partita boolean;

-- NOTA: ai-predict.ts, se PostgREST segnala una colonna mancante, la toglie e
-- riprova il salvataggio: il pronostico non si perde, ma quel campo si'. Se un
-- campo della scheda AI "sparisce" dopo il ricaricamento, controllare qui.


-- -----------------------------------------------------------------------------
-- 3. Altre tabelle usate dal codice (esistono gia', nessuna modifica)
-- -----------------------------------------------------------------------------
--   settings                 chiave/valore: impostazioni, stato del ricalcolo
--                            (chiave 'ricalcolo_stato'), memo varie
--   market_scores            apprendimento per famiglia + mercato + campionato
--   family_counters          contatori partite per famiglia
--   scenario_market_scores   apprendimento per scenario 1X2 + mercato
--   system_scorecard         pagella dei sistemi (STRUTT / AI / PRE)
--   team_alias               nomi squadra alternativi (sync-results.ts)
--   upload_skipped           righe Excel scartate all'import
--   match_results_training   storico grezzo ScoreBlast (match-history.ts)


-- -----------------------------------------------------------------------------
-- 4. Funzioni RPC — la definizione NON e' ancora nel repo
-- -----------------------------------------------------------------------------
-- Il codice chiama via /rest/v1/rpc/...:
--   apply_family_result, apply_scenario_result, bulk_upsert_matches,
--   increment_system_score, matches_distinct_days, team_goal_stats
-- Esistono solo dentro Supabase. Per archiviarle, lanciare questa query e
-- incollare qui sotto il risultato (colonna pg_get_functiondef):
select p.proname, pg_get_functiondef(p.oid)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('apply_family_result', 'apply_scenario_result',
                    'bulk_upsert_matches', 'increment_system_score',
                    'matches_distinct_days', 'team_goal_stats');

-- (definizioni da incollare qui)
