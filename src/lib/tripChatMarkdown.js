import { html } from '../html.js';

const HEADING_TAG = ['', 'h3', 'h4', 'h5', 'h6', 'h6', 'h6'];
const HEADING_CLS = [
  '',
  'trip-chat-md-h1',
  'trip-chat-md-h2',
  'trip-chat-md-h3',
  'trip-chat-md-h4',
  'trip-chat-md-h5',
  'trip-chat-md-h6',
];

function normalizeBareUrl(url) {
  const raw = String(url || '').trim().replace(/[.,;:!?)]+$/, '');
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^[\w.-]+\.[a-z]{2,}/i.test(raw)) return `https://${raw}`;
  return '';
}

// Legacy OpenAI citation tokens (PUA chars that render as boxed glyphs) — kept
// so any chat history still cached in localStorage from before the Claude
// migration renders cleanly. Claude's citations arrive as a Sources list.
const CITATION_MARKER_RE = /\uE200(?:file)?cite(?:\uE202turn\d+(?:search|file)\d+)+\uE201/g;
const CITATION_MARKER_LOOSE_RE = /(?:\uE200)?(?:file)?cite(?:\uE202)?turn\d+(?:search|file)\d+(?:\uE202turn\d+(?:search|file)\d+)*(?:\uE201)?/g;

// Repair mangled citation markdown from older server passes or model output.
function repairCitationArtifacts(text) {
  let out = String(text || '');
  out = out.replace(CITATION_MARKER_RE, '');
  out = out.replace(CITATION_MARKER_LOOSE_RE, '');
  out = out.replace(/\(\[([^\]]+)\]\(([^)]+)\)\)/g, (_, label, url) => {
    const href = normalizeBareUrl(url);
    return href ? `[${label.trim()}](${href})` : `(${label})`;
  });
  out = out.replace(/\[([^\]\n]+)\]\((?!https?:\/\/|mailto:)([^)\s]+)\)/gi, (_, label, url) => {
    const href = normalizeBareUrl(url);
    return href ? `[${label}](${href})` : `[${label}](${url})`;
  });
  out = out.replace(
    /\(\[([^\]]+?)\)\]\(([^)\s]+(?:\([^)]*\)[^)\s]*)*)\)/g,
    (_, label, url) => {
      const href = normalizeBareUrl(url);
      return href ? `[${label.replace(/\)+$/, '')}](${href})` : `(${label})`;
    },
  );
  out = out.replace(
    /(\]\(https?:\/\/[^)]+\))\/[^\s)]+\?utm_source=openai\)?/gi,
    '$1',
  );
  return out;
}

const INLINE_RE = /(`[^`\n]+`|\[[^\]\n]+\]\([^)\s<>]+(?:\([^)\s<>]*\)[^)\s<>]*)?\)|https?:\/\/[^\s<>)\]]+|(?:\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_))/g;

function safeHref(href) {
  const raw = String(href || '').trim();
  if (/^https?:\/\//i.test(raw) || /^mailto:/i.test(raw)) return raw;
  return normalizeBareUrl(raw);
}

// Models often chain bullets on one line: "- **A:** x - **B:** y"
function expandInlineListItems(line) {
  if (!/^[-*•]\s/.test(line)) return [line];
  const body = line.replace(/^[-*•]\s+/, '');
  if (!/\s+-\s+(?=\*\*)/.test(body)) return [line];
  const parts = body.split(/\s+-\s+(?=\*\*)/);
  if (parts.length <= 1) return [line];
  return parts.map((part) => `- ${part.trim()}`);
}

function normalizeLines(text) {
  const out = [];
  for (const line of String(text).replace(/\r\n/g, '\n').split('\n')) {
    if (/^[-*•]\s/.test(line) && /\s+-\s+(?=\*\*)/.test(line)) {
      expandInlineListItems(line).forEach((expanded) => out.push(expanded));
    } else {
      out.push(line);
    }
  }
  return out;
}

function looksLikeLabelUrlLines(lines) {
  const trimmed = lines.map((l) => l.trim()).filter(Boolean);
  if (!trimmed.length) return false;
  return trimmed.every((l) => /^[^:\n]+:\s*\S+/.test(l));
}

function labelUrlLineToMarkdown(line) {
  const m = line.trim().match(/^([^:]+):\s*(.+)$/);
  if (!m) return line.trim();
  const label = m[1].trim();
  const urlPart = m[2].trim().replace(/[.,;:!?)]+$/, '');
  const href = safeHref(urlPart);
  return href ? `[${label}](${href})` : `**${label}:** ${urlPart}`;
}

function stripIncompleteFence(text) {
  const matches = [...String(text).matchAll(/```/g)];
  if (matches.length % 2 === 0) return text;
  return text.slice(0, matches[matches.length - 1].index);
}

