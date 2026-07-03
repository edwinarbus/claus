#!/usr/bin/env python3
"""Tiny static server that disables caching, so module edits always reload.

DEV ONLY: it also *mocks* /api/concierge so the Overnight Concierge briefing and
the "Run briefing agent again" flow — including the managed agent's live steps —
can be seen locally, without the real Managed Agents backend (which only runs on
Vercel). Nothing here ships; production serves the real api/concierge.js.
"""
import sys
import json
import time
import urllib.parse
from datetime import date, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# Manual-run id -> start time, so poll() can stream steps that progress over time.
_RUNS = {}

# Demo: the seeded trip starts TOMORROW, so date the mock brief to day 1
# (Copenhagen) — keeping the receipt, its map, and the phrases all consistent.
_DAY1 = date.today() + timedelta(days=1)
_DAY1_HDR = f"### COPENHAGEN — {_DAY1.strftime('%a').upper()}, {_DAY1.strftime('%b').upper()} {_DAY1.day}\n"

_SUGGESTIONS = [
    {"title": "Swap tomorrow's morning bike ride for a gentle walk",
     "detail": "Keep the first day easy.", "date": "", "slotKey": "morning"},
    {"title": "Which Nyhavn dinner spot should we book?",
     "detail": "Tables are still open on night one.", "date": "", "slotKey": "dinner"},
    {"title": "Move Rosenborg earlier so we make the 3pm close",
     "detail": "It shuts early midweek.", "date": "", "slotKey": "afternoon"},
    {"title": "What's still unbooked across the whole trip?",
     "detail": "Three legs and six hotel nights are open.", "date": "", "slotKey": ""},
    {"title": "Recommend a day trip from Stockholm",
     "detail": "There's a free day mid-stay.", "date": "", "slotKey": ""},
    {"title": "Where should we splurge on one big dinner?",
     "detail": "One standout meal, trip-wide.", "date": "", "slotKey": "dinner"},
]

# Receipt-style day report (80mm thermal template — ~38 chars per line).
_BRIEF = _DAY1_HDR + (
    "Partly sunny · High 72°F · Rain clears by noon\n\n"
    "---\n\n"
    "### TODAY'S PLAN\n"
    "- **MORNING** Rosenborg Castle — closes 15:00, go first\n"
    "- **LUNCH** Schønnemann — smørrebrød, book ahead\n"
    "- **AFTERNOON** Nyhavn + canal tour, ~1h on the water\n"
    "- **EVENING** Noma — reservation held\n\n"
    "---\n\n"
    "### GETTING AROUND\n"
    "- Hotel → Rosenborg — **M3** to Nørreport + 6-min walk\n"
    "- Rosenborg → Nyhavn — 12-min walk, old town\n"
    "- Nyhavn → Noma — **Bus 9A**, ~18 min · last back 00:30\n"
    "- **24h City Pass** covers metro+bus+S-train\n\n"
    "---\n\n"
    "### HEADS UP\n"
    "- Rosenborg closes 15:00 midweek — do it first\n"
    "- No strikes or disruptions flagged today"
)

# The regenerated report (returned by a manual re-run) is deliberately DIFFERENT
# so you can see the card's text actually replace.
_BRIEF_REGEN = _DAY1_HDR + (
    "Re-checked: sunny all day · High 74°F\n\n"
    "---\n\n"
    "### TODAY'S PLAN\n"
    "- **MORNING** Rosenborg Castle — doors 10:00, beat the queue\n"
    "- **LUNCH** Torvehallerne — market lunch, quick\n"
    "- **AFTERNOON** Nyhavn + canal tour while the sun holds\n"
    "- **EVENING** Noma — reservation held\n\n"
    "---\n\n"
    "### GETTING AROUND\n"
    "- Hotel → Rosenborg — **M3** to Nørreport + 6-min walk\n"
    "- Torvehallerne → Nyhavn — **M1/M2**, 1 stop\n"
    "- Nyhavn → Noma — **Bus 9A**, ~18 min · last back 00:30\n\n"
    "---\n\n"
    "### HEADS UP\n"
    "- Rosenborg still closes 15:00 — moved you earlier\n"
    "- Harbour buses run normally today"
)


def _latest(brief=None):
    return {
        "date": _DAY1.isoformat(),
        "splash": "Sunny in Copenhagen, high of 72 — Rosenborg early, Noma tonight.",
        "brief": brief or _BRIEF,
        "suggestions": _SUGGESTIONS,
        "at": int(time.time() * 1000),
    }


def _poll(run_id):
    """Fake the managed agent's progress: steps + web searches accrue over ~11s."""
    start = _RUNS.setdefault(run_id, time.time())
    el = time.time() - start
    steps = ["Read your live itinerary"]
    searches = []
    if el > 1.5:
        steps.append("Checked what I remember about you two")
    if el > 3:
        searches.append({
            "id": "s1", "query": "Copenhagen weather July 13 2026 forecast",
            "status": "done" if el > 6 else "searching",
            "results": [
                {"url": "https://www.dmi.dk/", "title": "DMI — Danish Meteorological Institute", "age": ""},
                {"url": "https://www.visitcopenhagen.com/", "title": "VisitCopenhagen", "age": ""},
            ] if el > 6 else [],
        })
    if el > 6:
        searches.append({
            "id": "s2", "query": "Rosenborg Castle opening hours midweek",
            "status": "done" if el > 9 else "searching",
            "results": [
                {"url": "https://www.kongernessamling.dk/rosenborg/", "title": "Rosenborg — hours & tickets", "age": ""},
            ] if el > 9 else [],
        })
    if el > 9:
        steps.append("Cross-checked closures and events for tomorrow")
    if el > 11:
        steps.append("Wrote tomorrow's brief")
        return {"status": "done", "reasoning": "\n".join(steps), "searches": searches, "latest": _latest(_BRIEF_REGEN)}
    return {"status": "running", "reasoning": "\n".join(steps), "searches": searches}


class DevHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, *args):
        pass  # quiet

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # Returns True if it handled a /api/concierge request.
    def _mock_concierge(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != '/api/concierge':
            return False
        qs = urllib.parse.parse_qs(parsed.query)
        if self.command == 'POST':
            if qs.get('run') == ['1']:
                run_id = 'dev-run-%d' % int(time.time() * 1000)
                _RUNS[run_id] = time.time()
                self._json({"status": "ok", "runId": run_id, "sessionId": "dev-session"})
            else:
                self._json({"status": "ok", "ignored": True})
            return True
        if 'poll' in qs:
            self._json(_poll(qs['poll'][0]))
        else:
            self._json({"latest": _latest()})
        return True

    def do_GET(self):
        if self._mock_concierge():
            return
        super().do_GET()

    def do_POST(self):
        if self._mock_concierge():
            return
        self._json({"error": "not_found"}, 404)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
    ThreadingHTTPServer(('127.0.0.1', port), DevHandler).serve_forever()
