// WikiTravel URL helpers. City pages use underscores; section anchors match WT headings.

const CITY_PAGE = {
  copenhagen: 'Copenhagen',
  aarhus: 'Aarhus',
  aero: 'Ærø',
  kalmar: 'Kalmar',
  stockholm: 'Stockholm',
  helsinki: 'Helsinki',
  oslo: 'Oslo',
  flam: 'Flåm',
  bergen: 'Bergen',
  gothenburg: 'Gothenburg',
  malmo: 'Malmö',
  tromso: 'Tromsø',
  lofoten: 'Lofoten',
  tallinn: 'Tallinn',
  munich: 'Munich',
};

export function wikiTravelCityPage(cityId, cityName) {
  const page = CITY_PAGE[cityId] || cityName || '';
  return `https://wikitravel.org/en/${encodeURIComponent(page.replace(/ /g, '_'))}`;
}

export function wikiTravelUrl(cityId, cityName, section) {
  const base = wikiTravelCityPage(cityId, cityName);
  if (!section) return base;
  return `${base}#${encodeURIComponent(section.replace(/ /g, '_'))}`;
}
