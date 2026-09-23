/**
 * Read a Cornerstone labelmap representation's storage, whichever shape it is in.
 *
 * Cornerstone 5 normalizes `representationData.Labelmap` into layers:
 * `{ labelmaps: { [id]: { storageKind, volumeId?, imageIds? } }, segmentBindings,
 * primaryLabelmapId }`. A segmentation attached to a VOLUME viewport stays a stack
 * layer there (v5 renders stack labelmaps on volume viewports natively), so code that
 * looked only at the 4.x top-level `volumeId` / `imageIds` saw nothing. This reads the
 * layers, and falls back to the top-level fields for data that has not been
 * normalized (or was built by hand).
 */
export interface LabelmapStorage {
  /** Volume-backed layers' volume ids. */
  volumeIds: string[];
  /** Stack-backed layers' labelmap imageIds (index i overlays source image i). */
  imageIdLists: string[][];
}

type LayerLike = { storageKind?: string; volumeId?: string; imageIds?: string[] };
type LabelmapLike = {
  labelmaps?: Record<string, LayerLike>;
  volumeId?: string;
  imageIds?: string[];
};

export function labelmapStorage(labelmap: unknown): LabelmapStorage {
  const lm = (labelmap ?? {}) as LabelmapLike;
  const out: LabelmapStorage = { volumeIds: [], imageIdLists: [] };
  const layers = lm.labelmaps ? Object.values(lm.labelmaps) : [];
  for (const layer of layers) {
    if (layer?.storageKind === 'volume' && typeof layer.volumeId === 'string') out.volumeIds.push(layer.volumeId);
    else if (Array.isArray(layer?.imageIds)) out.imageIdLists.push(layer.imageIds);
  }
  if (layers.length === 0) {
    if (typeof lm.volumeId === 'string' && lm.volumeId) out.volumeIds.push(lm.volumeId);
    else if (Array.isArray(lm.imageIds) && lm.imageIds.length > 0) out.imageIdLists.push(lm.imageIds);
  }
  return out;
}
