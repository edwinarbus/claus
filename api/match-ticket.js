// Trip-wide ticket matcher. Reads a dropped PDF/photo and chooses where it
// belongs in the itinerary (via Claude structured outputs) before the client
// attaches it to that leg/day. The itinerary JSON rides in a cached system
// block, so repeated uploads for the same trip are served from the prompt cache.

const {
  MODEL,
  apiKey,
  fetchAnthropicMessages,
  fileBlockFromDataUrl,
  extractText,
} = require('./_lib/claus-anthropic.js');

const MODES = ['train', 'bus', 'car', 'ferry', 'express boat', 'overnight boat', 'flight', ''];
const TARGET_KINDS = ['timeline_leg', 'day_slot', 'new_day_travel', 'meal_slot', 'unmatched'];
const SLOT_KEYS = ['', 'morning', 'afternoon', 'evening', 'breakfast', 'lunch', 'dinner', 'lodging'];
const DOC_KINDS = ['travel', 'dining', ''];

const FIELDS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    matched: { type: 'boolean' },
    kind: { type: 'string', enum: DOC_KINDS, description: "'travel' for a transport ticket, 'dining' for a restaurant/meal reservation, '' if neither" },
    mode: { type: 'string', enum: MODES },
    depStation: { type: 'string' },
    depTime: { type: 'string' },
    depDate: { type: 'string' },
    arrStation: { type: 'string' },
    arrTime: { type: 'string' },
    arrDate: { type: 'string' },
    bookingRef: { type: 'string' },
    note: { type: 'string' },
    title: { type: 'string' },
    durationMin: { type: ['number', 'null'] },
    // Dining-reservation fields (kind === 'dining').
    venue: { type: 'string', description: "restaurant / venue name for a dining reservation; '' otherwise" },
    venueAddress: { type: 'string', description: "street address of the restaurant if shown; '' otherwise" },
    resDate: { type: 'string', description: "reservation date YYYY-MM-DD; '' otherwise" },
    resTime: { type: 'string', description: "reservation time 24-hour HH:MM; '' otherwise" },
    partySize: { type: ['number', 'null'], description: 'number of guests in the reservation, or null if not shown' },
  },
  required: [
    'matched', 'kind', 'mode', 'depStation', 'depTime', 'depDate', 'arrStation', 'arrTime',
    'arrDate', 'bookingRef', 'note', 'title', 'durationMin',
    'venue', 'venueAddress', 'resDate', 'resTime', 'partySize',
  ],
};

const TARGET_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: TARGET_KINDS },
    fromStopId: { type: 'string' },
    toStopId: { type: 'string' },
    stopId: { type: 'string' },
    date: { type: 'string' },
    slotKey: { type: 'string', enum: SLOT_KEYS },
    itemId: { type: 'string' },
  },
  required: ['kind', 'fromStopId', 'toStopId', 'stopId', 'date', 'slotKey', 'itemId'],
};

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    matched: { type: 'boolean' },
    confidence: { type: 'number' },
    reason: { type: 'string' },
    target: TARGET_SCHEMA,
    fields: FIELDS_SCHEMA,
  },
  required: ['matched', 'confidence', 'reason', 'target', 'fields'],
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
  const fileBlock = fileBlockFromDataUrl(String(body.dataUrl || ''));
  if (!fileBlock) { res.status(400).json({ error: 'bad_file' }); return; }

  const filename = String(body.filename || 'ticket').slice(0, 180);
  const itinerary = body.itinerary && typeof body.itinerary === 'object' ? body.itinerary : {};

  const system = [
    'You read a travel ticket OR a restaurant/dining reservation and decide where it belongs in an itinerary.',
    'First classify the upload: set fields.kind to "travel" for a transport ticket/boarding pass, or "dining" for a restaurant reservation or booking confirmation (e.g. OpenTable, Resy, SevenRooms, a restaurant email).',
    'For a TRAVEL ticket: extract mode, stations/terminals/airports, dates, times, booking reference, and useful connection notes. Then match it to one target — prefer timeline_leg for inter-city travel between two itinerary stops; use day_slot when it matches an existing day-level travel item (include that itemId); use new_day_travel when the date belongs to a trip day but no existing travel item matches.',
    'For a DINING reservation: extract venue (restaurant name), venueAddress, resDate, resTime, partySize, and the booking reference. Then set target kind meal_slot, with the stopId + date of the itinerary day whose date equals the reservation date, and slotKey breakfast/lunch/dinner chosen from the reservation time. Meal time mapping is deterministic: before 11:00 is breakfast, 11:00-15:59 is lunch, 16:00 or later is dinner. A reservation at 18:30 is dinner.',
    'For dining, match by exact reservation date first against itinerary.days. Use the venue city/address/country only to choose between stops on that date; do not reject a dining reservation just because the city is not repeated in the compact day label.',
    'Use unmatched only if it is neither a transport ticket nor a dining reservation, or no plausible itinerary date exists after checking every itinerary day by exact YYYY-MM-DD.',
    'Use exact IDs from the itinerary JSON. Never invent IDs. Empty strings for fields that do not apply.',
    'Dates must be YYYY-MM-DD and times 24-hour HH:MM. Do not guess missing facts; infer the year only from itinerary.tripYear when the upload omits it.',
  ].join(' ');

  try {
    const r = await fetchAnthropicMessages(key, {
      model: MODEL,
      system: [
        { type: 'text', text: system },
        {
          type: 'text',
          text: `[ITINERARY JSON]\n${JSON.stringify(itinerary).slice(0, 32000)}`,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        { role: 'user', content: [fileBlock, { type: 'text', text: `Filename: ${filename}` }] },
      ],
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'high',
        format: { type: 'json_schema', schema: RESPONSE_SCHEMA },
      },
      max_tokens: 8000,
    }, { maxRetries: 2 });

    const data = await r.json();
    let parsed = null;
    try { parsed = JSON.parse(extractText(data) || ''); } catch { /* leave null */ }
    if (!parsed) { res.status(502).json({ error: 'unparseable' }); return; }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(parsed);
  } catch (e) {
    res.status(502).json({
      error: 'upstream',
      status: e?.status || 502,
      detail: String((e && (e.detail || e.message)) || e).slice(0, 400),
    });
  }
};
