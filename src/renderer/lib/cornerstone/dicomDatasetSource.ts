import { wadouri } from '@cornerstonejs/dicom-image-loader';

export type DatasetLoadRequest = Parameters<typeof wadouri.dataSetCacheManager.load>[1];

/** The wadouri URI for an imageId (the `wadouri:` scheme prefix stripped). */
export function toWadouriUri(imageId: string): string {
  return imageId.startsWith('wadouri:') ? imageId.slice(8) : imageId;
}

/**
 * The dataSetCacheManager key and request fn for an imageId — the same pair the wadouri
 * image loader and metadata provider use. A local `dicomfile:N` id is cached under its
 * fileManager index `N` and read with FileReader; passed through as-is it was XHR'd as the
 * URL "dicomfile:N", failed, and left no metadata for local imports — and every reader
 * that keyed the cache by the raw id found nothing for a local file.
 */
export function datasetSource(imageId: string): {
  uri: string;
  /** `undefined` selects the cache manager's default request fn (xhrRequest). */
  loadRequest: DatasetLoadRequest | undefined;
} {
  if (imageId.startsWith('dicomfile:')) {
    return {
      uri: wadouri.parseImageId(imageId).url,
      loadRequest: wadouri.getLoaderForScheme('dicomfile') as DatasetLoadRequest,
    };
  }
  return { uri: toWadouriUri(imageId), loadRequest: undefined };
}
