// Fetch a thumbnail for a Wikipedia article title via the public REST summary
// API (CORS-enabled). Results are cached in-memory + localStorage so we only hit
// the network once per article. Returns a URL string, or '' while loading/none.
import { useState, useEffect } from '../html.js';

const CACHE_KEY = 'scandiplan:wikiimg:v3';
const SUCCESS_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const FAILURE_TTL_MS = 1000 * 60 * 5; // 5 min — don't freeze the UI on a bad burst
const MAX_CONCURRENT = 2;
const MAX_RETRIES = 4;
const QUEUE_GAP_MS = 120;

let mem = null;
function load() {
  if (mem) return mem;
  try { mem = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); }
  catch { mem = {}; }
  return mem;
}
function persist() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(mem || {})); } catch { /* ignore */ }
}

function cacheTtl(entry) {
  if (!entry) return 0;
  return entry.url ? SUCCESS_TTL_MS : FAILURE_TTL_MS;
}

const queue = [];
let active = 0;
let queueTail = Promise.resolve();

function drainQueue() {
  while (active < MAX_CONCURRENT && queue.length) {
    const job = queue.shift();
    active += 1;
    queueTail = queueTail
      .then(() => sleep(QUEUE_GAP_MS))
      .then(() => job.fn())
      .then(job.resolve, job.reject)
      .finally(() => { active -= 1; drainQueue(); });
  }
}

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    drainQueue();
  });
}

function sleep(ms) {
  return new Promise((r) => { setTimeout(r, ms); });
}

async function fetchJson(url) {
  let lastStatus = 0;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    lastStatus = res.status;
    if (res.status === 429) {
      await sleep((attempt + 1) * 2000 + Math.random() * 800);
      continue;
    }
    return res;
  }
  throw new Error(`wiki ${lastStatus || 429}`);
}

async function searchWikiTitle(query) {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: '3',
    format: 'json',
    origin: '*',
  });
  const res = await fetchJson(`https://en.wikipedia.org/w/api.php?${params}`);
  if (!res.ok) return null;
  const json = await res.json();
  const hits = json.query && json.query.search;
  if (!hits || !hits.length) return null;
  return hits[0].title;
}

function thumbFromSummary(json) {
  return (json.thumbnail && json.thumbnail.source)
    || (json.originalimage && json.originalimage.source)
    || '';
}

async function summaryThumb(title) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}?redirect=true`;
  const res = await fetchJson(url);
  if (res.status === 404) return { status: 404, url: '' };
  if (!res.ok) throw new Error(`wiki ${res.status}`);
  const json = await res.json();
  return { status: 200, url: thumbFromSummary(json) };
}

async function fetchThumb(title) {
  let result = await summaryThumb(title);
  if (result.status === 404) {
    const alt = await searchWikiTitle(title);
    if (alt && alt !== title) result = await summaryThumb(alt);
  }
  if (result.status === 404) return '';
  if (result.status !== 200) throw new Error(`wiki ${result.status}`);
  return result.url || '';
}

const inflight = new Map();

function resolveThumb(title) {
  if (inflight.has(title)) return inflight.get(title);
  const p = enqueue(() => fetchThumb(title)).finally(() => { inflight.delete(title); });
  inflight.set(title, p);
  return p;
}

function cachedEntry(title) {
  const hit = load()[title];
  if (!hit) return null;
  if (Date.now() - hit.t >= cacheTtl(hit)) return null;
  return hit; // { url, t } — url may be '' for a cached "no image" result
}

function cachedUrl(title) {
  const hit = cachedEntry(title);
  return hit ? (hit.url || null) : null;
}

// Returns { url, loading } for an item's thumbnail.
//   url     — the resolved image URL, or '' (loading or genuinely none).
//   loading — true only while a lookup is in flight, so callers can show a
//             skeleton shimmer instead of a glyph until we KNOW there's no image.
// Prefers an explicit item.imageUrl, then resolves item.wiki.
// Pass enabled=false until the card is near the viewport to avoid Wikipedia 429s.
export function useWikiImage(item, enabled = true) {
  const explicit = item && item.imageUrl;
  const title = item && item.wiki;
  const [url, setUrl] = useState(() => {
    if (explicit) return explicit;
    if (!title || !enabled) return '';
    const hit = cachedEntry(title);
    return hit ? (hit.url || '') : '';
  });
  // Loading only when there's a title to resolve and nothing cached yet — an
  // explicit/cached/absent image all resolve synchronously (never "loading").
  const [loading, setLoading] = useState(() =>
    !explicit && !!title && enabled && cachedEntry(title) === null);

  useEffect(() => {
    if (explicit) { setUrl(explicit); setLoading(false); return undefined; }
    if (!title || !enabled) { setUrl(''); setLoading(false); return undefined; }

    const hit = cachedEntry(title);
    if (hit) { setUrl(hit.url || ''); setLoading(false); return undefined; }

    let alive = true;
    setUrl('');
    setLoading(true);
    resolveThumb(title)
      .then((u) => {
        const cache = load();
        cache[title] = { url: u, t: Date.now() };
        persist();
        if (alive) { setUrl(u || ''); setLoading(false); }
      })
      .catch(() => {
        // Don't cache failures aggressively — allow retry on next mount/scroll.
        if (alive) { setUrl(''); setLoading(false); }
      });
    return () => { alive = false; };
  }, [explicit, title, enabled]);

  return { url, loading };
}
