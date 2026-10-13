export function toCents(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

export function fromCents(cents) {
  const rounded = Math.sign(cents) * Math.floor(Math.abs(cents) + 0.5);
  return rounded / 100;
}

export function roundHalfUp(value, places = 2) {
  const scale = 10 ** places;
  return Math.sign(value) * Math.floor(Math.abs(value) * scale + 0.5) / scale;
}

export function sumPoints(values) {
  let cents = 0;
  for (const value of values) cents += toCents(value);
  return fromCents(cents);
}