// The 6 AM morning brief — Vercel crons (vercel.json) hit this at 03:00 AND
// 04:00 UTC daily, and each run only sends once the CURRENT stop's local clock
// has reached 6 AM: Helsinki/Tallinn mornings (UTC+3 in summer) go out on the
// early run, Copenhagen/Oslo/Stockholm (UTC+2) on the later one. A sent-marker
// in the shared trip state stops the second run from duplicating the first.
// During the trip it reads the shared plan from Supabase, finds today's stop
// and day, and pushes one concise notification (composed in api/_lib/brief.js)
// to every subscribed device.
//
// Outside the trip window it does nothing. `?test=1` previews against the
// trip's first planned day (and actually sends, skipping the gates), `&dry=1`
// composes without sending — handy for checking the pipeline before July.

const { SUPABASE_URL, SUPABASE_ANON_KEY, TRIP_ID, VAPID_PRIVATE_KEY } = require('./_lib/config.js');
const { sendPush } = require('./_lib/webpush.js');
const { fetchTrip, todayISO, stopTimeZone, localHour, findDayOnTrip, firstPlannedDay, composeBrief } = require('./_lib/brief.js');
const { loadTripState, saveTripState, isPushRow } = require('./_lib/state.js');
const { normHeadline } = require('./_lib/watch.js');
const { getPrefetchedBrief } = require('./_lib/prefetch.js');

const SB_HEADERS = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
};

module.exports = async (req, res) => {
  // Vercel cron sends Authorization: Bearer <CRON_SECRET> when configured;
  // enforce it if present so the endpoint can't be triggered by strangers.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && (req.headers.authorization || '') !== `Bearer ${cronSecret}`) {
    res.status(401).json({ status: 'error', message: 'unauthorized' });
    return;
  }
  const q = req.query || {};
  const test = q.test === '1';
  const dry = q.dry === '1';

  try {
    // 1. The shared trip.
    const trip = await fetchTrip();
    if (!trip) { res.status(200).json({ status: 'ok', sent: 0, note: 'no trip stored' }); return; }

    // 2. Today on the trip (or, in test mode, the first planned day).
    const ctx = findDayOnTrip(trip, todayISO()) || (test ? firstPlannedDay(trip) : null);
    if (!ctx) { res.status(200).json({ status: 'ok', sent: 0, note: 'not a trip day' }); return; }

    // 3. 6 AM where the travelers actually woke up: skip the early cron run
    //    while the stop's local clock is still short of 6, and skip the later
    //    run once today's brief has already gone out.
    const tz = stopTimeZone(ctx.stop);
    const state = await loadTripState();
    if (!test) {
      const hour = localHour(tz);
      if (hour < 6) { res.status(200).json({ status: 'ok', sent: 0, note: `before 6 AM in ${tz} (${hour}:00)` }); return; }
      if (state.lastBriefDate === todayISO()) { res.status(200).json({ status: 'ok', sent: 0, note: 'already sent today' }); return; }
    }

    // 4. Compose the brief (reuse 5:55 prefetch when available).
    const dateISO = todayISO();
    const cachedBrief = !test ? getPrefetchedBrief(state, dateISO) : null;
    const brief = cachedBrief || await composeBrief(ctx.stop, ctx.day);
    if (dry) { res.status(200).json({ status: 'ok', sent: 0, dry: true, brief, cached: !!cachedBrief }); return; }

    // Sending requires the VAPID signing secret (env-only — never committed).
    if (!VAPID_PRIVATE_KEY) {
      res.status(200).json({ status: 'error', sent: 0, brief, note: 'VAPID_PRIVATE_KEY env var not set — see README "Notifications"' });
      return;
    }

    // 5. Every subscribed device (skipping the internal state row).
    const subsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/push_subscriptions?trip_id=eq.${encodeURIComponent(TRIP_ID)}&select=endpoint,data`,
      { headers: SB_HEADERS },
    );
    const subs = (subsRes.ok ? await subsRes.json() : []).filter(isPushRow);
    if (!subs.length) { res.status(200).json({ status: 'ok', sent: 0, note: 'no subscribers', brief }); return; }

    // 6. Send, and prune subscriptions the push service reports as gone.
    let sent = 0;
    const gone = [];
    const results = [];
    for (const row of subs) {
      const result = await sendPush(row.data, brief);
      if (result.ok) sent += 1;
      else if (result.gone) gone.push(row.endpoint);
      // Per-device outcome, surfaced in test mode so a failing pipeline can be
      // diagnosed straight from the browser instead of digging through logs.
      results.push({
        endpoint: `…${String(row.endpoint).slice(-12)}`,
        ok: result.ok,
        ...(result.ok ? {} : { status: result.status, error: result.error || null }),
      });
    }
    for (const endpoint of gone) {
      await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
        method: 'DELETE', headers: SB_HEADERS,
      }).catch(() => {});
    }

    // 7. Mark today delivered, and count the brief's own news headline as
    //    already-alerted so the disruption watch won't re-push the same story.
    if (!test && sent > 0) {
      const watch = state.watch || {};
      if (brief.news) watch.alerted = { ...(watch.alerted || {}), [normHeadline(brief.news)]: Date.now() };
      await saveTripState({ ...state, lastBriefDate: todayISO(), watch });
    }

    res.status(200).json({ status: 'ok', sent, pruned: gone.length, brief, ...(test ? { results } : {}) });
  } catch (e) {
    console.error('Claus morning brief failed:', e);
    res.status(500).json({ status: 'error', message: String(e && e.message) });
  }
};
