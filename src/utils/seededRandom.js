// Simple seeded random number generator using xorshift
export function seededRandom(seed) {
  let x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

// Pick a deterministic item from an array using a seed
export function pickByIndex(items, seed) {
  if (!items || items.length === 0) return null;
  const index = Math.floor(seededRandom(seed) * items.length);
  return items[index];
}
