"""PDF quote Sisal -> .xlsx nello stesso layout di iLovePDF (quello che il parser
dell'app legge: Ora in A, Manif. in B, Squadra 1/2 in E/F, quote da I in poi).

Il PDF Sisal contiene testo vero: niente OCR. Ogni parola ha la sua posizione x,
e le colonne delle quote sono su una griglia fissa sotto le intestazioni.
"""
import re, sys, pathlib
import pdfplumber
from openpyxl import Workbook

# Colonne del file di uscita (0-based), come nel file iLovePDF
INTESTAZIONE = ["Ora", "Manif.", "Pal.", "Avv.", "Squadra 1", "Squadra 2", None, None,
                1, "X", 2, "H", 1, "X", 2, "1X", "X2", 12,
                "U", "O", "U", "O", "U", "O", "G", "NG"]
PRIMA_QUOTA = 8      # colonna I
# Le 22 colonne quota del PDF, in quest'ordine (confermato da Rossi il 05/10):
# 1 X 2 | H 1 X 2 (handicap) | 1X X2 12 | U1,5 O1,5 U2,5 O2,5 U3,5 O3,5 | GG NG |
# SI NO SI NO (segna goal casa/ospite). Se l'intestazione cambia, ci si ferma.
ETICHETTE_PDF = ["1", "X", "2", "H", "1", "X", "2", "1X", "X2", "12",
                 "U", "O", "U", "O", "U", "O", "G", "NG", "SI", "NO", "SI", "NO"]
N_QUOTE = len(ETICHETTE_PDF)
# Le ultime 4 (segna goal SI/NO) vengono lette, per non far "sbordare" i
# caratteri nelle colonne vicine, ma non vanno nel file: l'app non le usa.
N_SCRITTE = 18

VALORE_RE = re.compile(r"^-?\d{1,3}(,\d{1,2})?$")
ORA_RE = re.compile(r"^\d{1,2}\.\d{2}$")
DATA_RE = re.compile(r"\d{1,2}\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|"
                     r"agosto|settembre|ottobre|novembre|dicembre)", re.I)


def colonne_pagina(parole):
    """Dalla riga di intestazione 'Ora Manif. Pal. ...' ricava i limiti delle
    colonne di testo e il centro di ognuna delle 22 colonne quota."""
    ora = next((w for w in parole if w["text"] == "Ora"), None)
    if not ora:
        return None
    riga = sorted((w for w in parole if abs(w["top"] - ora["top"]) < 2), key=lambda w: w["x0"])
    testi = [w["text"] for w in riga]
    try:
        i_sq2 = max(i for i, t in enumerate(testi) if t == "Squadra")
    except ValueError:
        return None
    # dopo "Squadra" "2"; la "L" della scritta verticale LIVE cade sulla stessa riga
    quote = riga[i_sq2 + 2:][-N_QUOTE:]
    etichette = [w["text"] for w in quote]
    if etichette != ETICHETTE_PDF:
        raise ValueError(f"intestazione quote cambiata: {etichette}")
    # sopra le tre coppie U/O deve esserci 1,5 2,5 3,5, in quest'ordine
    soglie = sorted((w for w in parole if w["text"] in ("1,5", "2,5", "3,5")
                     and ora["top"] - 20 < w["top"] < ora["top"]), key=lambda w: w["x0"])
    centri_u = [(quote[i]["x0"] + quote[i + 1]["x1"]) / 2 for i in (10, 12, 14)]
    if [w["text"] for w in soglie] != ["1,5", "2,5", "3,5"] or any(
            abs((w["x0"] + w["x1"]) / 2 - c) > 5 for w, c in zip(soglie, centri_u)):
        raise ValueError(f"soglie Under/Over cambiate: {[w['text'] for w in soglie]}")
    h = {w["text"]: w for w in riga if w["text"] in ("Ora", "Manif.", "Pal.", "Avv.")}
    sq = [w["x0"] for w in riga if w["text"] == "Squadra"]
    # confine fra due colonne = a meta' fra le loro intestazioni (i valori sono
    # centrati o allineati a destra e sbordano dall'intestazione di qualche punto)
    mezzo = lambda a, b: (h[a]["x1"] + h[b]["x0"]) / 2
    return {
        "top": ora["bottom"],
        # inizio di ogni colonna di testo; la colonna i va da lim[i] a lim[i+1]
        "lim": [0, mezzo("Ora", "Manif."), mezzo("Manif.", "Pal."), mezzo("Pal.", "Avv."),
                (h["Avv."]["x1"] + sq[0]) / 2, sq[1] - 1.5, quote[0]["x0"] - 8],
        "centri": [(w["x0"] + w["x1"]) / 2 for w in quote],
    }


