// Opinionated starter day plans per catalog city — sourceIds only.
// These seed the FIRST day's order/intent; the builder then tops the first day
// up and distributes the remaining ranked sights across every later day, so each
// day of a stay gets a full schedule (see buildIdealDays in builders.js).

export const IDEAL_PLANS = {
  copenhagen: {
    breakfast: 'cph-pastry',
    morning: ['cph-nyhavn', 'cph-rosenborg'],
    lunch: 'cph-smorrebrod',
    afternoon: ['cph-bike'],
    dinner: null,
    evening: ['cph-tivoli'],
  },
  aarhus: {
    morning: ['aar-dengamle'],
    lunch: 'aar-seafood',
    afternoon: ['aar-aros'],
    evening: ['aar-latin'],
  },
  aero: {
    morning: ['aero-town'],
    lunch: 'aero-smoked',
    afternoon: ['aero-bike'],
    evening: ['aero-huts'],
  },
  kalmar: {
    morning: ['kal-castle'],
    lunch: null,
    afternoon: ['kal-oldtown'],
    dinner: 'kal-swedish',
  },
  stockholm: {
    breakfast: 'sto-fika',
    morning: ['sto-gamlastan'],
    lunch: 'sto-meatballs',
    afternoon: ['sto-vasa'],
    evening: ['sto-archipelago'],
  },
  helsinki: {
    breakfast: 'hel-korvapuusti',
    morning: ['hel-senate'],
    lunch: 'hel-market',
    afternoon: ['hel-suomenlinna'],
    evening: ['hel-sauna'],
  },
  oslo: {
    morning: ['osl-vigeland'],
    lunch: 'osl-salmon',
    afternoon: ['osl-munch'],
    evening: ['osl-operahouse'],
  },
  flam: {
    morning: ['flam-railway'],
    lunch: 'flam-aurland',
    afternoon: ['flam-cruise'],
    evening: ['flam-stegastein'],
  },
  bergen: {
    morning: ['ber-bryggen'],
    lunch: 'ber-fiskesuppe',
    afternoon: ['ber-floyen'],
    dinner: null,
    evening: ['ber-fishmarket'],
  },
  gothenburg: {
    breakfast: null,
    morning: ['got-haga'],
    lunch: 'got-rakmacka',
    afternoon: ['got-feskekorka'],
    evening: ['got-archipelago'],
  },
  malmo: {
    morning: ['mal-lillatorg'],
    lunch: 'mal-falafel',
    afternoon: ['mal-torso'],
    dinner: null,
    evening: ['mal-ribersborg'],
  },
  tromso: {
    morning: ['tro-fjellheisen'],
    lunch: 'tro-seafood',
    afternoon: ['tro-midnightsun'],
    evening: ['tro-arctic-cathedral'],
  },
  tallinn: {
    morning: ['tal-oldtown'],
    lunch: 'tal-blackbread',
    afternoon: ['tal-toompea'],
    evening: ['tal-telliskivi'],
  },
  geiranger: {
    morning: ['gei-dalsnibba'],
    lunch: 'gei-eat',
    afternoon: ['gei-fjordcruise'],
    evening: ['gei-flydalsjuvet'],
  },
  stavanger: {
    morning: ['sta-preikestolen'],
    lunch: 'sta-seafood',
    afternoon: ['sta-gamle'],
    evening: ['sta-lysefjord'],
  },
};
