// A few local phrases per country, printed at the foot of the daily receipt (and
// shown on the on-screen brief). Curated + concise so they fit a narrow slip —
// the useful traveler basics: a greeting, thanks, please, a toast, and a coffee.
// Diacritics are intentional (they render as pixels on the thermal print).

export const LOCAL_PHRASES = {
  Denmark: {
    lang: 'Danish',
    items: [
      ['Hello', 'Hej'],
      ['Thank you', 'Tak'],
      ['Please', 'Vær så god'],
      ['Cheers!', 'Skål!'],
      ['A coffee, please', 'En kaffe, tak'],
    ],
  },
  Norway: {
    lang: 'Norwegian',
    items: [
      ['Hello', 'Hei'],
      ['Thank you', 'Takk'],
      ['Please', 'Vær så snill'],
      ['Cheers!', 'Skål!'],
      ['A coffee, please', 'En kaffe, takk'],
    ],
  },
  Sweden: {
    lang: 'Swedish',
    items: [
      ['Hello', 'Hej'],
      ['Thank you', 'Tack'],
      ['You’re welcome', 'Varsågod'],
      ['Cheers!', 'Skål!'],
      ['A coffee, please', 'En kaffe, tack'],
    ],
  },
  Finland: {
    lang: 'Finnish',
    items: [
      ['Hello', 'Moi'],
      ['Thank you', 'Kiitos'],
      ['Please', 'Ole hyvä'],
      ['Cheers!', 'Kippis!'],
      ['A coffee, please', 'Yksi kahvi, kiitos'],
    ],
  },
  Estonia: {
    lang: 'Estonian',
    items: [
      ['Hello', 'Tere'],
      ['Thank you', 'Aitäh'],
      ['Please', 'Palun'],
      ['Cheers!', 'Terviseks!'],
      ['A coffee, please', 'Üks kohv, palun'],
    ],
  },
  Germany: {
    lang: 'German',
    items: [
      ['Hello', 'Servus'],
      ['Thank you', 'Danke'],
      ['Please', 'Bitte'],
      ['Cheers!', 'Prost!'],
      ['A coffee, please', 'Einen Kaffee, bitte'],
    ],
  },
};

export function phrasesForCountry(country) {
  return LOCAL_PHRASES[country] || null;
}
