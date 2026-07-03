#!/usr/bin/env python3
"""Claus → Epson print bridge (local, pure-stdlib).

The browser renders the daily briefing to a 1-bit thermal raster and hands us the
finished ESC/POS byte stream; this little service just relays those bytes to the
Epson TM-m30II sitting on this Mac. Keeping ALL rendering in the browser means
Scandinavian glyphs (ø å ä ö) and the day map print pixel-for-pixel as shown —
no code-page juggling here.

Two transports, pick whichever matches how the printer is attached:
  • Network / Wi-Fi / Ethernet — raw ESC/POS over TCP 9100 (set PRINTER_HOST).
  • USB (via the macOS Epson driver / CUPS) — `lp -o raw` (set PRINTER_CUPS to
    the queue name, e.g. TM_m30II; `lpstat -p` lists them).

Run it:
  PRINTER_HOST=192.168.1.50 python3 scripts/printbridge.py
  PRINTER_CUPS=TM_m30II      python3 scripts/printbridge.py
  python3 scripts/printbridge.py --selftest     # print a test slip and exit

Then point Claus's "Print to Epson" at http://localhost:8899 (the default).
Endpoints: GET /health · POST /print {"data":"<base64 ESC/POS>"}.
"""

import base64
import json
import os
import socket
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PRINTER_HOST = os.environ.get('PRINTER_HOST', '').strip()
PRINTER_PORT = int(os.environ.get('PRINTER_PORT', '9100'))
PRINTER_CUPS = os.environ.get('PRINTER_CUPS', '').strip()
BRIDGE_PORT = int(os.environ.get('BRIDGE_PORT', '8899'))
# Optional shared secret: if set, callers must send ?token=… (keeps a stray tab
# on your network from printing to your counter).
BRIDGE_TOKEN = os.environ.get('BRIDGE_TOKEN', '').strip()

# A minimal ESC/POS test slip (init · centered text · feed · partial cut).
SELFTEST = (
    b'\x1b@'                      # ESC @  initialize
    b'\x1ba\x01'                  # ESC a 1  center
    b'\x1b!\x30'                  # ESC ! 0x30  double width+height
    b'Claus\n'
    b'\x1b!\x00'                  # ESC ! 0  normal
    b'print bridge OK\n'
    b'\x1bd\x04'                  # ESC d 4  feed 4 lines
    b'\x1dV\x42\x00'             # GS V 66 0  partial cut (feed+cut)
)


def transport():
    if PRINTER_HOST:
        return 'tcp', f'{PRINTER_HOST}:{PRINTER_PORT}'
    if PRINTER_CUPS:
        return 'cups', PRINTER_CUPS
    return 'none', ''


def send_to_printer(data):
    """Relay raw bytes to the printer. Raises on failure."""
    kind, target = transport()
    if kind == 'tcp':
        # A long receipt can take several seconds to drain into the printer's
        # buffer, so give the send room before timing out.
        with socket.create_connection((PRINTER_HOST, PRINTER_PORT), timeout=15) as s:
            s.sendall(data)
        return
    if kind == 'cups':
        # -o raw: pass ESC/POS straight through, no driver rasterization.
        p = subprocess.run(
            ['lp', '-d', PRINTER_CUPS, '-o', 'raw'],
            input=data, capture_output=True, timeout=20,
        )
        if p.returncode != 0:
            raise RuntimeError(f'lp failed: {p.stderr.decode("utf-8", "replace")[:200]}')
        return
    raise RuntimeError('no printer configured — set PRINTER_HOST or PRINTER_CUPS')


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # quiet

    # ---- CORS / Private Network Access -------------------------------------
    # Claus may be served from https (Vercel) or the local devserver; either way
    # a browser calling http://localhost needs permissive CORS, and Chrome's
    # Private Network Access sends a preflight we must green-light.
    def _cors(self):
        origin = self.headers.get('Origin', '*')
        self.send_header('Access-Control-Allow-Origin', origin)
        self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'content-type')
        self.send_header('Access-Control-Allow-Private-Network', 'true')

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _authed(self):
        if not BRIDGE_TOKEN:
            return True
        from urllib.parse import urlparse, parse_qs
        q = parse_qs(urlparse(self.path).query)
        return q.get('token', [''])[0] == BRIDGE_TOKEN

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        path = self.path.split('?')[0]
        kind, target = transport()
        if path == '/':
            msg = (f'Claus print bridge is running.\n'
                   f'Printer: {kind} -> {target or "NOT CONFIGURED"}\n'
                   f'POST /print  JSON {{"data": "<base64 ESC/POS>"}}\n')
            body = msg.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self._cors()
            self.end_headers()
            self.wfile.write(body)
            return
        if path != '/health':
            self._json({'ok': False, 'error': 'not_found'}, 404)
            return
        self._json({'ok': True, 'service': 'claus-printbridge', 'transport': kind,
                    'printer': target, 'configured': kind != 'none'})

    def do_POST(self):
        if self.path.split('?')[0] != '/print':
            self._json({'ok': False, 'error': 'not_found'}, 404)
            return
        if not self._authed():
            self._json({'ok': False, 'error': 'unauthorized'}, 401)
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            raw = self.rfile.read(length) if length else b''
            payload = json.loads(raw.decode('utf-8')) if raw else {}
            data = base64.b64decode(payload.get('data', ''), validate=False)
            if not data:
                self._json({'ok': False, 'error': 'empty'}, 400)
                return
            send_to_printer(data)
            self._json({'ok': True, 'bytes': len(data)})
        except Exception as e:  # noqa: BLE001 — report any failure back to the UI
            self._json({'ok': False, 'error': str(e)[:300]}, 502)


def main():
    if '--selftest' in sys.argv:
        kind, target = transport()
        if kind == 'none':
            print('No printer configured. Set PRINTER_HOST=<ip> or PRINTER_CUPS=<queue>.')
            sys.exit(1)
        print(f'Sending test slip via {kind} → {target} …')
        send_to_printer(SELFTEST)
        print('Sent. Check the printer.')
        return
    kind, target = transport()
    where = f'{kind} → {target}' if kind != 'none' else 'NOT CONFIGURED (set PRINTER_HOST or PRINTER_CUPS)'
    print(f'Claus print bridge on http://localhost:{BRIDGE_PORT}  ·  printer: {where}')
    server = ThreadingHTTPServer(('127.0.0.1', BRIDGE_PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
