/**
 * The `generated:` image scheme: labelmap images the app creates in memory
 * (`imageLoader.createAndCacheLocalImage`) for its segmentation layers. They exist
 * only in Cornerstone's cache — there is nothing to fetch.
 *
 * Cornerstone still asks the image loader for them on some paths. In v5, a stack
 * labelmap that cannot be matched image-for-image to a viewport (the same series loaded
 * into a second viewport under new imageIds) is rendered through a geometry volume
 * built from the labelmap images; that volume has no `referencedImageIds`, so adding it
 * computes a default VOI by re-loading the middle image with `ignoreCache`. With no
 * loader registered for the scheme that threw, and the mask never appeared in a
 * viewport opened after painting. This loader serves the cached image, and fails
 * clearly if it has been evicted — which would mean real data loss, not a load miss.
 */
import { cache, type Types } from '@cornerstonejs/core';

export const GENERATED_IMAGE_SCHEME = 'generated';

export function generatedImageLoader(imageId: string): { promise: Promise<Types.IImage> } {
  const image = cache.getImage(imageId);
  return {
    promise: image
      ? Promise.resolve(image)
      : Promise.reject(new Error(`[generatedImageLoader] ${imageId} is not in the image cache`)),
  };
}