function parseBlocks(text) {
  const lines = normalizeLines(text);
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    if (/^```/.test(line.trim())) {
      i++;
      const codeLines = [];
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      if (looksLikeLabelUrlLines(codeLines)) {
        blocks.push({
          type: 'ul',
          items: codeLines.map((l) => labelUrlLineToMarkdown(l)).filter(Boolean),
        });
      } else if (codeLines.length) {
        blocks.push({ type: 'pre', text: codeLines.join('\n') });
      }
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
      i++;
      continue;
    }

    const boldLabel = line.trim().match(/^\*\*([^*]+)\*\*:?\s*$/);
    if (boldLabel) {
      blocks.push({ type: 'heading', level: 4, text: boldLabel[1].trim() });
      i++;
      continue;
    }

    if (/^[-*•]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*•]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*•]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim()
      && !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim())
      && !/^```/.test(lines[i].trim())
      && !/^#{1,6}\s/.test(lines[i])
      && !/^\*\*[^*]+\*\*:?\s*$/.test(lines[i].trim())
      && !/^[-*•]\s/.test(lines[i])
      && !/^\d+\.\s/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'p', text: para.join('\n') });
  }

  return blocks;
}

function inlineFormat(text, keyPrefix = '') {
  const parts = String(text).split(INLINE_RE);
  return parts.map((part, i) => {
    const key = `${keyPrefix}i${i}`;
    const link = part.match(/^\[([^\]\n]+)\]\(([^)\s<>]+(?:\([^)\s<>]*\)[^)\s<>]*)?)\)$/i);
    if (link) {
      const href = safeHref(link[2]);
      if (href) {
        return html`<a key=${key} href=${href} target="_blank" rel="noopener noreferrer" class="trip-chat-md-a">${link[1]}</a>`;
      }
    }
    if (/^https?:\/\//i.test(part)) {
      const href = safeHref(part.replace(/[.,;:!?)]+$/, ''));
      if (href) {
        const label = href.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
        return html`<a key=${key} href=${href} target="_blank" rel="noopener noreferrer" class="trip-chat-md-a">${label}</a>`;
      }
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return html`<strong key=${key} class="font-semibold">${part.slice(2, -2)}</strong>`;
    }
    if (part.startsWith('__') && part.endsWith('__')) {
      return html`<strong key=${key} class="font-semibold">${part.slice(2, -2)}</strong>`;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return html`<code key=${key} class="trip-chat-code">${part.slice(1, -1)}</code>`;
    }
    if (!part) return null;
    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) {
      return html`<em key=${key} class="italic">${part.slice(1, -1)}</em>`;
    }
    return part;
  });
}

function renderBlock(block, bi) {
  if (block.type === 'hr') {
    return html`<hr key=${bi} class="trip-chat-md-hr" />`;
  }
  if (block.type === 'heading') {
    const level = Math.min(6, Math.max(1, block.level));
    const tag = HEADING_TAG[level];
    const cls = HEADING_CLS[level];
    return html`<${tag} key=${bi} class=${cls}>${inlineFormat(block.text, `h${bi}-`)}</${tag}>`;
  }
  if (block.type === 'ul') {
    return html`<ul key=${bi} class="trip-chat-md-ul">
      ${block.items.map((item, li) => html`<li key=${li}>${inlineFormat(item, `u${bi}-${li}-`)}</li>`)}
    </ul>`;
  }
  if (block.type === 'ol') {
    return html`<ol key=${bi} class="trip-chat-md-ol">
      ${block.items.map((item, li) => html`<li key=${li}>${inlineFormat(item, `o${bi}-${li}-`)}</li>`)}
    </ol>`;
  }
  if (block.type === 'pre') {
    return html`<pre key=${bi} class="trip-chat-md-pre"><code class="trip-chat-code">${block.text}</code></pre>`;
  }
  return html`<p key=${bi} class="trip-chat-md-p">${renderParagraphLines(block.text, `p${bi}-`)}</p>`;
}

function renderParagraphLines(text, keyPrefix) {
  const lines = String(text).split('\n');
  if (lines.length === 1) return inlineFormat(text, keyPrefix);
  return lines.map((line, li) => {
    const content = inlineFormat(line, `${keyPrefix}l${li}-`);
    if (li === 0) return content;
    return [html`<br key=${`${keyPrefix}br${li}`} />`, content];
  });
}

export function ChatMarkdown({ text, streaming = false }) {
  if (!text) return null;
  const source = streaming ? stripIncompleteFence(text) : text;
  const blocks = parseBlocks(repairCitationArtifacts(source));
  return html`<div class=${`trip-chat-md${streaming ? ' trip-chat-md--streaming' : ''}`}>${blocks.map(renderBlock)}</div>`;
}
