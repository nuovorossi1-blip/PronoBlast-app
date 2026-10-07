/**
 * I CALCOLI CHE L'AI NON SA FARE DA SOLA (07/10/2026, test con Rossi).
 *
 * Test sulle 9 partite del 06/10: Nemotron Super scrive bene e trova le
 * assenze, ma ha detto "forma e quote d'accordo" in tutte e 9. Non pesa la
 * forma con gli avversari (Slovacchia "fragile" per le trasferte contro
 * squadre forti, Finlandia "goleador" per un 7-0 a una piccola) e non collega
 * le assenze alla lettura (Islanda senza 5, Finlandia senza 5). Quindi il
 * programma calcola e passa all'AI conclusioni gia' pronte:
 *
 *  1. FORZA di una squadra = differenza reti media nelle sue ultime 10 partite
 *     (solo 90 minuti, FotMob).
 *  2. FORMA PESATA: le ultime 10 partite di una squadra, ognuna pesata per
 *     quanto l'avversario di allora somiglia per forza a quello di oggi
 *     (peso = e^(-|differenza di forza| / 0,7)). "Contro squadre come la
 *     Moldova, la Slovacchia fa X e prende Y."
 *  3. GOL ATTESI DALLA FORMA = attacco pesato di una incrociato con la difesa
 *     pesata dell'altra; confronto con i gol attesi dalle quote.
 *  4. D'ACCORDO / NON D'ACCORDO: totale che differisce di 0,7 gol o piu', o
 *     direzione opposta.
 *  5. ASSENZE: 3 o piu' assenti in una squadra (dossier FotMob).
 */
import { partiteFinite, type FormaGol } from "./formaGol";

const forze = new Map<string, number | null>();

/** Differenza reti media nelle ultime 10 partite prima di `primaMs`. */
export async function forzaSquadra(id: number, primaMs: number): Promise<number | null> {
  const k = `${id}|${Math.floor(primaMs / 86_400_000)}`;
  if (forze.has(k)) return forze.get(k)!;
  let v: number | null = null;
  try {
    const p = (await partiteFinite(id, primaMs)).slice(-10);
    if (p.length >= 3) v = p.reduce((s, x) => s + x.fatti - x.subiti, 0) / p.length;
  } catch { /* squadra non trovata: forza ignota */ }
  forze.set(k, v);
  return v;
}

export type FormaPesata = {
  fatti: number; subiti: number; peso: number; n: number;
  contro: { avversario: string; forza: number | null; fatti: number; subiti: number; peso: number }[];
};

async function formaPesata(id: number, primaMs: number, forzaOggi: number | null): Promise<FormaPesata | null> {
  const partite = (await partiteFinite(id, primaMs)).slice(-10);
  if (partite.length < 3) return null;
  // Recenza (07/10/2026, test Estonia-Islanda): con 10 partite a pari peso la
  // serie recente di 1-0 dell'Estonia si diluiva fra le sconfitte del 2025.
  // L'ultima pesa 1, la penultima 0,9, poi 0,81... (la decima ~0,39).
  const contro = await Promise.all(partite.map(async (p, i) => {
    const f = await forzaSquadra(p.id_avversario, Date.parse(p.data + "T12:00:00Z"));
    const recenza = Math.pow(0.9, partite.length - 1 - i);
    const peso = (forzaOggi == null || f == null ? 0.5 : Math.exp(-Math.abs(f - forzaOggi) / 0.7)) * recenza;
    return { avversario: p.avversario, forza: f, fatti: p.fatti, subiti: p.subiti, peso };
  }));
  const peso = contro.reduce((s, c) => s + c.peso, 0);
  if (peso <= 0) return null;
  return {
    fatti: contro.reduce((s, c) => s + c.fatti * c.peso, 0) / peso,
    subiti: contro.reduce((s, c) => s + c.subiti * c.peso, 0) / peso,
    peso, n: contro.length, contro,
  };
}

export type LetturaProgramma = {
  forza_casa: number | null; forza_ospite: number | null;
  pesata_casa: FormaPesata | null; pesata_ospite: FormaPesata | null;
  forma_casa: number | null; forma_ospite: number | null; forma_totale: number | null;
  quote_casa: number; quote_ospite: number; quote_totale: number;
  accordo: boolean | null; motivi: string[];
  assenti_casa: number; assenti_ospite: number;
  testo: string;
  /** Le stesse conclusioni in frasi semplici, per la scheda. */
  frasi: string[];
};

const g = (x: number | null | undefined) => (x == null ? "n/d" : x.toFixed(1).replace(".", ","));
const s = (x: number | null) => (x == null ? "n/d" : `${x >= 0 ? "+" : ""}${x.toFixed(1).replace(".", ",")}`);

