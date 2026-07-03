export const DEFAULT_ACTOR = 'Edwin';

const CANONICAL_ACTORS = ['Edwin', 'Tyler'];

export function normalizeActorName(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  const match = CANONICAL_ACTORS.find((actor) => actor.toLowerCase() === raw.toLowerCase());
  return match || raw;
}

export function actorOrDefault(name, fallback = DEFAULT_ACTOR) {
  return normalizeActorName(name) || fallback;
}

export function sameActor(a, b) {
  const left = normalizeActorName(a).toLowerCase();
  const right = normalizeActorName(b).toLowerCase();
  return !!left && !!right && left === right;
}
