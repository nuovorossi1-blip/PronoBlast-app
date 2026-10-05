"""Agente "Aggiorna Quote" del PC di casa (05/10/2026).

Gira in sottofondo da quando si accede a Windows (vedi installa.ps1). Ogni 15
secondi manda un "battito" a PronoBlast (/quote-pc): finche' i battiti arrivano,
nell'app il tasto "Aggiorna Quote" funziona; se il PC e' spento, l'app dice
"Server spento".

Quando nell'app si preme il tasto, al battito successivo il server risponde con
la richiesta e qui si fa, da soli, quello che prima si faceva a mano:
  1. Edge scarica il PDF da Sisal (con la finestra aperta ma FUORI dallo schermo:
     senza finestra la protezione anti-bot di Sisal chiude la connessione);
  2. converti.py lo trasforma in .xlsx, senza OCR (il PDF ha testo vero);
  3. il file va a /upload-excel, lo stesso import del tasto "Carica File Excel".
PDF ed Excel restano in Documenti\\Quote Sisal, uno per volta, con data e ora.

Uso:  pythonw agente.py            (sottofondo, quello che lancia l'installazione)
      python  agente.py --una-volta  (scarica + converte + carica subito, senza app)
      python  agente.py --prova      (scarica + converte, NON carica)
"""
import base64, ctypes, ctypes.wintypes, datetime, json, logging, pathlib, socket, sys, time, traceback, uuid
import urllib.request, urllib.error

import converti

VERSIONE = "2026-10-05"
SITO = "https://pronoblast.vercel.app"
URL_PDF = "https://landing.sisal.it/volantini/Scommesse_Sport/Quote/calcio%20base%20per%20data.pdf"
OGNI_SECONDI = 15
PORTA_UNICA = 47815   # impedisce di avere due agenti accesi insieme


def documenti() -> pathlib.Path:
    """La cartella Documenti vera (anche se spostata su OneDrive o altrove)."""
    buf = ctypes.create_unicode_buffer(ctypes.wintypes.MAX_PATH)
    ctypes.windll.shell32.SHGetFolderPathW(None, 5, None, 0, buf)   # 5 = CSIDL_PERSONAL
    return pathlib.Path(buf.value or pathlib.Path.home() / "Documents")


BASE = documenti() / "Quote Sisal"
CARTELLA_PDF = BASE / "Quote PDF Sisal"
CARTELLA_EXCEL = BASE / "Quote Excel convertite"
for c in (CARTELLA_PDF, CARTELLA_EXCEL):
    c.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    filename=BASE / "registro.txt", level=logging.INFO, encoding="utf-8",
    format="%(asctime)s  %(levelname)s  %(message)s",
)
log = logging.getLogger("quote")


# ---------------------------------------------------------------- PronoBlast
def chiama(azione: str, **dati) -> dict:
    corpo = json.dumps({"azione": azione, **dati}).encode()
    req = urllib.request.Request(f"{SITO}/quote-pc", data=corpo, method="POST",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def carica_excel(percorso: pathlib.Path) -> dict:
    """Come il tasto "Carica File Excel": multipart con il campo 'file'."""
    confine = uuid.uuid4().hex
    corpo = (
        f"--{confine}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{percorso.name}"\r\n'
        "Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n"
    ).encode() + percorso.read_bytes() + f"\r\n--{confine}--\r\n".encode()
    req = urllib.request.Request(f"{SITO}/upload-excel", data=corpo, method="POST",
                                 headers={"Content-Type": f"multipart/form-data; boundary={confine}"})
    try:
        with urllib.request.urlopen(req, timeout=280) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"caricamento rifiutato ({e.code}): {e.read()[:300].decode(errors='replace')}")


# ---------------------------------------------------------------- Sisal
JS_SCARICA = """async (u) => {
  const r = await fetch(u, {cache: 'no-store'});
  const b = new Uint8Array(await r.arrayBuffer());
  let s = ''; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768));
  return {status: r.status, dati: btoa(s)};
}"""


