// Shared propose_trip_edits tool schema + instructions for Claus chat.

const SLOT_KEYS = ['', 'morning', 'afternoon', 'evening', 'breakfast', 'lunch', 'dinner', 'lodging'];
const ACTION_TYPES = [
  'none',
  'set_day_slot',
  'update_day_slot_item',
  'remove_day_slot_item',
  'move_day_slot_item',
  'update_transport_leg',
  'set_trip_dates',
  'set_arrival',
  'set_departure',
];
const OPS = ['', 'add', 'replace', 'update', 'remove', 'move'];
const ITEM_TYPES = ['', 'see', 'do', 'eat', 'lodging', 'travel'];
const MODES = ['', 'train', 'bus', 'car', 'ferry', 'express boat', 'overnight boat', 'flight'];

const ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    type: { type: 'string', enum: ITEM_TYPES },
    emoji: { type: 'string' },
    address: { type: 'string' },
    venue: { type: 'string' },
    venueAddress: { type: 'string' },
    notes: { type: 'string' },
    sourceUrl: { type: 'string' },
    pinByName: { type: 'boolean' },
    mode: { type: 'string', enum: MODES },
    depStation: { type: 'string' },
    depTime: { type: 'string' },
    depDate: { type: 'string' },
    arrStation: { type: 'string' },
    arrTime: { type: 'string' },
    arrDate: { type: 'string' },
    bookingRef: { type: 'string' },
    note: { type: 'string' },
    durationMin: { type: ['number', 'null'] },
  },
  required: [
    'name', 'type', 'emoji', 'address', 'venue', 'venueAddress', 'notes', 'sourceUrl',
    'pinByName', 'mode', 'depStation', 'depTime', 'depDate', 'arrStation', 'arrTime',
    'arrDate', 'bookingRef', 'note', 'durationMin',
  ],
};

const ACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: { type: 'string', enum: ACTION_TYPES },
    confidence: { type: 'number' },
    needsConfirmation: { type: 'boolean' },
    summary: { type: 'string' },
    reason: { type: 'string' },
    op: { type: 'string', enum: OPS },
    stopId: { type: 'string' },
    date: { type: 'string' },
    slotKey: { type: 'string', enum: SLOT_KEYS },
    itemId: { type: 'string' },
    itemName: { type: 'string' },
    fromStopId: { type: 'string' },
    fromDate: { type: 'string' },
    fromSlotKey: { type: 'string', enum: SLOT_KEYS },
    fromItemId: { type: 'string' },
    toStopId: { type: 'string' },
    toDate: { type: 'string' },
    toSlotKey: { type: 'string', enum: SLOT_KEYS },
    item: ITEM_SCHEMA,
    patch: ITEM_SCHEMA,
  },
  required: [
    'type', 'confidence', 'needsConfirmation', 'summary', 'reason', 'op', 'stopId',
    'date', 'slotKey', 'itemId', 'itemName', 'fromStopId', 'fromDate',
    'fromSlotKey', 'fromItemId', 'toStopId', 'toDate', 'toSlotKey', 'item', 'patch',
  ],
};

// Claude tool: name + description + input_schema. The input arrives on the
// tool_use block already parsed (no JSON.parse of a stringified arguments
// field). `maxItems` is expressed in the description rather than the schema so
// the tool definition stays within the constraints Claude tool schemas accept.
const PROPOSE_EDITS_TOOL = {
  name: 'propose_trip_edits',
  description: 'Propose itinerary edits (at most 6) for the client to apply. Use only when the user wants the plan changed (add/move/remove with date or slot). Return actions: [] for advice, Q&A, and booking research.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      actions: {
        type: 'array',
        items: ACTION_SCHEMA,
      },
      clarification: {
        type: 'string',
        description: 'One specific question when actions is empty and date/city/slot is ambiguous. Empty otherwise.',
      },
    },
    required: ['actions', 'clarification'],
  },
};

const EDIT_TOOL_INSTRUCTIONS = [
  'You have propose_trip_edits for changing the itinerary. Answer in text for advice, Q&A, hours, prices, and booking research — call the tool with actions: [] unless the user wants the plan updated.',
  'Call propose_trip_edits when the user asks to add/move/remove/change something on the plan (restaurant + date, hotel, transport leg, etc.).',
  'Use exact stopId, date, slotKey, itemId, and fromStopId from STRUCTURED EDIT CONTEXT. Never invent IDs.',
  'Infer stop/city from date using each stop startDate..endDate when the user gives only a date.',
  'Infer the item/place to add from the immediately prior assistant recommendation when the user says "it", "that", or "add it".',
  'Dates in actions: YYYY-MM-DD. Restaurant + date + time: type eat, pinByName true, dinner slot for evening times (depTime/arrTime HH:MM 24h).',
  'Ambiguous or destructive edits: needsConfirmation=true, or actions [] with one clarification question.',
  'Short replies (yes, do it, go ahead) apply the edit from your immediately prior assistant message.',
  'Never propose edits the user did not ask for or clearly confirm.',
].join(' ');

module.exports = {
  PROPOSE_EDITS_TOOL,
  EDIT_TOOL_INSTRUCTIONS,
};
