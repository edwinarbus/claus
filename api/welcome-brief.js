// Claude-written welcome splash copy for the in-app briefing modal.
// GET ?date=YYYY-MM-DD — looks up that day on the shared trip in Supabase.

const { fetchTrip, findDayOnTrip, composeSplash, todayISO, isTimeFilteredSplashHour } = require('./_lib/brief.js');
const { loadTripState } = require('./_lib/state.js');
const { getPrefetchedSplash } = require('./_lib/prefetch.js');

function parseHour(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n < 24 ? Math.floor(n) : null;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ status: 'error', message: 'method_not_allowed' });
    return;
  }

  const dateISO = String((req.query && req.query.date) || '').slice(0, 10);
  const hour = parseHour(req.query && req.query.hour);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) {
    res.status(400).json({ status: 'error', message: 'invalid_date' });
    return;
  }

  try {
    const trip = await fetchTrip();
    const ctx = trip && findDayOnTrip(trip, dateISO);
    if (!ctx) {
      res.status(404).json({ status: 'error', message: 'day_not_found' });
      return;
    }

    const state = await loadTripState();

    // Prefer the Overnight Concierge's own one-line splash for the day it
    // prepared — no need to re-generate one when the managed agent already wrote
    // the brief. (source 'anthropic' so the splash UI renders it as-is.)
    const concierge = state.concierge && state.concierge.latest;
    if (!isTimeFilteredSplashHour(hour) && concierge && concierge.date === dateISO && concierge.splash) {
      const onTripDay = dateISO === todayISO();
      res.setHeader('Cache-Control', onTripDay
        ? 's-maxage=300, stale-while-revalidate=600'
        : 's-maxage=1800, stale-while-revalidate=3600');
      res.status(200).json({ status: 'ok', date: dateISO, summary: concierge.splash, source: 'anthropic', cached: true });
      return;
    }

    // Prefer the same-day 5:55 prefetch; otherwise fall back to the Batch
    // prewarm's multi-day cache (api/prewarm-briefs.js).
    const cached = isTimeFilteredSplashHour(hour)
      ? null
      : (getPrefetchedSplash(state, dateISO) || (state.splashCache && state.splashCache[dateISO]) || null);
    if (cached?.source === 'anthropic' && cached.summary) {
      const onTripDay = dateISO === todayISO();
      res.setHeader('Cache-Control', onTripDay
        ? 's-maxage=300, stale-while-revalidate=600'
        : 's-maxage=1800, stale-while-revalidate=3600');
      res.status(200).json({ status: 'ok', date: dateISO, ...cached, cached: true });
      return;
    }

    const splash = await composeSplash(ctx.stop, ctx.day, { hour });
    // Shorter CDN cache on the actual trip day so splash copy tracks live forecast.
    const onTripDay = dateISO === todayISO();
    res.setHeader('Cache-Control', onTripDay
      ? 's-maxage=300, stale-while-revalidate=600'
      : 's-maxage=1800, stale-while-revalidate=3600');
    res.status(200).json({ status: 'ok', date: dateISO, ...splash });
  } catch (e) {
    console.error('Claus welcome brief failed:', e);
    res.status(500).json({ status: 'error', message: String(e && e.message) });
  }
};
