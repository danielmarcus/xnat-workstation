/**
 * Geometry-split 4D / multi-volume (functional) volume loader.
 *
 * Cornerstone's built-in cornerstoneStreamingDynamicImageVolumeLoader splits image
 * ids into time points with splitImageIdsBy4DTags, which only recognizes
 * vendor-tagged 4D (cardiac TriggerTime / diffusion) — NOT a generic EPI perfusion
 * series. This loader is the SAME as Cornerstone's, EXCEPT it splits by GEOMETRY:
 * the same ImagePositionPatient repeated across the series ⇒ multiple time points
 * (confirmed correct on real data via 275bcba). Everything else uses Cornerstone's
 * own exported builders, so the resulting StreamingDynamicImageVolume behaves like
 * a natively-detected one — including `volume.dimensionGroupNumber` for instant,
 * view-preserving time-point switching (the scrubber).
 */
import {
  StreamingDynamicImageVolume,
  metaData,
  utilities as csUtilities,
} from '@cornerstonejs/core';

/** Scheme this loader is registered under (see init). */
export const GEOMETRY_DYNAMIC_VOLUME_SCHEME = 'xnatGeometryDynamicVolume';

function ippKey(ipp: number[]): string {
  return `${ipp[0].toFixed(2)},${ipp[1].toFixed(2)},${ipp[2].toFixed(2)}`;
}

/**
 * Split image ids into TIME-POINT groups by geometry: group by ImagePositionPatient
 * (each position is imaged once per time point), then transpose so group[t] holds
 * every position's t-th image — the full spatial stack for time point t. Returns a
 * SINGLE group (not 4D) when positions don't repeat or geometry is missing. Pure
 * read of metadata; exported for unit testing.
 */
export function splitImageIdsIntoTimepointGroups(imageIds: string[]): string[][] {
  const byPosition = new Map<string, string[]>();
  const order: string[] = []; // position keys in first-seen (≈ spatial) order
  for (const id of imageIds) {
    const ipp = (metaData.get('imagePlaneModule', id) as { imagePositionPatient?: number[] } | undefined)
      ?.imagePositionPatient;
    if (!Array.isArray(ipp) || ipp.length < 3) return [imageIds]; // incomplete geometry → one group
    const key = ippKey(ipp);
    let bucket = byPosition.get(key);
    if (!bucket) {
      bucket = [];
      byPosition.set(key, bucket);
      order.push(key);
    }
    bucket.push(id);
  }
  const numTimepoints = Math.max(...[...byPosition.values()].map((g) => g.length));
  if (numTimepoints <= 1) return [imageIds]; // not 4D
  const groups: string[][] = [];
  for (let t = 0; t < numTimepoints; t++) {
    const group: string[] = [];
    for (const key of order) {
      const imgs = byPosition.get(key)!;
      if (t < imgs.length) group.push(imgs[t]);
    }
    groups.push(group);
  }
  return groups;
}

/** True when a series is 4D / multi-volume by geometry (positions repeat). */
export function isMultiVolumeSeries(imageIds: string[]): boolean {
  return splitImageIdsIntoTimepointGroups(imageIds).length > 1;
}

/** Number of time points in a (4D) series; 1 for a normal 3D series. */
export function timepointCount(imageIds: string[]): number {
  return splitImageIdsIntoTimepointGroups(imageIds).length;
}

/**
 * Volume loader (registered for GEOMETRY_DYNAMIC_VOLUME_SCHEME). Mirrors
 * Cornerstone's cornerstoneStreamingDynamicImageVolumeLoader, substituting the
 * geometry split. The `as never` casts bridge Cornerstone's internal volume-props
 * types (the same shapes its own loader passes).
 */
export function geometryDynamicVolumeLoader(
  volumeId: string,
  options: { imageIds: string[] },
): { promise: Promise<StreamingDynamicImageVolume>; decache: () => void; cancel: () => void } {
  if (!options?.imageIds?.length) {
    throw new Error('ImageIds must be provided to create a 4D streaming image volume');
  }
  const imageIdGroups = splitImageIdsIntoTimepointGroups(options.imageIds);
  const splittingTag = 'ImagePositionPatient';

  const { generateVolumePropsFromImageIds, sortImageIdsAndGetSpacing, VoxelManager } = csUtilities;
  const middleIndex = Math.floor(imageIdGroups.length / 2);
  const volumeProps = generateVolumePropsFromImageIds(imageIdGroups[middleIndex], volumeId);
  const { metadata, dimensions, spacing, direction, sizeInBytes, origin, numberOfComponents, dataType } =
    volumeProps;
  const scanAxisNormal = direction.slice(6, 9);
  const sortedImageIdGroups = imageIdGroups.map(
    (ids) => sortImageIdsAndGetSpacing(ids, scanAxisNormal as never).sortedImageIds,
  );
  const sortedFlatImageIds = sortedImageIdGroups.flat();
  const voxelManager = VoxelManager.createScalarDynamicVolumeVoxelManager({
    dimensions,
    imageIdGroups: sortedImageIdGroups,
    dimensionGroupNumber: 1,
    numberOfComponents,
  });
  let volume: StreamingDynamicImageVolume | null = new StreamingDynamicImageVolume(
    {
      volumeId,
      metadata,
      dimensions,
      spacing,
      origin,
      direction,
      sizeInBytes,
      imageIds: sortedFlatImageIds,
      imageIdGroups: sortedImageIdGroups,
      splittingTag,
      voxelManager,
      numberOfComponents,
      dataType,
    } as never,
    {
      imageIds: sortedFlatImageIds,
      loadStatus: { loaded: false, loading: false, cancelled: false, cachedFrames: [], callbacks: [] },
    } as never,
  );
  return {
    promise: Promise.resolve(volume),
    decache: () => {
      volume?.destroy();
      volume = null;
    },
    cancel: () => {
      volume?.cancelLoading?.();
    },
  };
}
