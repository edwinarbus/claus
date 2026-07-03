// React hook wrapping the weather service for a stop's date range.
import { useState, useEffect } from '../html.js';
import { getRangeWeather, summarizeWeather } from '../data/weather.js';
import { eachDate, addDays, nightsBetween } from '../lib/dates.js';

// Dates a stop actually covers (its nights).
function stopDates(stop) {
  const nights = nightsBetween(stop.startDate, stop.endDate);
  if (nights <= 0) return [stop.startDate];
  return eachDate(stop.startDate, addDays(stop.endDate, -1));
}

export function useStopWeather(stop) {
  const [state, setState] = useState({ loading: true, byDate: {}, summary: null });
  const dates = stopDates(stop);
  const key = `${stop.lat},${stop.lng}|${dates.join(',')}`;

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    getRangeWeather(stop.lat, stop.lng, dates)
      .then((byDate) => {
        if (!alive) return;
        setState({ loading: false, byDate, summary: summarizeWeather(byDate) });
      })
      .catch(() => alive && setState({ loading: false, byDate: {}, summary: null }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
