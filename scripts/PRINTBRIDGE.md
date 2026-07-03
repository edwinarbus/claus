# Claus → Epson print bridge

Auto-print (and hand-print) the daily briefing to the **Epson TM-m30II** on this
Mac. Claus renders the whole receipt in the browser — text, the real day map, and
the local phrases — dithers it to 1-bit, and sends the finished ESC/POS bytes to
this tiny local relay, which forwards them to the printer. Pure Python stdlib, no
`pip install`.

## 1. Point it at your printer

**Network (Wi-Fi / Ethernet) — recommended.** Find the printer's IP (Epson
*TMNet WebConfig*, your router's client list, or a printer status slip):

```bash
PRINTER_HOST=192.168.1.50 python3 scripts/printbridge.py
```

**USB (via the macOS Epson driver / CUPS).** Install the TM-m30II driver, add the
printer, then `lpstat -p` to get its queue name:

```bash
PRINTER_CUPS=TM_m30II python3 scripts/printbridge.py
```

Verify the wiring — prints a little test slip and exits:

```bash
PRINTER_HOST=192.168.1.50 python3 scripts/printbridge.py --selftest
```

You should see: `Claus print bridge on http://localhost:8899 · printer: tcp → …`

## 2. Use it in Claus

Open the chat — the daily briefing is the home screen.

- **Auto-print:** when a new day's brief appears and the bridge is up, it prints
  itself **once** (deduped by date). Leave Claus open on the Mac by the printer.
- **Manual:** the **Print to Epson** button under the brief prints it on demand.

If the bridge isn't running, the button falls back to the normal browser print
dialog, so it never dead-ends.

### Browser note (https vs local)

The browser has to allow a page to talk to `http://localhost`. The reliable path
is to open Claus from the **local devserver** so it's http→http:

```bash
python3 scripts/devserver.py 8777      # then open http://localhost:8777
```

From the hosted https site, Chrome allows it (the bridge answers the Private
Network Access preflight); Safari may block it and fall back to the print dialog.

## Options

| env | default | meaning |
| --- | --- | --- |
| `PRINTER_HOST` | — | printer IP for raw ESC/POS over TCP 9100 |
| `PRINTER_PORT` | `9100` | raw print port |
| `PRINTER_CUPS` | — | CUPS queue name (USB path), used if no `PRINTER_HOST` |
| `BRIDGE_PORT` | `8899` | port this relay listens on |
| `BRIDGE_TOKEN` | — | if set, callers must pass `?token=…` (set the same in the app if you use it) |

Endpoints: `GET /health` · `POST /print {"data":"<base64 ESC/POS>"}`.
