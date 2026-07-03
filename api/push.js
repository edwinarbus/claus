// Push subscription registry. Devices POST here after the user enables the
// morning brief; the daily cron (api/morning-brief.js) reads the list back.
// Subscriptions live in a small Supabase table next to the trip (SQL in the
// README under "Notifications"), accessed over REST with the same
// anon key + RLS setup as the trip itself.

const { SUPABASE_URL, SUPABASE_ANON_KEY, TRIP_ID, VAPID_PRIVATE_KEY } = require('./_lib/config.js');
const { sendPush } = require('./_lib/webpush.js');
const { fetchTrip, todayISO, findDayOnTrip, firstPlannedDay, composeBrief } = require('./_lib/brief.js');
const { isPushRow } = require('./_lib/state.js');

const TABLE_URL = `${SUPABASE_URL}/rest/v1/push_subscriptions`;
const HEADERS = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
};

function readBody(req) {
  // Vercel parses JSON bodies for us, but be tolerant of raw strings.
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

// A real push to the device that just enabled notifications, so the user sees
// the morning brief on their lock screen right away — and the whole pipeline
// (VAPID, encryption, APNs) is proven end-to-end at enable time. Composes
// today's brief when on the trip, otherwise a preview of the trip's first day.
async function sendExampleBrief(subscription) {
  if (!VAPID_PRIVATE_KEY) return 'skipped (no VAPID_PRIVATE_KEY)';
  try {
    const trip = await fetchTrip();
    const onTrip = trip && findDayOnTrip(trip, todayISO());
    const ctx = onTrip || (trip && firstPlannedDay(trip));
    let brief;
    if (ctx) {
      brief = await composeBrief(ctx.stop, ctx.day);
      // Off-trip it's a sample of a future morning — label it so a July
      // headline arriving in June isn't confusing. On a trip day it IS today's
      // brief; send it as-is.
      if (!onTrip) brief = { ...brief, title: `Preview: ${brief.title}` };
    } else {
      brief = { title: 'Notifications enabled', body: 'Plan alerts are on — see you at 6 AM on day one.', url: './' };
    }
    const r = await sendPush(subscription, { ...brief, tag: 'scandiplan-example' });
    if (r.ok) return 'sent';
    // Surface the real failure (crypto/config errors carry an explanatory
    // message; push-service rejections carry an HTTP status) so the client can
    // show something actionable instead of a bare number.
    return `failed (${r.error || `push service answered ${r.status}`})`;
  } catch (e) {
    return `failed (${String(e && e.message).slice(0, 160)})`;
  }
}

function normWho(who) {
  return String(who || '').trim().toLowerCase();
}

async function sendPlanChange({ editor = '', summary = '', senderEndpoint = '' }) {
  if (!VAPID_PRIVATE_KEY) return { status: 'error', message: 'VAPID_PRIVATE_KEY env var not set', sent: 0 };
  const text = String(summary || '').replace(/\s+/g, ' ').trim().slice(0, 220);
  if (!text) return { status: 'error', message: 'summary required', sent: 0 };

  const editorName = String(editor || '').trim().slice(0, 40);
  const editorKey = normWho(editorName);
  if (!editorKey) return { status: 'ok', sent: 0, note: 'unknown editor — skipped' };
  const subsRes = await fetch(
    `${TABLE_URL}?trip_id=eq.${encodeURIComponent(TRIP_ID)}&select=endpoint,data,who`,
    { headers: HEADERS },
  );
  const subs = subsRes.ok ? await subsRes.json() : [];
  // Only the OTHER traveler's devices: drop everything registered under the
  // editor's name AND the exact device the edit came from (covers stale/empty
  // `who` registrations), plus the internal state row / malformed entries.
  const recipients = subs.filter((row) => isPushRow(row)
    && (!editorKey || normWho(row.who) !== editorKey)
    && (!senderEndpoint || row.endpoint !== senderEndpoint));
  if (!recipients.length) return { status: 'ok', sent: 0, note: 'no other subscribers' };

  let sent = 0;
  const gone = [];
  for (const row of recipients) {
    const result = await sendPush(row.data, {
      title: editorName ? `${editorName} updated the plan` : 'Plan updated',
      body: text,
      editor: editorName,
      tag: 'scandiplan-plan-change',
      renotify: true,
      url: './',
    }, { ttl: 60 * 60 });
    if (result.ok) sent += 1;
    else if (result.gone) gone.push(row.endpoint);
  }
  for (const endpoint of gone) {
    await fetch(`${TABLE_URL}?endpoint=eq.${encodeURIComponent(endpoint)}`, {
      method: 'DELETE', headers: HEADERS,
    }).catch(() => {});
  }
  return { status: 'ok', sent, pruned: gone.length };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ status: 'error', message: 'POST only' });
    return;
  }
  const body = readBody(req);
  const action = body.action || 'subscribe';

  try {
    if (action === 'unsubscribe') {
      const endpoint = String(body.endpoint || '');
      if (!endpoint) { res.status(400).json({ status: 'error', message: 'endpoint required' }); return; }
      await fetch(`${TABLE_URL}?endpoint=eq.${encodeURIComponent(endpoint)}`, {
        method: 'DELETE', headers: HEADERS,
      });
      res.status(200).json({ status: 'ok' });
      return;
    }

    if (action === 'plan-change') {
      const result = await sendPlanChange({
        editor: body.editor,
        summary: body.summary,
        senderEndpoint: String(body.senderEndpoint || ''),
      });
      res.status(200).json(result);
      return;
    }

    const sub = body.subscription || {};
    if (!sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      res.status(400).json({ status: 'error', message: 'invalid subscription' });
      return;
    }
    const row = {
      endpoint: sub.endpoint,
      trip_id: TRIP_ID,
      data: sub,
      who: String(body.who || '').slice(0, 40),
      updated_at: new Date().toISOString(),
    };
    const r = await fetch(`${TABLE_URL}?on_conflict=endpoint`, {
      method: 'POST',
      headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      // The most common failure is the table not existing yet — say so plainly.
      const message = r.status === 404
        ? 'push_subscriptions table missing — run the README "Notifications" SQL in Supabase.'
        : `could not store subscription (${r.status})`;
      console.warn('Claus push subscribe failed:', r.status, detail.slice(0, 300));
      res.status(200).json({ status: 'error', message });
      return;
    }
    if (body.preview === false) {
      res.status(200).json({ status: 'ok', example: 'skipped' });
      return;
    }
    const example = await sendExampleBrief(sub);
    res.status(200).json({ status: 'ok', example });
  } catch (e) {
    res.status(200).json({ status: 'error', message: 'subscription storage unreachable' });
  }
};
