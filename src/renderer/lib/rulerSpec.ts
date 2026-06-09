/**
 * Pure scale-bar math for the viewport rulers (no Cornerstone / DOM). Given the
 * on-screen scale (mm per display pixel) it picks a "nice" round length, clamps it
 * to the available space, and returns the bar's pixel length + label + tick count.
 * Pure ⇒ unit-tested directly.
 */
export interface RulerSpec {
  lengthPx: number;
  label: string;
  tickCount: number;
}

/** Round up to the nearest 1/2/5 × 10ⁿ (so labels read 1, 2, 5, 10, 20, 50 …). */
export function pickNiceMm(rawMm: number): number {
  if (!Number.isFinite(rawMm) || rawMm <= 0) return 0;
  const exponent = Math.floor(Math.log10(rawMm));
  const base = 10 ** exponent;
  const normalized = rawMm / base;
  if (normalized <= 1) return 1 * base;
  if (normalized <= 2) return 2 * base;
  if (normalized <= 5) return 5 * base;
  return 10 * base;
}

export function formatLengthMm(mm: number): string {
  if (!Number.isFinite(mm) || mm <= 0) return '';
  if (mm >= 100) return `${(mm / 10).toFixed(mm % 10 === 0 ? 0 : 1)} cm`;
  if (mm >= 10) return `${Math.round(mm)} mm`;
  return `${mm.toFixed(mm >= 1 ? 1 : 2)} mm`;
}

/**
 * Build a ruler bar ~targetLengthPx long (a nice round mm value), never exceeding
 * maxLengthPx and never shorter than ~44px. Returns null when there isn't enough
 * room or the scale is invalid.
 */
export function buildRulerSpec(
  mmPerDisplayPx: number,
  maxLengthPx: number,
  targetLengthPx: number,
): RulerSpec | null {
  if (!Number.isFinite(mmPerDisplayPx) || mmPerDisplayPx <= 0) return null;
  if (!Number.isFinite(maxLengthPx) || maxLengthPx <= 30) return null;
  if (!Number.isFinite(targetLengthPx) || targetLengthPx <= 0) return null;

  let lengthMm = pickNiceMm(mmPerDisplayPx * targetLengthPx);
  if (lengthMm <= 0) lengthMm = 50;

  let lengthPx = lengthMm / mmPerDisplayPx;
  while (lengthPx > maxLengthPx && lengthMm > 0.01) {
    let nextLengthMm = pickNiceMm(lengthMm / 2);
    // Guard against non-decreasing "nice" rounding that could stall the loop.
    if (nextLengthMm >= lengthMm) nextLengthMm = lengthMm / 2;
    if (nextLengthMm <= 0) break;
    lengthMm = nextLengthMm;
    lengthPx = lengthMm / mmPerDisplayPx;
  }
  while (lengthPx < 44) {
    let grown = pickNiceMm(lengthMm * 2);
    if (grown <= lengthMm) grown = lengthMm * 2;
    if (!Number.isFinite(grown) || grown <= lengthMm) break;
    const grownPx = grown / mmPerDisplayPx;
    if (grownPx > maxLengthPx) break;
    lengthMm = grown;
    lengthPx = grownPx;
  }

  if (!Number.isFinite(lengthPx) || lengthPx <= 0) return null;

  const tickCount = lengthPx >= 220 ? 10 : lengthPx >= 170 ? 8 : lengthPx >= 120 ? 6 : 4;
  return { lengthPx, label: formatLengthMm(lengthMm), tickCount };
}
