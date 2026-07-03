// Real hotels for the DEMO itinerary — one booked stay per city, injected into
// the lodging slots when the demo seeds its route (src/store/store.js). Common
// chains (Radisson, Hilton, Scandic) where they exist, and the real local hotel
// for the two small fjord/island stops. Coordinates pin the day-map/receipt.
export const DEMO_HOTELS = {
  copenhagen: {
    name: 'Radisson Collection Royal Hotel, Copenhagen',
    address: 'Hammerichsgade 1, 1611 København, Denmark',
    lat: 55.6748, lng: 12.5619,
  },
  aarhus: {
    name: 'Radisson Blu Scandinavia Hotel, Aarhus',
    address: 'Margrethepladsen 1, 8000 Aarhus, Denmark',
    lat: 56.1490, lng: 10.1980,
  },
  aero: {
    name: 'Hotel Ærøhus',
    address: 'Vestergade 38, 5970 Ærøskøbing, Denmark',
    lat: 54.8876, lng: 10.4108,
  },
  kalmar: {
    name: 'Scandic Kalmar Väst',
    address: 'Kalmar, Sweden',
    lat: 56.6690, lng: 16.3230,
  },
  stockholm: {
    name: 'Hilton Stockholm Slussen',
    address: 'Guldgränd 8, 104 65 Stockholm, Sweden',
    lat: 59.3190, lng: 18.0707,
  },
  helsinki: {
    name: 'Hilton Helsinki Strand',
    address: 'John Stenbergin ranta 4, 00530 Helsinki, Finland',
    lat: 60.1841, lng: 24.9616,
  },
  bergen: {
    name: 'Radisson Blu Royal Hotel, Bergen',
    address: 'Bryggen 5, 5003 Bergen, Norway',
    lat: 60.3970, lng: 5.3236,
  },
  flam: {
    name: 'Flåmsbrygga Hotel',
    address: 'Flåm, 5743 Aurland, Norway',
    lat: 60.8626, lng: 7.1137,
  },
  oslo: {
    name: 'Radisson Blu Scandinavia Hotel, Oslo',
    address: 'Holbergs gate 30, 0166 Oslo, Norway',
    lat: 59.9187, lng: 10.7332,
  },
};
