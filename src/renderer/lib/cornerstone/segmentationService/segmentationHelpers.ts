export function findFirstNonZeroRef(adapterImages: any[]): {
  referencedImageId: string | null;
  labelmapImageId: string | null;
} {
  for (const img of adapterImages) {
    if (!img) continue;
    let pixels: any = null;
    try {
      if (img.voxelManager) pixels = img.voxelManager.getScalarData();
      else if (typeof img.getPixelData === 'function') pixels = img.getPixelData();
    } catch {
      pixels = null;
    }
    if (!pixels) continue;
    for (let k = 0; k < pixels.length; k++) {
      if (pixels[k] !== 0) {
        return {
          referencedImageId: img.referencedImageId ?? null,
          labelmapImageId: img.imageId ?? null,
        };
      }
    }
  }
  return { referencedImageId: null, labelmapImageId: null };
}

export function getValidSegmentIndices(seg: any): number[] {
  if (!seg?.segments) return [];
  const indices = new Set<number>();

  const pushIfValid = (value: unknown): void => {
    const idx = Number(value);
    if (Number.isFinite(idx) && Number.isInteger(idx) && idx > 0) {
      indices.add(idx);
    }
  };

  const addFromEntry = (key: unknown, segment: any): void => {
    pushIfValid(key);
    pushIfValid(segment?.segmentIndex);
  };

  if (seg.segments instanceof Map) {
    for (const [key, segment] of seg.segments.entries()) {
      addFromEntry(key, segment);
    }
  } else {
    for (const [key, segment] of Object.entries(seg.segments)) {
      addFromEntry(key, segment);
    }
  }

  return Array.from(indices).sort((a, b) => a - b);
}

export function segmentsToPlainObject(segments: any): Record<number, any> {
  const out: Record<number, any> = {};
  if (!segments) return out;
  if (segments instanceof Map) {
    for (const [key, segment] of segments.entries()) {
      const idx = Number((segment as any)?.segmentIndex ?? key);
      if (!Number.isFinite(idx) || idx <= 0 || !Number.isInteger(idx)) continue;
      out[idx] = segment;
    }
    return out;
  }
  for (const [key, segment] of Object.entries(segments)) {
    const idx = Number((segment as any)?.segmentIndex ?? key);
    if (!Number.isFinite(idx) || idx <= 0 || !Number.isInteger(idx)) continue;
    out[idx] = segment as any;
  }
  return out;
}

export function hasUsableColor(color: unknown): color is [number, number, number, number?] {
  if (!Array.isArray(color) || color.length < 3) return false;
  const r = Number(color[0]);
  const g = Number(color[1]);
  const b = Number(color[2]);
  const a = color.length >= 4 ? Number(color[3]) : 255;
  if (![r, g, b, a].every((v) => Number.isFinite(v))) return false;
  // Cornerstone can synthesize [0,0,0,0] for missing LUT entries.
  if (r === 0 && g === 0 && b === 0 && a === 0) return false;
  return true;
}

export function sanitizeSegmentIndices(indices: number[]): number[] {
  const valid = new Set<number>();
  for (const idx of indices) {
    if (Number.isFinite(idx) && Number.isInteger(idx) && idx > 0) {
      valid.add(idx);
    }
  }
  return Array.from(valid).sort((a, b) => a - b);
}

export function extractLabelmapImageId(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (value && typeof value === 'object' && typeof (value as any).imageId === 'string') {
    return (value as any).imageId;
  }
  return null;
}