export async function letturaProgramma(
  forma: FormaGol | null,
  nomi: { casa: string; ospite: string },
  lambda: { casa: number; ospite: number },
  assenti: { casa: number; ospite: number },
): Promise<LetturaProgramma> {
  const qc = lambda.casa, qo = lambda.ospite;
  const out: LetturaProgramma = {
    forza_casa: null, forza_ospite: null, pesata_casa: null, pesata_ospite: null,
    forma_casa: null, forma_ospite: null, forma_totale: null,
    quote_casa: qc, quote_ospite: qo, quote_totale: qc + qo,
    accordo: null, motivi: [], assenti_casa: assenti.casa, assenti_ospite: assenti.ospite, testo: "", frasi: [],
  };
  const prima = forma?.inizio_ms ?? Date.now();
  if (forma?.id_casa && forma?.id_ospite) {
    [out.forza_casa, out.forza_ospite] = await Promise.all([forzaSquadra(forma.id_casa, prima), forzaSquadra(forma.id_ospite, prima)]);
    [out.pesata_casa, out.pesata_ospite] = await Promise.all([
      formaPesata(forma.id_casa, prima, out.forza_ospite),
      formaPesata(forma.id_ospite, prima, out.forza_casa),
    ]);
  }
  const pc = out.pesata_casa, po = out.pesata_ospite;
  if (pc && po) {
    out.forma_casa = (pc.fatti + po.subiti) / 2;
    out.forma_ospite = (po.fatti + pc.subiti) / 2;
    out.forma_totale = out.forma_casa + out.forma_ospite;
    const diff = out.forma_totale - out.quote_totale;
    if (Math.abs(diff) >= 0.7) {
      out.motivi.push(diff < 0
        ? `la forma pesata dice ${g(out.forma_totale)} gol, le quote ${g(out.quote_totale)}: MENO gol del previsto`
        : `la forma pesata dice ${g(out.forma_totale)} gol, le quote ${g(out.quote_totale)}: PIU' gol del previsto`);
    }
    const dirQ = qc - qo, dirF = out.forma_casa - out.forma_ospite;
    if (Math.abs(dirQ) >= 0.3 && Math.sign(dirQ) !== Math.sign(dirF)) {
      out.motivi.push(`le quote danno favorita ${dirQ > 0 ? nomi.casa : nomi.ospite}, ma contro avversari di questo livello segna di piu' ${dirF > 0 ? nomi.casa : nomi.ospite}`);
    } else if (Math.abs(dirQ) >= 0.8 && Math.abs(dirF) < 0.3) {
      out.motivi.push(`le quote danno nettamente favorita ${dirQ > 0 ? nomi.casa : nomi.ospite}, ma contro avversari di questo livello le due squadre segnano uguale`);
    }
    out.accordo = out.motivi.length === 0;
  }

  const righe: string[] = [];
  righe.push(`- Forza (differenza reti media nelle ultime 10): ${nomi.casa} ${s(out.forza_casa)} · ${nomi.ospite} ${s(out.forza_ospite)}.`);
  const dettaglio = (p: FormaPesata | null, chi: string, contro: string) => {
    if (!p) return `- ${chi}: forma pesata non disponibile.`;
    const simili = p.contro.filter((c) => c.peso >= 0.4).map((c) => `${c.avversario} ${c.fatti}-${c.subiti}`);
    return `- Contro avversari del livello di ${contro}, ${chi} fa ${g(p.fatti)} e prende ${g(p.subiti)} gol a partita` +
      (simili.length ? ` (partite piu' simili: ${simili.join(", ")})` : " (nessuna partita contro avversari simili: dato debole)") + ".";
  };
  righe.push(dettaglio(pc, nomi.casa, nomi.ospite));
  righe.push(dettaglio(po, nomi.ospite, nomi.casa));
  righe.push(`- Gol attesi: dalle quote ${nomi.casa} ${g(qc)} · ${nomi.ospite} ${g(qo)} (totale ${g(out.quote_totale)}); ` +
    `dalla forma pesata ${nomi.casa} ${g(out.forma_casa)} · ${nomi.ospite} ${g(out.forma_ospite)} (totale ${g(out.forma_totale)}).`);
  righe.push(out.accordo == null
    ? "- FORMA E QUOTE: confronto non possibile (forma non disponibile)."
    : out.accordo
      ? "- FORMA E QUOTE: D'ACCORDO."
      : `- FORMA E QUOTE: NON D'ACCORDO: ${out.motivi.join("; ")}. Partita piu' incerta di come la prezzano le quote.`);
  const ass: string[] = [];
  if (assenti.casa >= 3) ass.push(`${nomi.casa} con ${assenti.casa} assenti`);
  if (assenti.ospite >= 3) ass.push(`${nomi.ospite} con ${assenti.ospite} assenti`);
  righe.push(ass.length ? `- ASSENZE PESANTI: ${ass.join("; ")}: indebolisce chi le ha, soprattutto se e' la favorita.` : "- Assenze: nessuna squadra con 3 o piu' assenti.");
  // Frasi per la scheda (Rossi: "all'utente serve la lettura, non n mila dati").
  const f: string[] = [];
  if (pc) f.push(`Contro squadre del livello di ${nomi.ospite}, ${nomi.casa} fa ${g(pc.fatti)} gol e ne prende ${g(pc.subiti)}.`);
  if (po) f.push(`Contro squadre del livello di ${nomi.casa}, ${nomi.ospite} fa ${g(po.fatti)} gol e ne prende ${g(po.subiti)}.`);
  if (out.accordo === true) f.push("Forma e quote sono d'accordo ✓");
  else if (out.accordo === false) f.push(`⚠ Forma e quote NON sono d'accordo: ${out.motivi.join("; ")}. Partita più incerta.`);
  if (ass.length) f.push(`⚠ Assenze pesanti: ${ass.join("; ")}.`);
  out.frasi = f;
  out.testo = `CALCOLI DEL PROGRAMMA (affidabili: usali, non ricalcolarli):\n${righe.join("\n")}\n` +
    `Nel campo "forma_e_quote" riporta il giudizio del programma. Se NON d'accordo o con assenze pesanti, la lettura deve spiegarlo e tenerne conto nella direzione e nei gol.`;
  return out;
}