def righe_pagina(pagina, col):
    parole = pagina.extract_words(x_tolerance=1.0, y_tolerance=2, return_chars=True)
    parole = [w for w in parole if w["top"] > col["top"] + 1]
    # raggruppa per riga (stessa altezza, tolleranza 3 punti: le quote stanno ~0.5 piu' su)
    parole.sort(key=lambda w: (w["top"], w["x0"]))
    righe, cur, top = [], [], None
    for w in parole:
        if top is None or abs(w["top"] - top) > 3:
            if cur:
                righe.append(cur)
            cur, top = [], w["top"]
        cur.append(w)
    if cur:
        righe.append(cur)
    # dentro la riga l'ordine e' da sinistra a destra (le altezze differiscono di
    # qualche decimo: ordinando per altezza la sigla poteva finire prima dell'ora)
    return [sorted(r, key=lambda w: w["x0"]) for r in righe]


def converti_riga(parole, col):
    out = [None] * len(INTESTAZIONE)
    testo = [[] for _ in range(6)]
    quote = [[] for _ in range(N_QUOTE)]
    for w in sorted(parole, key=lambda w: w["x0"]):
        cx = (w["x0"] + w["x1"]) / 2
        if w["x0"] < col["lim"][6]:
            # carattere per carattere anche qui: "13.00AMIU1936411" arriva come
            # parola unica e va spezzata sui confini delle colonne
            pezzi = {}
            for c in w["chars"]:
                ccx = (c["x0"] + c["x1"]) / 2
                i = max(k for k in range(6) if ccx >= col["lim"][k])
                pezzi[i] = pezzi.get(i, "") + c["text"]
            for i, t in pezzi.items():
                testo[i].append(t)
        else:
            # carattere per carattere: due quote a due cifre possono toccarsi
            # ("12,0022,00") e diventare una parola sola
            for c in w["chars"]:
                ccx = (c["x0"] + c["x1"]) / 2
                j = min(range(N_QUOTE), key=lambda k: abs(col["centri"][k] - ccx))
                if abs(col["centri"][j] - ccx) > 7.5:
                    raise ValueError(f"carattere fuori griglia: {w['text']} x={ccx:.1f}")
                quote[j].append(c)
    for j, cs in enumerate(quote):
        if not cs:
            continue
        cs.sort(key=lambda c: c["x0"])
        for a, b in zip(cs, cs[1:]):
            if b["x0"] - a["x1"] > 1.5:
                raise ValueError(f"spazio dentro la colonna {j}: {''.join(c['text'] for c in cs)}")
        v = "".join(c["text"] for c in cs)
        if not VALORE_RE.match(v):
            raise ValueError(f"valore strano nella colonna {j}: {v!r}")
        if j < N_SCRITTE:
            out[PRIMA_QUOTA + j] = v
    for i in range(6):
        out[i] = " ".join(testo[i]) or None
    return out


def numero(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return v


def converti(pdf_path, xlsx_path):
    wb = Workbook()
    ws = wb.active
    ws.title = "Table 1"
    ws.append(INTESTAZIONE)
    partite = date = 0
    problemi = []
    with pdfplumber.open(pdf_path) as pdf:
        col = None
        for n, pagina in enumerate(pdf.pages, 1):
            parole = pagina.extract_words(x_tolerance=1.0, y_tolerance=2)
            col = colonne_pagina(parole) or col
            if not col:
                problemi.append(f"pagina {n}: intestazione non trovata")
                continue
            for parole_riga in righe_pagina(pagina, col):
                testo = " ".join(w["text"] for w in parole_riga)
                primo = parole_riga[0]["text"]
                if ORA_RE.match(primo):
                    try:
                        r = converti_riga(parole_riga, col)
                    except ValueError as e:
                        problemi.append(f"pagina {n}: {e} | {testo}")
                        continue
                    r[2], r[3], r[11] = numero(r[2]), numero(r[3]), numero(r[11])
                    ws.append(r)      # l'ora resta TESTO "18.30", mai numero 18.3
                    partite += 1
                elif DATA_RE.search(testo) and primo[:1].isalpha():
                    ws.append([testo] + [None] * (len(INTESTAZIONE) - 1))
                    date += 1
    wb.save(xlsx_path)
    return partite, date, problemi


if __name__ == "__main__":
    p, d, probl = converti(sys.argv[1], sys.argv[2])
    print(f"partite: {p}  giorni: {d}  problemi: {len(probl)}")
    for x in probl[:20]:
        print("  ", x)
