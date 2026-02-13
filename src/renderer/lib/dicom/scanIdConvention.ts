/**
 * Extract the source scan ID from a SEG scan ID using the 30xx convention.
 * Supports prefixes 30-39 (e.g., "3004" → "4", "3012" → "12", "3104" → "4").
 * Returns null if the scan ID doesn't follow the convention.
 */
export function getSourceScanId(segScanId: string): string | null {
  // Matches 30xx-39xx (manual SEG), 40xx-49xx (RTSTRUCT), 50xx-59xx (legacy auto-saves)
  const match = segScanId.match(/^([345]\d)(\d{2})$/);
  if (!match) return null;
  const sourceId = parseInt(match[2], 10);
  if (sourceId === 0) return null; // scan ID "0" is not valid
  return String(sourceId);
}
