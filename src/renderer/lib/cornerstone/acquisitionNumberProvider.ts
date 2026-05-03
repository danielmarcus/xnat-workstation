/**
 * AcquisitionNumber metadata extension provider.
 *
 * The wadouri image-loader's `instance` metadata aggregate covers
 * generalSeriesModule, imagePlaneModule, sopCommonModule, etc., but it does
 * NOT surface DICOM `AcquisitionNumber` (0020,0012). The A2c branch of
 * `classifyForEligibility` (acceptance signal G10) needs AcquisitionNumber
 * on both sides to distinguish A2c (different acquisitions, same FoR) from
 * A2b (same acquisition, same FoR). With the gap, fixtures loaded via the
 * `dicomfile:` scheme classify as A2b regardless of acquisition.
 *
 * This module registers a Cornerstone metaData provider for the custom
 * type `'acquisitionNumberExtension'`. The visibility adapter
 * (`cornerstoneVisibilityAdapter.identityFromImageId`) consults this type
 * as a fallback when `instance.AcquisitionNumber` is null/missing. The
 * provider parses x00200012 from the wadouri-cached DICOM dataset; it is
 * a no-op for image IDs that wadouri's dataSetCacheManager doesn't know.
 */
import { metaData } from '@cornerstonejs/core';
import { wadouri } from '@cornerstonejs/dicom-image-loader';

export const ACQUISITION_NUMBER_EXTENSION = 'acquisitionNumberExtension';

export interface AcquisitionNumberExtensionResult {
  /** Parsed integer AcquisitionNumber, or null when absent / non-numeric. */
  AcquisitionNumber: number | null;
}

function toWadouriUri(imageId: string): string {
  // wadouri's `dataSetCacheManager` keys on the URL portion of the imageId —
  // the part after the first colon. Both `wadouri:` and `dicomfile:` schemes
  // strip the prefix; an imageId without a colon is passed through.
  if (imageId.startsWith('wadouri:')) return imageId.slice(8);
  if (imageId.startsWith('dicomfile:')) return imageId.slice(10);
  return imageId;
}

function toBaseInstanceUri(imageId: string): string {
  return toWadouriUri(imageId)
    .replace(/\/frames\/\d+(?=([/?#]|$))/gi, '')
    .replace(/([?&])frame=\d+(&?)/gi, (_match, separator: string, tail: string) => {
      if (tail) return separator === '?' ? '?' : separator;
      return '';
    });
}

function getCachedDataSet(imageId: string): { string?: (tag: string) => string | undefined } | null {
  const candidates = Array.from(new Set([toWadouriUri(imageId), toBaseInstanceUri(imageId)])).filter(Boolean);
  for (const uri of candidates) {
    try {
      const cache = (wadouri as { dataSetCacheManager?: { isLoaded?: (u: string) => boolean; get?: (u: string) => unknown } }).dataSetCacheManager;
      if (!cache) continue;
      if (cache.isLoaded?.(uri)) {
        const ds = cache.get?.(uri) as { string?: (tag: string) => string | undefined } | undefined;
        if (ds) return ds;
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

/**
 * Resolve AcquisitionNumber for the given imageId, parsing the wadouri-cached
 * DICOM dataset. Returns undefined when no cached dataset is available or
 * when the tag is missing — undefined signals "let the next provider try"
 * to Cornerstone's metaData.get chain.
 */
export function resolveAcquisitionNumber(imageId: string): AcquisitionNumberExtensionResult | undefined {
  if (!imageId) return undefined;
  const ds = getCachedDataSet(imageId);
  if (!ds || typeof ds.string !== 'function') return undefined;
  try {
    const raw = ds.string('x00200012');
    if (raw === undefined || raw === null || raw === '') {
      return { AcquisitionNumber: null };
    }
    const n = Number(raw);
    return { AcquisitionNumber: Number.isFinite(n) ? n : null };
  } catch {
    return undefined;
  }
}

let registered = false;

/**
 * Register the AcquisitionNumber extension provider on Cornerstone's
 * metaData chain. Idempotent — safe to call from multiple init paths.
 */
export function registerAcquisitionNumberProvider(): void {
  if (registered) return;
  registered = true;
  metaData.addProvider((type: string, imageId: string) => {
    if (type !== ACQUISITION_NUMBER_EXTENSION) return undefined;
    return resolveAcquisitionNumber(imageId);
  }, 100);
}

/** Test-only: reset the module's `registered` latch so vitest can re-register cleanly. */
export function _resetAcquisitionNumberProviderForTests(): void {
  registered = false;
}
