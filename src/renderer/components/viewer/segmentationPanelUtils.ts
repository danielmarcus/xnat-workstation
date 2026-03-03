import type { SegmentationDicomType } from '../../stores/segmentationStore';

export const DEFAULT_COLOR_PALETTE: [number, number, number, number][] = [
  [220, 50, 50, 255],
  [50, 200, 50, 255],
  [50, 100, 220, 255],
  [230, 200, 40, 255],
  [200, 50, 200, 255],
  [50, 200, 200, 255],
  [240, 140, 40, 255],
  [150, 80, 200, 255],
  [50, 220, 130, 255],
  [255, 130, 130, 255],
];

export function hexToRgbaColor(hex: string): [number, number, number, number] | null {
  const match = hex.trim().match(/^#?([0-9a-fA-F]{6})$/);
  if (!match) return null;
  const raw = match[1];
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  return [r, g, b, 255];
}

export function rgbaStr(c: [number, number, number, number]): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`;
}

export function isSegScanId(scanId: string): boolean {
  return /^3\d+$/.test(scanId);
}

export function isRtStructScanId(scanId: string): boolean {
  return /^4\d+$/.test(scanId);
}

export function isScanIdCompatibleWithType(scanId: string, type: SegmentationDicomType): boolean {
  return type === 'SEG' ? isSegScanId(scanId) : isRtStructScanId(scanId);
}

export function nextVersionedLabel(rawLabel: string): string {
  const trimmed = rawLabel.trim() || 'Annotation';
  const match = trimmed.match(/^(.*?)(?:_(\d+))$/);
  if (!match) {
    return `${trimmed}_01`;
  }
  const stem = (match[1] ?? '').trim() || 'Annotation';
  const current = parseInt(match[2], 10);
  const width = Math.max(2, match[2]?.length ?? 0);
  const next = Number.isFinite(current) ? current + 1 : 1;
  return `${stem}_${String(next).padStart(width, '0')}`;
}
