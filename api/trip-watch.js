// Continuous trip-disruption watch. Checks GDELT for NEW disruptions hitting
// TODAY's city or its planned sights, and pushes to every subscribed device
// ONLY when something new and relevant turns up — silence means all clear.
//
// There is no frequent server scheduler on the Hobby plan (crons are once
// daily), so this endpoint is designed to be pinged opportunistically — every
// app open / return-to-foreground during the trip (src/lib/push.js) — and it
// throttles ITSELF: real checks run at most every WATCH_GAP_MS no matter how
// often it's hit, dedupe state lives in the shared trip-state row, and pushes
// only go out during waking hours at the stop's local time. `?test=1` skips
// the throttle/quiet-hour gates; `&dry=1` reports what it would send.

const { VAPID_PRIVATE_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, TRIP_ID } = require('./_lib/config.js');
const { sendPush } = require('./_lib/webpush.js');
const { fetchTrip, todayISO, stopTimeZone, localHour, findDayOnTrip, plannedSights } = require('./_lib/brief.js');
const { fetchGdeltArticles } = require('./_lib/gdelt.js');
const { loadTripState, saveTripState, isPushRow } = require('./_lib/state.js');
const { normHeadline, freshDisruptions, pruneAlerted } = require('./_lib/watch.js');
const { classifyDisruptions } = require('./_lib/classify-alerts.js');

const WATCH_GAP_MS = 3 * 60 * 60 * 1000; // real checks at most every 3 hours
const SB_HEADERS = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
};

module.exports = async (req, res) => {
  const q = req.query || {};
  const test = q.test === '1';
  const dry = q.dry === '1';

  try {
    // 1. Only meaningful on a trip day.
    const trip = await fetchTrip();
    const ctx = trip && findDayOnTrip(trip, todayISO());
    if (!ctx) { res.status(200).json({ status: 'ok', sent: 0, note: 'not a trip day' }); return; }

    // 2. Quiet hours: never buzz a sleeping traveler — disruption pushes only
    //    between 07:00 and 22:00 at the current stop's local time.
    const hour = localHour(stopTimeZone(ctx.stop));
    if (!test && (hour < 7 || hour >= 22)) {
      res.status(200).json({ status: 'ok', sent: 0, note: `quiet hours (${hour}:00 local)` });
      return;
    }

    // 3. Self-throttle: pings are free, checks are not.
    const state = await loadTripState();
    const watch = state.watch || {};
    if (!test && Date.now() - (watch.lastRunAt || 0) < WATCH_GAP_MS) {
      res.status(200).json({ status: 'ok', sent: 0, note: 'checked recently' });
      return;
    }

    // 4. The check itself — today's city + today's planned sights. When a
    //    Claude key is set, a relevance classifier picks and rewrites the
    //    disruptions (higher recall, fewer false positives); otherwise the
    //    keyword filter in watch.js runs. Each pick keeps its original headline
    //    as the dedupe key so re-runs don't re-alert the same story.
    const sights = plannedSights(ctx.day);
    const { ok, articles } = await fetchGdeltArticles(ctx.stop.name, sights);
    const alerted = pruneAlerted(watch.alerted);

    const freshItems = [];
    if (ok && articles.length) {
      const smart = await classifyDisruptions(ctx.stop.name, sights, articles).catch(() => null);
      const candidates = Array.isArray(smart)
        ? smart.map((p) => ({ key: normHeadline(p.title), body: p.summary || p.title }))
        : freshDisruptions(articles, ctx.stop.name, sights, alerted).map((t) => ({ key: normHeadline(t), body: t }));
      const seen = new Set();
      for (const item of candidates) {
        if (!item.body || !item.key || alerted[item.key] || seen.has(item.key)) continue;
        seen.add(item.key);
        freshItems.push(item);
        if (freshItems.length >= 3) break;
      }
    }
    const fresh = freshItems.map((f) => f.body);

    // Even a throttled/failed GDELT answer advances lastRunAt — 3h backoff
    // beats hammering a rate-limited API on every app open.
    const nextWatch = { ...watch, lastRunAt: Date.now(), alerted };

    if (!fresh.length) {
      await saveTripState({ ...state, watch: nextWatch });
      res.status(200).json({ status: 'ok', sent: 0, note: ok ? 'no new disruptions' : 'news source unavailable', sights });
      return;
    }

    const notification = {
      title: `⚠️ ${ctx.stop.name} heads-up`,
      body: fresh.length === 1 ? fresh[0] : fresh.map((t) => `• ${t}`).join('\n'),
      tag: 'scandiplan-alert',
      renotify: true,
      url: './',
    };
    if (dry) {
      res.status(200).json({ status: 'ok', sent: 0, dry: true, notification, sights });
      return;
    }
    if (!VAPID_PRIVATE_KEY) {
      res.status(200).json({ status: 'error', sent: 0, note: 'VAPID_PRIVATE_KEY env var not set', notification });
      return;
    }

    // 5. Both travelers want to know — send to every device, prune dead ones.
    const subsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/push_subscriptions?trip_id=eq.${encodeURIComponent(TRIP_ID)}&select=endpoint,data`,
      { headers: SB_HEADERS },
    );
    const subs = (subsRes.ok ? await subsRes.json() : []).filter(isPushRow);
    let sent = 0;
    const gone = [];
    for (const row of subs) {
      const result = await sendPush(row.data, notification, { ttl: 6 * 60 * 60 });
      if (result.ok) sent += 1;
      else if (result.gone) gone.push(row.endpoint);
    }
    for (const endpoint of gone) {
      await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
        method: 'DELETE', headers: SB_HEADERS,
      }).catch(() => {});
    }

    // Only after a delivery attempt do the headlines count as alerted (keyed on
    // the original headline, not the rewritten display line).
    for (const item of freshItems) nextWatch.alerted[item.key] = Date.now();
    await saveTripState({ ...state, watch: nextWatch });

    res.status(200).json({ status: 'ok', sent, pruned: gone.length, notification });
  } catch (e) {
    console.error('Claus trip watch failed:', e);
    res.status(500).json({ status: 'error', message: String(e && e.message) });
  }
};
