-- =============================================================================
-- docs/database.sql — lo schema Supabase che il codice si aspetta
-- =============================================================================
-- Progetto Supabase: "pronoblast-app-db" (id zjucgmngettxfwgxazxl; ex "emergent-app-db").
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


-- -----------------------------------------------------------------------------
-- 5. OROLOGIO DEI LAVORI IN BACKGROUND (2026-10-01, PR #8)
-- -----------------------------------------------------------------------------
-- I lavori lunghi (ricalcolo, ricostruzione apprendimento, pagella di Traccia,
-- caricamento risultati, aggiornamento risultati) girano sul server: vedi
-- netlify/functions/lavori.ts. Questo orologio chiama /lavori?passo=1 ogni
-- minuto: se c'e' un lavoro in corso fermo, riparte dal punto salvato. Senza
-- orologio il lavoro avanza solo mentre l'app e' aperta in Strumenti/Traccia.
-- 06/10/2026: chiama Vercel SOLO se c'e' un lavoro in corso e il lucchetto e'
-- libero (nessun passo sta gia' lavorando). Prima chiamava ogni minuto sempre:
-- 1440 chiamate al giorno a vuoto, e la CPU gratuita di Vercel era finita.
-- Rilanciarlo e' innocuo: cron.schedule con lo stesso nome sostituisce il vecchio.
create extension if not exists pg_net;
create extension if not exists pg_cron;
select cron.schedule(
  'pronoblast-lavori',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://pronoblast.vercel.app/lavori?passo=1',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb,
       timeout_milliseconds := 290000
     )
     where exists (
       select 1 from public.settings
       where key = 'lavoro_corrente'
         and value->>'stato' = 'in_corso'
         and (value->>'lucchetto' is null
              or value->>'lucchetto_fino' is null
              or (value->>'lucchetto_fino')::timestamptz < now())
     ) $$
);
-- Controllo: l'orologio c'e' e gira?
--   select jobname, schedule, active from cron.job;
--   select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
-- Per spegnerlo: select cron.unschedule('pronoblast-lavori');


-- -----------------------------------------------------------------------------
-- 6. DOSSIER WEB PER PARTITA (2026-10-06, ramo ricerca-web)
-- -----------------------------------------------------------------------------
-- Il contesto trovato da Tavily per una partita si salva qui e si riusa per
-- DOSSIER_VALIDO_ORE (12) ore: "Rigenera" e il cambio di modello non rifanno
-- le ricerche (prima: 6 crediti a ogni rigenera). Vedi lib/webSearch.ts.
-- Il tipo di match_id copia quello di matches.id (uuid o text).
-- RLS spenta come le altre tabelle: il server usa la chiave anon.
do $$
declare tipo text;
begin
  select data_type into tipo from information_schema.columns
   where table_schema = 'public' and table_name = 'matches' and column_name = 'id';
  execute format(
    'create table if not exists public.dossier_web (
       match_id   %s primary key references public.matches(id) on delete cascade,
       contesto   jsonb not null,
       crediti    integer not null default 0,
       created_at timestamptz not null default now()
     )', tipo);
end $$;
alter table public.dossier_web disable row level security;
-- Le tabelle nuove non ricevono piu' i permessi in automatico: senza questa
-- riga la API risponde "permission denied for table dossier_web" (42501).
grant select, insert, update, delete on public.dossier_web to anon, authenticated, service_role;
-- Tetto dei crediti Tavily (facoltativo, predefinito 900 su 1000):
--   insert into settings (key, value) values ('tavily_tetto', '900')
--   on conflict (key) do update set value = excluded.value;
-- Controllo: select count(*), sum(crediti) from dossier_web;

-- Colonne aggiunte dal dossier multi-fonte (2026-10-06, passi 2-3): i NUMERI
-- chiave (classifica, xG, assenti, forma, precedenti) restano per sempre e
-- servono allo storico; il testo del dossier si compatta dopo 60 giorni
-- (dossier-giornata.ts). `fonti_dati`: "FotMob+SearXNG", "SearXNG", "Tavily".
alter table public.dossier_web add column if not exists numeri jsonb;
alter table public.dossier_web add column if not exists fonti_dati text;


-- -----------------------------------------------------------------------------
-- 7. OROLOGI: DOSSIER AUTOMATICO E QUOTE ALLE 12 (2026-10-06)
-- -----------------------------------------------------------------------------
-- pg_cron gira in UTC: l'ora italiana si controlla nella WHERE, cosi' vale sia
-- con l'ora legale sia con l'ora solare. Ogni ora l'orologio "guarda", ma
-- chiama il server SOLO all'ora giusta: nessuna chiamata a vuoto.
--  - alle 6: dossier di tutte le partite del giorno (dossier-giornata.ts);
--  - alle 12: "Aggiorna Quote", come premere il tasto (quote-pc.ts);
--  - alle 13: dossier delle partite caricate dall'aggiornamento delle 12;
--  - ogni minuto, SOLO mentre il dossier e' in corso e nessun passo lavora.
-- L'indirizzo e' quello del server sul PC di casa: al ritorno su Vercel va
-- cambiato in https://pronoblast.vercel.app (come 'pronoblast-lavori').
-- Rilanciare e' innocuo: cron.schedule con lo stesso nome sostituisce.
select cron.schedule('pronoblast-dossier-avvio', '0 * * * *', $$
  select net.http_post(
    url := 'https://pc-claude.tailcad625.ts.net:8443/dossier-giornata?avvia=1',
    headers := '{"Content-Type": "application/json"}'::jsonb, body := '{}'::jsonb,
    timeout_milliseconds := 60000)
  where extract(hour from now() at time zone 'Europe/Rome') in (6, 13) $$);
select cron.schedule('pronoblast-dossier-passo', '* * * * *', $$
  select net.http_post(
    url := 'https://pc-claude.tailcad625.ts.net:8443/dossier-giornata?passo=1',
    headers := '{"Content-Type": "application/json"}'::jsonb, body := '{}'::jsonb,
    timeout_milliseconds := 290000)
  where exists (
    select 1 from public.settings
    where key = 'dossier_giornata' and value->>'stato' = 'in_corso'
      and (value->>'lucchetto_fino' is null or (value->>'lucchetto_fino')::timestamptz < now())) $$);
select cron.schedule('pronoblast-quote-12', '0 * * * *', $$
  select net.http_post(
    url := 'https://pc-claude.tailcad625.ts.net:8443/quote-pc',
    headers := '{"Content-Type": "application/json"}'::jsonb, body := '{"azione": "avvia"}'::jsonb,
    timeout_milliseconds := 30000)
  where extract(hour from now() at time zone 'Europe/Rome') = 12 $$);
-- Pulizia del registro degli orologi (cron.job_run_details): una riga per ogni
-- esecuzione, ~0,5 MB al giorno con due orologi al minuto (misurato il 06/10:
-- 8.074 righe in 6 giorni). Si tengono 7 giorni. Ogni notte alle 2:15 UTC.
select cron.schedule('pronoblast-pulizia-registro', '15 2 * * *',
  $$ delete from cron.job_run_details where end_time < now() - interval '7 days' $$);
-- Controllo: select jobname, schedule, active from cron.job;
-- Stato del dossier: select value from settings where key = 'dossier_giornata';