// Batch-API prewarm for welcome-splash copy across the whole trip. Two steps:
//   GET /api/prewarm-briefs            → submit one batch for every upcoming day
//   GET /api/prewarm-briefs?collect=ID → poll; when the batch has ended, store
//                                        each day's summary in trip state
// welcome-brief.js then serves those cached summaries instantly. This is the
// latency-tolerant, 50%-cheaper path — run it ahead of the trip. The 5:55 AM
// prefetch stays synchronous for the same-day brief.
//
// Gated by CRON_SECRET when set (same as the other server jobs).

const {
  fetchTrip, todayISO, splashFactsForDay, upcomingDays,
} = require('./_lib/brief.js');
const { loadTripState, saveTripState } = require('./_lib/state.js');
const { submitSplashBatch, collectSplashBatch } = require('./_lib/batch-brief.js');

module.exports = async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && (req.headers.authorization || '') !== `Bearer ${cronSecret}`) {
    res.status(401).json({ status: 'error', message: 'unauthorized' });
    return;
  }

  const q = req.query || {};
  try {
    // Step 2: collect a finished batch into the multi-day splash cache.
    if (q.collect) {
      const collected = await collectSplashBatch(String(q.collect));
      if (!collected) { res.status(503).json({ status: 'error', message: 'not_configured' }); return; }
      if (!collected.done) {
        res.status(200).json({ status: 'ok', done: false, batch: collected.status, counts: collected.counts });
        return;
      }
      const state = await loadTripState();
      const splashCache = { ...(state.splashCache || {}), ...collected.results };
      await saveTripState({ ...state, splashCache });
      res.status(200).json({ status: 'ok', done: true, stored: Object.keys(collected.results).length });
      return;
    }

    // Step 1: submit one batch request per upcoming day.
    const trip = await fetchTrip();
    if (!trip) { res.status(200).json({ status: 'ok', submitted: false, note: 'no trip stored' }); return; }

    const days = upcomingDays(trip, todayISO(), 14);
    if (!days.length) { res.status(200).json({ status: 'ok', submitted: false, note: 'no upcoming days' }); return; }

    const items = [];
    for (const { stop, day } of days) {
      items.push({ customId: day.date, facts: await splashFactsForDay(stop, day) });
    }

    const batch = await submitSplashBatch(items);
    if (!batch) { res.status(503).json({ status: 'error', message: 'not_configured' }); return; }

    res.status(200).json({
      status: 'ok',
      submitted: true,
      batchId: batch.id,
      count: batch.count,
      note: `poll GET /api/prewarm-briefs?collect=${batch.id} in a few minutes`,
    });
  } catch (e) {
    console.error('Claus prewarm-briefs failed:', e);
    res.status(500).json({ status: 'error', message: String(e && e.message) });
  }
};
