// Claude.ai-style "activity" UI for an assistant turn: a compact, collapsible
// section that shows the model's thinking and any web searches WITHOUT dumping
// the full reasoning into the transcript. Thinking and each search are their own
// collapsed-by-default accordion; the whole section auto-collapses once the final
// answer starts streaming (and stays re-expandable afterward).
import { html, useState, useEffect, useRef } from '../html.js';
import { IconGlobe, IconCheck, IconChevronDown, IconLightbulb, IconWarning } from './icons.js';
import { BlockSpinner } from './BlockSpinner.js';

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./i, ''); } catch { return ''; }
}

// The single line shown as the thinking header: the model's *latest* thought.
// Summarized thinking arrives as a few short paragraphs; we surface the tail so
// the header tracks the live cursor without unspooling the whole thing.
function latestThought(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  // Prefer the last line when the text is line-separated (e.g. agent steps);
  // otherwise fall back to the last sentence of a prose paragraph.
  const lines = raw.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const last = lines[lines.length - 1] || raw;
  const sentences = last.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).filter(Boolean);
  return (sentences[sentences.length - 1] || last).trim();
}

// The full thought list for the expanded panel: every distinct reasoning step.
// Split on blank lines (separate thinking blocks) AND sentence boundaries, so a
// summary that arrives as one dense paragraph still reads as its individual
// steps. The sentence split only fires before a capital/quote/digit so it won't
// break on "e.g." or "~1h." mid-sentence.
function splitThoughts(text) {
  return String(text || '')
    .split(/\n+/)
    .flatMap((para) => para.split(/(?<=[.!?])\s+(?=[A-Z0-9"“'‘])/))
    .map((s) => s.trim())
    .filter(Boolean);
}

// Reveals `target` a few characters at a time so the thinking header (the cycling
// "Tænker…/Mõtleb…" placeholder and the live latest-thought) types itself out. A
// target that isn't a continuation of what's shown (a new word/thought) restarts
// the reveal. When disabled (a settled, persisted message) the full text shows at
// once — no animation on re-render.
function useTypewriter(target, enabled = true) {
  const goal = String(target || '');
  // Start empty when enabled so the first word/thought types in from scratch;
  // start complete when disabled (settled message) so it never animates.
  const [shown, setShown] = useState(enabled ? '' : goal);
  const shownRef = useRef(enabled ? '' : goal);
  const timerRef = useRef(0);
  useEffect(() => {
    const stop = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = 0; } };
    if (!enabled) { stop(); shownRef.current = goal; setShown(goal); return undefined; }
    if (!goal.startsWith(shownRef.current)) { shownRef.current = ''; setShown(''); }
    if (shownRef.current.length >= goal.length) { stop(); return undefined; }
    stop();
    timerRef.current = setInterval(() => {
      const g = String(target || '');
      let cur = shownRef.current;
      if (!g.startsWith(cur)) cur = '';
      if (cur.length >= g.length) { shownRef.current = g; setShown(g); stop(); return; }
      const step = Math.max(1, Math.ceil((g.length - cur.length) / 8));
      shownRef.current = g.slice(0, cur.length + step);
      setShown(shownRef.current);
    }, 34);
    return stop;
  }, [goal, enabled]);
  return enabled ? shown : goal;
}

function Chevron({ open }) {
  return html`<${IconChevronDown} className=${`tc-act-chev w-3.5 h-3.5 shrink-0 ${open ? 'is-open' : ''}`} />`;
}

// A source row's favicon. Uses Google's keyless favicon service (no token, matches
// the app's no-key ethos) with a globe fallback if it fails to load.
function SourceFavicon({ url }) {
  const [failed, setFailed] = useState(false);
  const d = domainOf(url);
  if (!d || failed) {
    return html`<span class="tc-src-ico tc-src-ico--fallback" aria-hidden="true"><${IconGlobe} className="w-3 h-3" /></span>`;
  }
  return html`<img class="tc-src-ico" alt="" loading="lazy" width="16" height="16"
    src=${`https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64`}
    onError=${() => setFailed(true)} />`;
}


function WebSearchBlock({ query, results, status }) {
  const [open, setOpen] = useState(false);
  const list = Array.isArray(results) ? results : [];
  const count = list.length;
  const canOpen = count > 0;
  return html`<div class="tc-act-item">
    <button type="button" class="tc-act-row" aria-expanded=${open}
      onClick=${() => canOpen && setOpen((o) => !o)}>
      <span class="tc-act-ico" aria-hidden="true"><${IconGlobe} className="w-3.5 h-3.5" /></span>
      <span class="tc-act-label">Searched the web</span>
      <span class="tc-act-state" aria-hidden="true">
        ${status === 'searching' ? html`<${BlockSpinner} size="sm" />`
          : status === 'error' ? html`<${IconWarning} className="w-3.5 h-3.5 tc-act-warn" />`
          : html`<span class="tc-act-check"><${IconCheck} className="w-3 h-3" /></span>`}
      </span>
      ${canOpen ? html`<${Chevron} open=${open} />` : null}
    </button>
    ${(query || count) ? html`
      <div class="tc-act-sub">
        ${query ? html`<span class="tc-act-query">${query}</span>` : null}
        ${count ? html`<span class="tc-act-count">${count} source${count === 1 ? '' : 's'}</span>` : null}
      </div>` : null}
    <div class=${`tc-act-panel ${open ? 'is-open' : ''}`}>
      <div class="tc-act-panel-clip">
        <div class="tc-src-list">
          ${list.map((r, i) => html`
            <a key=${i} class="tc-src" href=${r.url} target="_blank" rel="noopener noreferrer">
              <${SourceFavicon} url=${r.url} />
              <span class="tc-src-title">${r.title || domainOf(r.url)}</span>
              <span class="tc-src-domain">${domainOf(r.url)}</span>
            </a>`)}
        </div>
      </div>
    </div>
  </div>`;
}

// reasoning: full thinking text (string). searches: [{ id, query, results, status }].
// One collapsible: a dynamic header (the model's own latest thought, typed while
// live — never a static "Thought it through"), expanding to every reasoning step
// plus each web-search block. placeholder is the multilingual warm-up word.
export function ActivitySection({ reasoning, searches, streaming = false, answerStarted = false, placeholder }) {
  const list = Array.isArray(searches) ? searches : [];
  const inProgress = streaming && !answerStarted;
  const hasContent = !!reasoning || inProgress || list.length > 0;
  const [open, setOpen] = useState(false);

  const steps = splitThoughts(reasoning);
  const activeSearch = list.some((s) => s.status === 'searching');
  // Header = the reasoning's latest thought (dynamic, task-specific). Falls back
  // to the live search/thinking state, then a quiet recap when there's no thought.
  const head = reasoning
    ? latestThought(reasoning)
    : inProgress
      ? (activeSearch ? 'Searching the web…' : (placeholder || 'Thinking…'))
      : (list.length ? 'Searched the web' : 'Thought it through');
  const typedHead = useTypewriter(head, inProgress);
  const typing = inProgress && typedHead.length < head.length;
  const canOpen = steps.length > 0 || list.length > 0;
  const HeadIcon = (reasoning || inProgress) ? IconLightbulb : IconGlobe;

  if (!hasContent) return null;

  return html`<div class=${`tc-activity flex justify-start pr-4 ${inProgress ? 'is-live' : ''}`} aria-live="polite">
    <div class="tc-activity-card">
      <button type="button" class="tc-act-row tc-act-head" aria-expanded=${open}
        onClick=${() => canOpen && setOpen((o) => !o)}>
        <span class="tc-act-ico" aria-hidden="true">
          ${inProgress ? html`<${BlockSpinner} size="sm" />` : html`<${HeadIcon} className="w-3.5 h-3.5" />`}
        </span>
        <span class="tc-act-label">${typedHead}${typing ? html`<span class="tc-tw-caret" aria-hidden="true"></span>` : ''}</span>
        ${canOpen ? html`<${Chevron} open=${open} />` : null}
      </button>
      <div class=${`tc-act-panel ${open ? 'is-open' : ''}`}>
        <div class="tc-act-panel-clip">
          <div class="tc-act-stack">
            ${steps.length ? html`<div class="tc-think-steps">
              ${steps.map((s, i) => html`<p key=${i} class="tc-think-step">${s}</p>`)}
            </div>` : null}
            ${list.map((s) => html`<${WebSearchBlock} key=${s.id} query=${s.query} results=${s.results} status=${s.status} />`)}
          </div>
        </div>
      </div>
    </div>
  </div>`;
}
