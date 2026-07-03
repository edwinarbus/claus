import { html } from '../html.js';

// Custom monochrome line glyphs for itinerary items — the same drawing language
// as the transport glyphs (currentColor strokes, soft round joins), sitting in
// for the old category emoji. Resolved from an item's name/tags/type, mirroring
// the rules in lib/emoji.js. A user-set `item.emoji` is respected as-is.

// name/tag regex → glyph key (order matters; first match wins). Kept parallel to
// the RULES list in lib/emoji.js.
const RULE_KEYS = [
  [/\bgarden|botanic|tivoli\b/i, 'tree'],
  [/cathedral|church|chapel|kirke|domkyrka|tuomiokirkko|dom\b/i, 'church'],
  [/castle|palace|slott|fortress|kastellet|citadel/i, 'castle'],
  [/museum|gallery|kunst|aros|glyptotek|moderna|munch|vasa/i, 'museum'],
  [/viewpoint|lookout|panorama|stegastein|overlook|fløyen|fløibanen/i, 'binoculars'],
  [/fjord|mountain|glacier|cliff|trolltunga|preikestol|peak|fjell/i, 'mountain'],
  [/funicular|cable car|gondola|tram\b/i, 'cablecar'],
  [/hike|trail|trek|walk\b|hiking/i, 'boot'],
  [/kayak|canoe|paddle|sail|cruise|boat|ferry|fjord boat|express boat/i, 'sailboat'],
  [/bike|bicycle|cycle|cycling/i, 'bike'],
  [/train|railway|flåm|flam|funicular line/i, 'train'],
  [/sauna|spa|bath|bad\b|thermal|löyly|loyly/i, 'spa'],
  [/swim|harbour bath|harbor bath|beach|island|archipelago|skerr/i, 'beach'],
  [/market|torvehallerne|market hall|saluhall|kauppahalli|torg market/i, 'bag'],
  [/zoo|aquarium|akvariet/i, 'paw'],
  [/amusement|roller ?coaster|fairground|liseberg/i, 'coaster'],
  [/park|forest|nature reserve|woods/i, 'pine'],
  [/tower|tårn|tarn|torni|spire/i, 'tower'],
  [/bridge|øresund|oresund/i, 'bridge'],
  [/harbor|harbour|nyhavn|port\b|quay|brygge|wharf|waterfront/i, 'anchor'],
  [/opera|theatre|theater|concert|jazz|music|festival/i, 'music'],
  [/design|architecture|street art|mural/i, 'palette'],
  [/coffee|café|cafe|fika|espresso|roastery/i, 'coffee'],
  [/pastry|wienerbrød|bakery|cinnamon|cardamom|bun|kanel|bulle|pulla/i, 'pastry'],
  [/oyster|seafood|fish|herring|sild|shrimp|prawn|salmon|lax|laks|crab|lobster/i, 'fish'],
  [/hot ?dog|pølse|polse|sausage|street food/i, 'hotdog'],
  [/cheese|ost\b/i, 'cheese'],
  [/reindeer|elk|moose|game|venison/i, 'deer'],
  [/meatball|köttbullar|kottbullar|husmanskost/i, 'fork'],
  [/beer|brewery|pub|bar\b|cocktail|wine/i, 'beer'],
  [/smørrebrød|smorrebrod|sandwich/i, 'sandwich'],
  [/new nordic|tasting menu|fine dining|michelin|dinner|dining|destination dining/i, 'sparkle'],
];

const TYPE_KEY = { see: 'museum', do: 'boot', eat: 'fork', lodging: 'bed', travel: 'train' };

export function itemGlyphKey(item) {
  if (!item) return 'pin';
  const hay = `${item.name || ''} ${(item.tags || []).join(' ')}`;
  for (const [re, key] of RULE_KEYS) if (re.test(hay)) return key;
  return TYPE_KEY[item.type] || 'pin';
}

