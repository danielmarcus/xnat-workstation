/**
 * AI Image Capture — captures viewport canvas + DICOM metadata for AI analysis.
 *
 * Provides functions to capture the current viewport as a PNG data URL,
 * extract DICOM metadata (modality, series description, body part, patient info),
 * and build a complete AiAnalysisRequest ready for IPC to the main process.
 *
 * For CT modality, supports multi-window capture: temporarily applies standard
 * W/L presets (soft tissue, lung, bone), captures each, then restores original.
 */
import { metaData } from '@cornerstonejs/core';
import { viewportService } from './cornerstone/viewportService';
import type { AiAnalysisRequest } from '../../shared/types/ai';

// ─── CT Window Presets ──────────────────────────────────────────

const CT_WINDOWS = [
  { name: 'Soft Tissue', ww: 400, wc: 40 },
  { name: 'Lung', ww: 1500, wc: -600 },
  { name: 'Bone', ww: 2000, wc: 400 },
] as const;

// ─── Internal Helpers ───────────────────────────────────────────

/**
 * Safely read a string from a metadata field.
 * Handles the common Cornerstone3D pattern where values may be
 * undefined, null, objects, or strings.
 */
function toStr(val: unknown): string {
  if (val === undefined || val === null) return '';
  if (typeof val === 'string') return val;
  // Cornerstone sometimes wraps names in { Alphabetic: "..." }
  if (typeof val === 'object' && val !== null && 'Alphabetic' in val) {
    return String((val as Record<string, unknown>).Alphabetic ?? '');
  }
  return String(val);
}

/**
 * Capture the canvas of a given viewport as a PNG data URL.
 */
function captureCanvas(viewportId: string): string | null {
  const viewport = viewportService.getViewport(viewportId);
  if (!viewport) return null;

  try {
    const canvas = viewport.getCanvas();
    return canvas.toDataURL('image/png');
  } catch (err) {
    console.error('[aiImageCapture] Canvas capture failed:', err);
    return null;
  }
}

/**
 * Get the current image ID from a viewport.
 */
function getCurrentImageId(viewportId: string): string | null {
  const viewport = viewportService.getViewport(viewportId);
  if (!viewport) return null;

  try {
    return viewport.getCurrentImageId() ?? null;
  } catch {
    return null;
  }
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Capture the current viewport as a PNG data URL.
 * Returns null if the viewport is not found or capture fails.
 */
export function captureCurrentView(viewportId: string): string | null {
  return captureCanvas(viewportId);
}

/**
 * For CT scans, capture additional window/level presets.
 * Temporarily applies each W/L preset, captures, then restores original.
 * Returns an array of { name, dataUrl } for each window preset.
 */
export function captureMultiWindow(
  viewportId: string,
): Array<{ name: string; dataUrl: string }> {
  const viewport = viewportService.getViewport(viewportId);
  if (!viewport) return [];

  const results: Array<{ name: string; dataUrl: string }> = [];

  try {
    // Save current VOI state
    const props = viewport.getProperties();
    const originalVoi = props.voiRange;

    for (const preset of CT_WINDOWS) {
      // Apply preset W/L
      const lower = preset.wc - preset.ww / 2;
      const upper = preset.wc + preset.ww / 2;
      viewport.setProperties({ voiRange: { lower, upper } });
      viewport.render();

      // Capture
      const canvas = viewport.getCanvas();
      const dataUrl = canvas.toDataURL('image/png');
      results.push({ name: preset.name, dataUrl });
    }

    // Restore original VOI
    if (originalVoi) {
      viewport.setProperties({ voiRange: originalVoi });
      viewport.render();
    }
  } catch (err) {
    console.error('[aiImageCapture] Multi-window capture failed:', err);
  }

  return results;
}

/**
 * Extract DICOM metadata from the current image for clinical context.
 * Uses Cornerstone3D's metadata providers (patientModule, generalSeriesModule, etc.)
 */
export function getImageMetadata(viewportId: string): {
  modality: string;
  seriesDescription: string;
  bodyPart: string;
  sliceInfo: string;
  studyDescription: string;
  patientAge: string;
  patientSex: string;
} {
  const imageId = getCurrentImageId(viewportId);
  const defaults = {
    modality: '',
    seriesDescription: '',
    bodyPart: '',
    sliceInfo: '',
    studyDescription: '',
    patientAge: '',
    patientSex: '',
  };

  if (!imageId) return defaults;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const series: any = metaData.get('generalSeriesModule', imageId) ?? {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patient: any = metaData.get('patientModule', imageId) ?? {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const study: any = metaData.get('generalStudyModule', imageId) ?? {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const imagePlane: any = metaData.get('imagePlaneModule', imageId) ?? {};

    // Slice info
    const viewport = viewportService.getViewport(viewportId);
    let sliceInfo = '';
    if (viewport) {
      const currentIdx = viewport.getCurrentImageIdIndex();
      const total = viewport.getImageIds().length;
      sliceInfo = `Slice ${currentIdx + 1} of ${total}`;
      if (imagePlane.sliceLocation) {
        sliceInfo += ` (location: ${imagePlane.sliceLocation})`;
      }
    }

    return {
      modality: toStr(series.modality),
      seriesDescription: toStr(series.seriesDescription),
      bodyPart: toStr(series.bodyPartExamined),
      sliceInfo,
      studyDescription: toStr(study.studyDescription),
      patientAge: toStr(patient.patientAge),
      patientSex: toStr(patient.patientSex),
    };
  } catch (err) {
    console.warn('[aiImageCapture] Error reading metadata:', err);
    return defaults;
  }
}

/**
 * Build a complete AiAnalysisRequest from the current viewport.
 * Captures the image, extracts metadata, and for CT adds multi-window views.
 */
export function buildAnalysisRequest(viewportId: string): AiAnalysisRequest | null {
  // Capture primary image
  const imageDataUrl = captureCurrentView(viewportId);
  if (!imageDataUrl) {
    console.error('[aiImageCapture] Failed to capture viewport');
    return null;
  }

  // Get metadata
  const meta = getImageMetadata(viewportId);
  const modality = meta.modality || 'UNKNOWN';

  // For CT, capture additional window views
  let additionalWindows: Array<{ name: string; dataUrl: string }> | undefined;
  if (modality.toUpperCase() === 'CT') {
    additionalWindows = captureMultiWindow(viewportId);
    if (additionalWindows.length === 0) {
      additionalWindows = undefined;
    }
  }

  return {
    imageDataUrl,
    modality,
    seriesDescription: meta.seriesDescription || undefined,
    bodyPart: meta.bodyPart || undefined,
    sliceInfo: meta.sliceInfo || undefined,
    studyDescription: meta.studyDescription || undefined,
    patientAge: meta.patientAge || undefined,
    patientSex: meta.patientSex || undefined,
    additionalWindows,
  };
}
