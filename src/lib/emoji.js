// Pick a contextual emoji for an item from its name/tags, falling back to a
// type default. Used for compact day-slot chips and rec-card placeholders so a
// "Tivoli Gardens" reads as 🌳 at a glance even when the text is short.

const TYPE_FALLBACK = { see: '🏛️', do: '🥾', eat: '🍽️', lodging: '🛏️', travel: '🚆' };

// Country flag for a stop's country (one shared source of truth).
const COUNTRY_FLAG = { Denmark: '🇩🇰', Sweden: '🇸🇪', Norway: '🇳🇴', Finland: '🇫🇮', Estonia: '🇪🇪' };
export function countryFlag(country, fallback = '📍') {
  return COUNTRY_FLAG[country] || fallback;
}

// Order matters: the first matching rule wins, so put specific words first.
const RULES = [
  [/\bgarden|botanic|tivoli\b/i, '🌳'],
  [/cathedral|church|chapel|kirke|domkyrka|tuomiokirkko|dom\b/i, '⛪'],
  [/castle|palace|slott|fortress|kastellet|citadel/i, '🏰'],
  [/museum|gallery|kunst|aros|glyptotek|moderna|munch|vasa/i, '🖼️'],
  [/viewpoint|lookout|panorama|stegastein|overlook|fløyen|fløyen|fløibanen/i, '🔭'],
  [/fjord|mountain|glacier|cliff|trolltunga|preikestol|peak|fjell/i, '🏔️'],
  [/funicular|cable car|gondola|tram\b/i, '🚠'],
  [/hike|trail|trek|walk\b|hiking/i, '🥾'],
  [/kayak|canoe|paddle|sail|cruise|boat|ferry|fjord boat|express boat/i, '⛴️'],
  [/bike|bicycle|cycle|cycling/i, '🚲'],
  [/train|railway|flåm|flam|funicular line/i, '🚂'],
  [/sauna|spa|bath|bad\b|thermal|löyly|loyly/i, '🧖'],
  [/swim|harbour bath|harbor bath|beach|island|archipelago|skerr/i, '🏝️'],
  [/market|torvehallerne|market hall|saluhall|kauppahalli|torg market/i, '🛍️'],
  [/zoo|aquarium|akvariet/i, '🐧'],
  [/amusement|roller ?coaster|fairground|liseberg/i, '🎢'],
  [/park|forest|nature reserve|woods/i, '🌲'],
  [/tower|tårn|tarn|torni|spire/i, '🗼'],
  [/bridge|øresund|oresund/i, '🌉'],
  [/harbor|harbour|nyhavn|port\b|quay|brygge|wharf|waterfront/i, '⚓'],
  [/opera|theatre|theater|concert|jazz|music|festival/i, '🎵'],
  [/design|architecture|street art|mural/i, '🎨'],
  // ---- food / drink ----
  [/coffee|café|cafe|fika|espresso|roastery/i, '☕'],
  [/pastry|wienerbrød|bakery|cinnamon|cardamom|bun|kanel|bulle|pulla/i, '🥐'],
  [/oyster|seafood|fish|herring|sild|shrimp|prawn|salmon|lax|laks|crab|lobster|reindeer? fish/i, '🐟'],
  [/hot ?dog|pølse|polse|sausage|street food/i, '🌭'],
  [/cheese|ost\b/i, '🧀'],
  [/reindeer|elk|moose|game|venison/i, '🦌'],
  [/meatball|köttbullar|kottbullar|husmanskost/i, '🍽️'],
  [/beer|brewery|pub|bar\b|cocktail|wine/i, '🍺'],
  [/smørrebrød|smorrebrod|sandwich/i, '🥪'],
  [/new nordic|tasting menu|fine dining|michelin|dinner|dining|destination dining/i, '✨'],
];

export function itemEmoji(item) {
  if (!item) return '📍';
  if (item.emoji) return item.emoji;
  const hay = `${item.name || ''} ${(item.tags || []).join(' ')}`;
  for (const [re, em] of RULES) {
    if (re.test(hay)) return em;
  }
  return TYPE_FALLBACK[item.type] || '📍';
}
