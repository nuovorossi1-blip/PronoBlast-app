/**
 * ALLINEA LA GIOCATA DELLA SCHEDINA AL CONSIGLIATO (19/10/2026, Rossi: "le regole vecchie non servono,
 * devono essere corrette tutte"). matches.pick_finale (Schedina, elenco, multipla) prende la giocata del
 * consigliato salvato con le regole di oggi, anche per le partite gia' iniziate o finite.
 * Il pronostico vero di prima del via resta in dossier_web.numeri.consigliato_prima_del_via.
 *
 * Uso (dalla cartella server-locale): npx tsx --env-file=.env ../scripts/allinea-pick-finale.mts
 */
import { pgGetAll, pgPatch } from "../netlify/functions/lib/supabaseRest";
import { giocataDelConsigliato, VERSIONE_CONSIGLIATO } from "../netlify/functions/lib/letturaPartita";

const d = await pgGetAll("dossier_web?select=match_id,c:numeri->consigliato&numeri->consigliato=not.is.null", "match_id.asc");
const m = await pgGetAll("matches?select=id,pick_finale", "id.asc");
const ora = new Map(m.map((x: any) => [x.id, x.pick_finale]));
let cambiate = 0, uguali = 0;
const lista = d.filter((x: any) => x.c?.regole_versione === VERSIONE_CONSIGLIATO && ora.has(x.match_id));
for (let i = 0; i < lista.length; i += 8) {
  await Promise.all(lista.slice(i, i + 8).map(async (x: any) => {
    const g = giocataDelConsigliato(x.c) ?? { pick_finale: null, pick_finale_prob: null };
    if (ora.get(x.match_id) === g.pick_finale) { uguali++; return; }
    await pgPatch(`matches?id=eq.${encodeURIComponent(x.match_id)}`, g);
    cambiate++;
  }));
}
console.log(`pick_finale: ${cambiate} cambiate, ${uguali} gia' uguali (su ${lista.length}).`);
