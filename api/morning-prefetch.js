// Warm cache at 5:55 AM Norway time — GPT welcome splash, push brief, and GDELT
// for today's stop. Vercel crons hit this at 03:55 and 04:55 UTC; only the run
// that lands in the Oslo 5:55 window does work (covers CET/CEST).
//
// `?test=1` skips time/date gates (uses first planned day off-trip).
// `?dry=1` composes without saving to trip state.

const { fetchTrip, todayISO, findDayOnTrip, firstPlannedDay } = require('./_lib/brief.js');
const { loadTripState, saveTripState } = require('./_lib/state.js');
const { isNorwayPrefetchWindow, runMorningPrefetch } = require('./_lib/prefetch.js');

module.exports = async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && (req.headers.authorization || '') !== `Bearer ${cronSecret}`) {
    res.status(401).json({ status: 'error', message: 'unauthorized' });
    return;
  }

  const q = req.query || {};
  const test = q.test === '1';
  const dry = q.dry === '1';

  try {
    const trip = await fetchTrip();
    if (!trip) { res.status(200).json({ status: 'ok', prefetched: false, note: 'no trip stored' }); return; }

    const dateISO = todayISO();
    const ctx = findDayOnTrip(trip, dateISO) || (test ? firstPlannedDay(trip) : null);
    if (!ctx) { res.status(200).json({ status: 'ok', prefetched: false, note: 'not a trip day' }); return; }

    if (!test && !isNorwayPrefetchWindow()) {
      const note = 'outside 5:55 AM Europe/Oslo window';
      res.status(200).json({ status: 'ok', prefetched: false, note });
      return;
    }

    const state = await loadTripState();
    if (!test && state.prefetch?.date === dateISO) {
      res.status(200).json({ status: 'ok', prefetched: false, note: 'already prefetched today', prefetch: state.prefetch });
      return;
    }

    const prefetch = await runMorningPrefetch(ctx.stop, ctx.day);
    if (!dry) {
      await saveTripState({ ...state, prefetch });
    }

    res.status(200).json({
      status: 'ok',
      prefetched: true,
      dry,
      date: dateISO,
      splashSource: prefetch.splash?.source,
      gdeltOk: prefetch.gdelt?.ok,
      articles: prefetch.gdelt?.articles?.length ?? 0,
      ...(test || dry ? { prefetch } : {}),
    });
  } catch (e) {
    console.error('Claus morning prefetch failed:', e);
    res.status(500).json({ status: 'error', message: String(e && e.message) });
  }
};