// 24×24 inner markup. Dots/eyes are filled; everything else inherits the svg's
// fill:none / stroke:currentColor.
const GLYPHS = {
  tree: '<path d="M12 22v-5"/><circle cx="12" cy="9" r="6"/>',
  church: '<path d="M12 2v3M10.5 3.5h3"/><path d="M6 22V11l6-4 6 4v11"/><path d="M10 22v-4a2 2 0 0 1 4 0v4"/>',
  castle: '<path d="M4 22V9h2V6.5h2V9h2V6.5h2V9h2V6.5h2V9h2v13"/><path d="M10 22v-4a2 2 0 0 1 4 0v4"/>',
  museum: '<path d="M3 9l9-5 9 5"/><path d="M4 9v10M9 9v10M15 9v10M20 9v10"/><path d="M3 21h18"/>',
  binoculars: '<circle cx="6.5" cy="14.5" r="3"/><circle cx="17.5" cy="14.5" r="3"/><path d="M9 13l1.3-3.6A1 1 0 0 1 11.25 9h1.5a1 1 0 0 1 .95.7L15 13"/><path d="M9.3 14.5h5.4"/>',
  mountain: '<path d="M3 19l5.5-10 3.5 6 2-3.2 4.5 7.2z"/><path d="M8.5 9l1.6 2.7"/>',
  cablecar: '<path d="M3 5h18"/><path d="M9.5 5L8 8.5M14.5 5L16 8.5"/><rect x="6.5" y="8.5" width="11" height="6.5" rx="1.6"/><path d="M6.5 11.5h11"/><path d="M9 15v2.5M15 15v2.5"/>',
  boot: '<path d="M8 3v8.5l-3 1.4A3.2 3.2 0 0 0 3.2 16H3v3h15a1.5 1.5 0 0 0 1.5-1.5c0-2.2-1.7-3.4-4-4.1L13 12V3z"/><path d="M3 17h15"/>',
  sailboat: '<path d="M12 3.5v9"/><path d="M12 4.5l6 8H12z"/><path d="M3 16h18l-2 3.6A1 1 0 0 1 18 20H6a1 1 0 0 1-1-.4z"/>',
  bike: '<circle cx="6" cy="16.5" r="3.4"/><circle cx="18" cy="16.5" r="3.4"/><path d="M6 16.5l4.2-6.5H15l-3 6.5M10.2 10L9 8H7"/><path d="M14.5 10h2.5l1 6.5"/>',
  train: '<rect x="5" y="3" width="14" height="13" rx="4.2"/><path d="M5.4 9.2h13.2"/><path d="M9 16l-2 4M15 16l2 4"/><circle cx="8.6" cy="12.4" r="1.05" fill="currentColor" stroke="none"/><circle cx="15.4" cy="12.4" r="1.05" fill="currentColor" stroke="none"/>',
  spa: '<path d="M7 13c0-2 1.6-3 1.6-5M12 13c0-2 1.6-3 1.6-5M17 13c0-2-1.6-3-1.6-5" opacity="0.9"/><path d="M4.5 15.5h15v1A3.5 3.5 0 0 1 16 20H8a3.5 3.5 0 0 1-3.5-3.5z"/>',
  beach: '<path d="M3 20.5h18"/><path d="M12 20.5V11"/><path d="M12 11c-.5-3-3-4.5-6-4 1.5-2.5 5-2.6 6 .5 1-3.1 4.5-3 6-.5-3-.5-5.5 1-6 4z"/>',
  bag: '<path d="M6 8h12l-1 11.2a1.5 1.5 0 0 1-1.5 1.3H8.5A1.5 1.5 0 0 1 7 19.2z"/><path d="M8.7 8a3.3 3.3 0 0 1 6.6 0"/>',
  paw: '<ellipse cx="12" cy="16" rx="4.2" ry="3.4"/><circle cx="6.6" cy="12.4" r="1.7"/><circle cx="17.4" cy="12.4" r="1.7"/><circle cx="9" cy="8.4" r="1.6"/><circle cx="15" cy="8.4" r="1.6"/>',
  coaster: '<path d="M3 7v11"/><path d="M3 7c5 0 4 9 9 9s4-9 9-9"/><path d="M3 18h18"/><circle cx="7" cy="20" r="1" fill="currentColor" stroke="none"/><circle cx="13" cy="20" r="1" fill="currentColor" stroke="none"/>',
  pine: '<path d="M12 3l4 6h-2.2l3 5h-2.3l2.3 4H7.2l2.3-4H7.2l3-5H8z"/><path d="M12 22v-4"/>',
  tower: '<path d="M9 22V8l3-5 3 5v14"/><path d="M9 12h6M9 16.5h6"/>',
  bridge: '<path d="M3 16c4.5 0 4.5-6 9-6s4.5 6 9 6"/><path d="M3 16v3.5M21 16v3.5M9 13v6.5M15 13v6.5"/>',
  anchor: '<circle cx="12" cy="5" r="2.4"/><path d="M12 7.4V21"/><path d="M5 12.5H2.6a9.4 9.4 0 0 0 18.8 0H19"/><path d="M8.5 11l-3 1.5M15.5 11l3 1.5"/>',
  music: '<circle cx="6.5" cy="18" r="2.4"/><circle cx="17" cy="16" r="2.4"/><path d="M8.9 18V6.5l10.5-2v11"/>',
  palette: '<path d="M12 3.2c-5 0-9 3.5-9 8 0 2.7 2.3 4.6 4.8 4.6.9 0 1.6.7 1.6 1.6 0 .8.3 1.6 1.4 1.8 4.6.6 9.2-3 9.2-7.8 0-5-4-8.2-9-8.2z"/><circle cx="8" cy="9.5" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="7.6" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="9.5" r="1" fill="currentColor" stroke="none"/>',
  coffee: '<path d="M17 8h1.2a3.3 3.3 0 0 1 0 6.6H17"/><path d="M3.5 8h13.5v8a4 4 0 0 1-4 4H7.5a4 4 0 0 1-4-4z"/><path d="M7 2.5v2M10.5 2.5v2M14 2.5v2"/>',
  pastry: '<path d="M5.5 12h13l-1 7.2a1.5 1.5 0 0 1-1.5 1.3H8a1.5 1.5 0 0 1-1.5-1.3z"/><path d="M5.5 12a6.5 6.5 0 0 1 13 0"/><path d="M12 6.4V3.4"/>',
  fish: '<path d="M3 12c3.2-5 11-5 15.2 0-4.2 5-12 5-15.2 0z"/><path d="M18 12l3.2-3.2v6.4z"/><circle cx="8" cy="10.8" r="0.7" fill="currentColor" stroke="none"/>',
  hotdog: '<path d="M5 13.5c-2 0-3.2-1-3.2-2.6S3 8.3 5 8.3h14c2 0 3.2 1 3.2 2.6S21 13.5 19 13.5z"/><path d="M6.5 11h11"/>',
  cheese: '<path d="M3 16l16-6.5 2.2 6.5z"/><circle cx="8" cy="14" r="0.85" fill="currentColor" stroke="none"/><circle cx="13" cy="13" r="0.7" fill="currentColor" stroke="none"/>',
  deer: '<path d="M12 21v-6.5"/><path d="M12 14.5a3 3 0 0 1-3-3c0-1.2.6-2 .6-3M12 14.5a3 3 0 0 0 3-3c0-1.2-.6-2-.6-3"/><path d="M9.6 8.5L8 5.4 5.7 6.5M9.6 8.5 9 4M14.4 8.5 16 5.4l2.3 1.1M14.4 8.5 15 4"/>',
  fork: '<path d="M7 3v18M5 3v5.5a2 2 0 0 0 4 0V3"/><path d="M17 3c-1.6 0-2.6 2.1-2.6 5.2 0 2.6 1 4 2.6 4.2V21"/>',
  beer: '<path d="M17 11h1.2a3 3 0 0 1 0 6H17"/><path d="M5 8.5h12v9.5a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 5 18z"/><path d="M9 12v5.5M13 12v5.5"/><path d="M5.5 8.5C5.5 5.5 8 4 9.5 5 10.5 3 14 3 14.7 5.3 17 4.8 18 7 16.7 8.5"/>',
  sandwich: '<path d="M3.5 11.5h17l-1.3 2.4a1 1 0 0 1-.9.5H5.7a1 1 0 0 1-.9-.5z"/><path d="M5 8.5h14M5 16.5h14"/>',
  sparkle: '<path d="M12 3l1.7 5.6L19 10.2l-5.3 1.6L12 17l-1.7-5.2L5 10.2l5.3-1.6z"/>',
  bed: '<path d="M2.5 6v13M2.5 10.5h17a2 2 0 0 1 2 2V19M2.5 15.5h19"/><path d="M6.5 10.5V8a1 1 0 0 1 1-1h3.2a1 1 0 0 1 1 1v2.5"/>',
  pin: '<path d="M12 21.5s6.5-5.3 6.5-10.5a6.5 6.5 0 0 0-13 0c0 5.2 6.5 10.5 6.5 10.5z"/><circle cx="12" cy="11" r="2.4"/>',
};

function glyphMarkup(key) {
  const inner = GLYPHS[key] || GLYPHS.pin;
  return `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

export function ItemGlyph({ item, className = 'w-[1.05em] h-[1.05em]' }) {
  // Respect an explicitly chosen emoji on the item.
  if (item && item.emoji) {
    return html`<span class=${`inline-flex items-center justify-center leading-none ${className}`}>${item.emoji}</span>`;
  }
  return html`<span aria-hidden="true"
    class=${`inline-flex items-center justify-center ${className}`}
    dangerouslySetInnerHTML=${{ __html: glyphMarkup(itemGlyphKey(item)) }}></span>`;
}
