import type { XnatScan } from '@shared/types/xnat';
import {
  isDerivedScan,
  isRtStructScan,
  isSegScan,
  isSrScan,
} from '../../stores/sessionDerivedIndexStore';

const NON_THUMB_MODALITIES = new Set([
  'SR',
  'SEG',
  'RTSTRUCT',
  'RTPLAN',
  'RTDOSE',
  'RTRECORD',
  'REG',
  'KO',
  'PR',
]);

const NON_THUMB_SOP_CLASS_UID_PREFIXES = [
  '1.2.840.10008.5.1.4.1.1.88.',  // SR family
  '1.2.840.10008.5.1.4.1.1.11.',  // Presentation State family
  '1.2.840.10008.5.1.4.1.1.481.', // RT object family
];

const NON_THUMB_SOP_CLASS_UIDS = new Set([
  '1.2.840.10008.5.1.4.1.1.66.4',   // SEG
  '1.2.840.10008.5.1.4.1.1.481.3',  // RTSTRUCT
  '1.2.840.10008.5.1.4.1.1.66',     // Surface Segmentation
]);

export function scanSupportsThumbnail(scan: XnatScan): boolean {
  const xsiType = (scan.xsiType ?? '').trim().toLowerCase();
  if (
    xsiType === 'xnat:segscandata' ||
    xsiType === 'xnat:srscandata' ||
    xsiType === 'xnat:otherdicomscandata'
  ) {
    return false;
  }

  const sopClassUID = (scan.sopClassUID ?? '').trim();
  if (sopClassUID.length > 0) {
    if (
      NON_THUMB_SOP_CLASS_UIDS.has(sopClassUID)
      || NON_THUMB_SOP_CLASS_UID_PREFIXES.some((prefix) => sopClassUID.startsWith(prefix))
    ) {
      return false;
    }
    // Prefer SOP Class UID as the authoritative signal when available.
    return true;
  }

  const modality = (scan.modality ?? '').toUpperCase();
  const type = (scan.type ?? '').toUpperCase();
  const description = (scan.seriesDescription ?? '').toUpperCase();
  if (NON_THUMB_MODALITIES.has(modality) || NON_THUMB_MODALITIES.has(type)) {
    return false;
  }
  // Heuristics for sources that are effectively reports/objects, not image stacks.
  if (
    modality.includes('SR') ||
    type.includes('SR') ||
    type.includes('STRUCTURED') ||
    type.includes('REPORT') ||
    description.includes('STRUCTURED REPORT')
  ) {
    return false;
  }
  return true;
}

export function isStructuredReportScan(scan: XnatScan): boolean {
  if (isSrScan(scan)) return true;
  const sopClassUID = (scan.sopClassUID ?? '').trim();
  if (sopClassUID.startsWith('1.2.840.10008.5.1.4.1.1.88.')) {
    return true;
  }
  const modality = (scan.modality ?? '').toUpperCase();
  const type = (scan.type ?? '').toUpperCase();
  const description = (scan.seriesDescription ?? '').toUpperCase();
  return (
    modality === 'SR' ||
    type === 'SR' ||
    type.includes('STRUCTURED REPORT') ||
    description.includes('STRUCTURED REPORT')
  );
}

export function isBrowsableSourceScan(scan: XnatScan): boolean {
  const xsiType = (scan.xsiType ?? '').trim().toLowerCase();
  // xnat:otherDicomScanData may include RTSTRUCT (handled as derived) and
  // other non-primary SOP classes. Filter non-derived "other DICOM" for now.
  if (xsiType === 'xnat:otherdicomscandata' && !isRtStructScan(scan)) return false;
  return !isDerivedScan(scan) && !isStructuredReportScan(scan);
}

function toThumbCanvas(source: HTMLCanvasElement, size = 120): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.fillStyle = '#101014';
  ctx.fillRect(0, 0, size, size);
  const scale = Math.min(size / source.width, size / source.height);
  const drawWidth = Math.max(1, Math.round(source.width * scale));
  const drawHeight = Math.max(1, Math.round(source.height * scale));
  const x = Math.floor((size - drawWidth) / 2);
  const y = Math.floor((size - drawHeight) / 2);
  ctx.drawImage(source, x, y, drawWidth, drawHeight);
  return canvas;
}

export function getFirstNumber(value: unknown): number | null {
  if (Array.isArray(value)) {
    const n = Number(value[0]);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function toThumbnailDataUrl(image: any): string | null {
  try {
    if (typeof image?.getCanvas === 'function') {
      const sourceCanvas = image.getCanvas();
      if (sourceCanvas && sourceCanvas.width > 0 && sourceCanvas.height > 0) {
        return toThumbCanvas(sourceCanvas).toDataURL('image/jpeg', 0.82);
      }
    }
  } catch {
    // Fall through to pixel-data rendering.
  }

  const rows = Number(image?.rows ?? image?.height ?? 0);
  const cols = Number(image?.columns ?? image?.width ?? 0);
  const pixelData: ArrayLike<number> | undefined = image?.getPixelData?.();
  if (!rows || !cols || !pixelData || pixelData.length === 0) return null;

  const count = rows * cols;
  const isRgb = pixelData.length >= count * 3;
  const slope = Number(image?.slope ?? image?.rescaleSlope ?? 1) || 1;
  const intercept = Number(image?.intercept ?? image?.rescaleIntercept ?? 0) || 0;
  const wc = getFirstNumber(image?.windowCenter);
  const ww = getFirstNumber(image?.windowWidth);

  let low = 0;
  let high = 1;
  if (wc != null && ww != null && ww > 0) {
    low = wc - ww / 2;
    high = wc + ww / 2;
  } else {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < count; i++) {
      const raw = isRgb
        ? (Number(pixelData[i * 3]) + Number(pixelData[i * 3 + 1]) + Number(pixelData[i * 3 + 2])) / 3
        : Number(pixelData[i]);
      const value = raw * slope + intercept;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
      min = 0;
      max = 1;
    }
    low = min;
    high = max;
  }
  if (high <= low) high = low + 1;

  const mono1 = String(image?.photometricInterpretation ?? '')
    .toUpperCase()
    .includes('MONOCHROME1');

  const source = document.createElement('canvas');
  source.width = cols;
  source.height = rows;
  const ctx = source.getContext('2d');
  if (!ctx) return null;
  const imageData = ctx.createImageData(cols, rows);
  const out = imageData.data;

  for (let i = 0; i < count; i++) {
    const raw = isRgb
      ? (Number(pixelData[i * 3]) + Number(pixelData[i * 3 + 1]) + Number(pixelData[i * 3 + 2])) / 3
      : Number(pixelData[i]);
    const value = raw * slope + intercept;
    let gray = Math.round(((value - low) / (high - low)) * 255);
    gray = Math.max(0, Math.min(255, gray));
    if (mono1) gray = 255 - gray;

    const offset = i * 4;
    out[offset] = gray;
    out[offset + 1] = gray;
    out[offset + 2] = gray;
    out[offset + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  return toThumbCanvas(source).toDataURL('image/jpeg', 0.82);
}

export {
  isSegScan,
};
