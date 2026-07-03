// The two travelers. Photos are vendored locally (LinkedIn CDN links expire and
// block hotlinking, so they never loaded in-app) — every avatar still renders
// the tinted-initial fallback first and fades the photo in once it loads.
export const PEOPLE = [
  {
    name: 'Tyler',
    tint: '#10b981', // emerald — matches Tyler's color everywhere else
    photo: '/assets/people/tyler.jpg',
  },
  {
    name: 'Edwin',
    tint: '#6a8160', // sage — matches Edwin's color everywhere else
    photo: '/assets/people/edwin.jpg',
  },
];

export function personByName(name) {
  return PEOPLE.find((p) => p.name === name) || null;
}
