// Light serverless ticket reader. Sends an uploaded ticket PDF or photo to the
// Claude Messages API and returns the leg's stations/times/date as structured
// JSON (native structured outputs), so the timeline editor can autofill them.
// Plain CommonJS + global fetch (Node 18+) — no build step or package.json,
// like the other api/* functions. Needs ANTHROPIC_API_KEY set as a Vercel env
// var; without it the endpoint says "not configured" and the client just skips
// autofill (the ticket still attaches).

const {
  MODEL,
  apiKey,
  fetchAnthropicMessages,
  fileBlockFromDataUrl,
  extractText,
} = require('./_lib/claus-anthropic.js');

// Strict structured-output schema. Times are 24h "HH:MM"; dates "YYYY-MM-DD";
// mode matches the app's set ('' when unclear). All keys required (strict
// json_schema); unknown values come back as empty strings.
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    matched: { type: 'boolean', description: 'whether this upload plausibly contains transport ticket details for the requested context' },
    mode: { type: 'string', enum: ['train', 'bus', 'car', 'ferry', 'express boat', 'overnight boat', 'flight', ''], description: "the single primary mode for the leg, or '' if unclear" },
    depStation: { type: 'string', description: "departure station / terminal / airport at the ORIGIN (the first departure if the ticket has connections); '' if absent" },
    depTime: { type: 'string', description: "departure time as 24-hour HH:MM; '' if absent" },
    depDate: { type: 'string', description: "departure date as YYYY-MM-DD; '' if absent" },
    arrStation: { type: 'string', description: "arrival station / terminal / airport at the DESTINATION (the final arrival if the ticket has connections); '' if absent" },
    arrTime: { type: 'string', description: "arrival time as 24-hour HH:MM; '' if absent" },
    arrDate: { type: 'string', description: "arrival date as YYYY-MM-DD; '' if absent" },
    bookingRef: { type: 'string', description: "booking reference / PNR / ticket number; '' if absent" },
    note: { type: 'string', description: "a short note about connections or changes (e.g. 'change at Voss'); '' if none" },
  },
  required: ['matched', 'mode', 'depStation', 'depTime', 'depDate', 'arrStation', 'arrTime', 'arrDate', 'bookingRef', 'note'],
};

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') { resolve(req.body); return; }
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }

  const key = apiKey();
  if (!key) { res.status(503).json({ error: 'not_configured' }); return; }

  const body = await readBody(req);
  const dataUrl = String(body.dataUrl || '');
  // A PDF goes in as a document (text + page images); a screenshot/photo goes in
  // as an image so the model reads it with vision.
  const fileBlock = fileBlockFromDataUrl(dataUrl);
  if (!fileBlock) { res.status(400).json({ error: 'bad_file' }); return; }

  const fromCity = String(body.fromCity || '').slice(0, 120);
  const toCity = String(body.toCity || '').slice(0, 120);
  const year = String(body.year || '').slice(0, 4);
  const travelDate = String(body.travelDate || '').slice(0, 10);
  const strictMatch = body.strictMatch !== false;
  const contextKind = String(body.contextKind || 'leg').slice(0, 40);
  const blockTitle = String(body.blockTitle || '').slice(0, 160);

  const system = [
    'You extract structured travel details from a transport ticket.',
    'The ticket may be a PDF (read its text and layout) or a screenshot/photo of a ticket, app, or confirmation email (read it visually).',
    'Identify the stations/terminals/airports, the departure and arrival clock times, the date(s), the mode of transport, and the booking reference.',
    strictMatch
      ? 'Connections: a single ticket can cover several legs with changes. Report the FIRST departure (from the origin) and the FINAL arrival (at the destination) for the requested city pair — never an intermediate change point.'
      : 'Connections: a single ticket can cover several legs with changes. Report the FIRST departure and the FINAL arrival shown on the ticket — never an intermediate change point.',
    'Normalize every time to 24-hour HH:MM and every date to YYYY-MM-DD.',
    'Only report what is actually shown — do not guess, infer, or invent missing facts; use empty strings for anything not present.',
    strictMatch
      ? 'If the ticket is clearly for a different journey than the requested city pair, set matched to false.'
      : 'This is for a day-schedule travel block, so the current city/day is context only. Set matched to false only if the upload is not a transport ticket or travel confirmation.',
  ].join(' ');

  const prompt = strictMatch
    ? [
        `Extract the travel details for the leg from ${fromCity || 'the origin'} to ${toCity || 'the destination'}.`,
        year ? `Assume year ${year} when a date omits it.` : '',
        travelDate ? `This leg is expected around ${travelDate}.` : '',
      ].filter(Boolean).join(' ')
    : [
        `Extract the travel details for a ${contextKind === 'schedule' ? 'day-schedule travel block' : 'travel block'}.`,
        blockTitle ? `The block is named "${blockTitle}".` : '',
        fromCity ? `The surrounding day plan is in or near ${fromCity}.` : '',
        year ? `Assume year ${year} when a date omits it.` : '',
        travelDate ? `This block is expected around ${travelDate}.` : '',
      ].filter(Boolean).join(' ');

  try {
    const r = await fetchAnthropicMessages(key, {
      model: MODEL,
      system,
      messages: [
        { role: 'user', content: [fileBlock, { type: 'text', text: prompt }] },
      ],
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'high',
        format: { type: 'json_schema', schema: SCHEMA },
      },
      max_tokens: 8000,
    }, { maxRetries: 2 });

    const data = await r.json();
    let parsed = null;
    try { parsed = JSON.parse(extractText(data) || ''); } catch { /* leave null */ }
    if (!parsed) { res.status(502).json({ error: 'unparseable' }); return; }

    res.setHeader('Cache-Control', 'no-store'); // tickets are personal and one-shot
    res.status(200).json({ fields: parsed });
  } catch (e) {
    res.status(502).json({
      error: 'upstream',
      status: e?.status || 502,
      detail: String((e && (e.detail || e.message)) || e).slice(0, 400),
    });
  }
};