def scarica_pdf(dest: pathlib.Path):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(
            channel="msedge", headless=False,
            args=["--window-position=-32000,-32000", "--window-size=800,600"],
        )
        try:
            page = browser.new_context(locale="it-IT").new_page()
            page.goto(URL_PDF, timeout=90_000)
            r = page.evaluate(JS_SCARICA, URL_PDF)
        finally:
            browser.close()
    dati = base64.b64decode(r["dati"])
    if r["status"] != 200 or dati[:4] != b"%PDF":
        raise RuntimeError(f"Sisal non ha dato il PDF (HTTP {r['status']}, {len(dati)} byte)")
    dest.write_bytes(dati)


# ---------------------------------------------------------------- lavoro
def esegui(fase=lambda testo: None, carica=True) -> dict:
    nome = "Quote Sisal " + datetime.datetime.now().strftime("%Y-%m-%d %H-%M")
    pdf = CARTELLA_PDF / f"{nome}.pdf"
    xlsx = CARTELLA_EXCEL / f"{nome}.xlsx"

    fase("Scarico il PDF da Sisal…")
    scarica_pdf(pdf)
    log.info("PDF salvato: %s (%d byte)", pdf, pdf.stat().st_size)

    fase("Converto il PDF in Excel…")
    partite, giorni, problemi = converti.converti(pdf, xlsx)
    log.info("Excel salvato: %s (%d partite, %d giorni, %d problemi)", xlsx, partite, giorni, len(problemi))
    for p in problemi:
        log.warning("riga saltata: %s", p)
    if partite < 50:
        raise RuntimeError(f"nel PDF ho trovato solo {partite} partite: non carico niente, controlla il file {pdf.name}")
    if len(problemi) > partite * 0.02:
        raise RuntimeError(f"{len(problemi)} righe illeggibili su {partite}: il PDF potrebbe essere cambiato, non carico niente")

    esito = {"partite_pdf": partite, "pdf": pdf.name, "excel": xlsx.name}
    if carica:
        fase(f"Carico {partite} partite su PronoBlast…")
        esito.update(carica_excel(xlsx))
        log.info("Caricato: %s", esito)
    return esito


def gestisci(richiesta: dict):
    rid = richiesta["id"]
    if not chiama("prendi", id=rid).get("ok"):
        return   # presa da qualcun altro o non piu' valida
    log.info("Richiesta %s presa", rid)

    def fase(testo):
        try:
            chiama("stato", id=rid, stato="in_corso", fase=testo)
        except Exception as e:
            log.warning("fase non inviata: %s", e)

    try:
        esito = esegui(fase)
        chiama("stato", id=rid, stato="fatto", fase="Fatto", esito=esito)
    except Exception as e:
        log.error("Richiesta %s fallita: %s\n%s", rid, e, traceback.format_exc())
        try:
            chiama("stato", id=rid, stato="errore", fase="Errore", errore=str(e)[:500])
        except Exception:
            pass


def ciclo():
    unico = socket.socket()
    try:
        unico.bind(("127.0.0.1", PORTA_UNICA))
    except OSError:
        log.info("Un altro agente e' gia' acceso: esco.")
        return
    log.info("Agente avviato (versione %s). Cartella: %s", VERSIONE, BASE)
    errori = 0
    while True:
        try:
            r = chiama("battito", versione=VERSIONE)
            if errori:
                log.info("Di nuovo in contatto con PronoBlast.")
            errori = 0
            if r.get("richiesta"):
                gestisci(r["richiesta"])
                continue   # battito subito dopo il lavoro
        except Exception as e:
            errori += 1
            if errori in (1, 20) or errori % 240 == 0:   # non riempire il registro se manca la rete
                log.warning("Battito non riuscito (%d di fila): %s", errori, e)
        time.sleep(OGNI_SECONDI)


if __name__ == "__main__":
    if "--una-volta" in sys.argv or "--prova" in sys.argv:
        stampa = lambda t: print(t, flush=True)
        print(json.dumps(esegui(stampa, carica="--una-volta" in sys.argv), indent=2, ensure_ascii=False))
    else:
        ciclo()
