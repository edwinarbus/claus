// Small id helper. Avoids crypto dependency; good enough for local-first ids.
let counter = 0;

export function uid(prefix = 'id') {
  counter += 1;
  const rand = Math.floor(performance.now() * 1000).toString(36);
  return `${prefix}_${rand}_${counter.toString(36)}`;
}
