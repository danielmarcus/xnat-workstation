import { BaseVolumeViewport, cache, getEnabledElement, utilities as csUtilities } from '@cornerstonejs/core';
import { PaintFillTool, segmentation as csSegmentation } from '@cornerstonejs/tools';

const { transformWorldToIndex } = csUtilities;
const coreUtils = csUtilities as any;
const { uuidv4 } = coreUtils;

const MAX_BACKGROUND_FILL_RATIO = 0.9;

type FillPoint = [number, number];
type FillChange = {
  index: number;
  oldValue: number;
  newValue: number;
};

type PaintFillMemo = {
  id: string;
  operationType: 'labelmap';
  segmentationId: string;
  segmentationVoxelManager: any;
  changes: FillChange[];
  modifiedSlices: number[];
  restoreMemo: (isUndo: boolean) => void;
  commitMemo: () => boolean;
};

function floodFill2D(getter: (x: number, y: number) => number | undefined, seed: FillPoint): FillPoint[] {
  const seedValue = getter(seed[0], seed[1]);
  if (seedValue == null) return [];

  const flooded: FillPoint[] = [];
  const queue: FillPoint[] = [seed];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const [x, y] = queue.pop()!;
    const key = `${x},${y}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const value = getter(x, y);
    if (value !== seedValue) continue;

    flooded.push([x, y]);
    queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  return flooded;
}

function restorePaintFillMemo(this: PaintFillMemo, isUndo: boolean): void {
  for (const change of this.changes) {
    const nextValue = isUndo ? change.oldValue : change.newValue;
    this.segmentationVoxelManager.setAtIndex(change.index, nextValue);
  }
  csSegmentation.triggerSegmentationEvents.triggerSegmentationDataModified(
    this.segmentationId,
    this.modifiedSlices,
  );
}

function commitPaintFillMemo(this: PaintFillMemo): boolean {
  return this.changes.length > 0;
}

function createPaintFillMemo(
  segmentationId: string,
  segmentationVoxelManager: any,
  changes: FillChange[],
  modifiedSlices: number[],
): PaintFillMemo {
  return {
    id: uuidv4(),
    operationType: 'labelmap',
    segmentationId,
    segmentationVoxelManager,
    changes,
    modifiedSlices,
    restoreMemo: restorePaintFillMemo,
    commitMemo: commitPaintFillMemo,
  };
}

export class SafePaintFillTool extends PaintFillTool {
  static toolName = 'SafePaintFill';

  constructor(toolProps = {}, defaultToolProps = {}) {
    super(toolProps, defaultToolProps as any);

    this.preMouseDownCallback = (evt: any) => {
      const eventDetail = evt.detail;
      const { currentPoints, element } = eventDetail;
      const worldPos = currentPoints.world;
      const enabledElement = getEnabledElement(element);
      if (!enabledElement) return true;
      const { viewport } = enabledElement;
      const camera = viewport.getCamera();
      const { viewPlaneNormal } = camera;

      const activeSegmentationRepresentation = csSegmentation.activeSegmentation.getActiveSegmentation(viewport.id);
      if (!activeSegmentationRepresentation) {
        return true;
      }

      const { segmentationId } = activeSegmentationRepresentation;
      const activeSegmentIndex = csSegmentation.segmentIndex.getActiveSegmentIndex(segmentationId);
      if (!activeSegmentIndex || activeSegmentIndex <= 0) return true;

      // Block paint fill if the active segment is locked
      if (csSegmentation.segmentLocking.isSegmentIndexLocked(segmentationId, activeSegmentIndex)) {
        return true; // consume event, do nothing
      }

      this.doneEditMemo();

      const segmentsLocked = csSegmentation.segmentLocking.getLockedSegmentIndices(segmentationId);
      const segmentation = csSegmentation.state.getSegmentation(segmentationId) as any;
      if (!segmentation?.representationData) return true;

      let dimensions: number[] | undefined;
      let direction: number[] | undefined;
      let index: number[] | undefined;
      let voxelManager: any;

      if (viewport instanceof BaseVolumeViewport) {
        const { volumeId } = segmentation.representationData.Labelmap ?? {};
        if (!volumeId) return true;
        const segmentationVolume = cache.getVolume(volumeId) as any;
        if (!segmentationVolume) return true;
        ({ dimensions, direction } = segmentationVolume);
        voxelManager = segmentationVolume.voxelManager;
        index = transformWorldToIndex(segmentationVolume.imageData, worldPos) as number[];
      } else {
        const currentSegmentationImageId = csSegmentation.state.getCurrentLabelmapImageIdForViewport(
          viewport.id,
          segmentationId,
        );
        if (!currentSegmentationImageId) return true;
        const { imageData } = (viewport as any).getImageData();
        dimensions = imageData.getDimensions();
        direction = imageData.getDirection();
        const image = cache.getImage(currentSegmentationImageId) as any;
        voxelManager = image?.voxelManager;
        if (!voxelManager) return true;
        index = transformWorldToIndex(imageData, worldPos) as number[];
      }

      if (!dimensions || !direction || !index || !voxelManager) return true;

      const fixedDimension = (this as any).getFixedDimension(viewPlaneNormal, direction);
      if (fixedDimension === undefined) return true;

      const {
        floodFillGetter,
        getLabelValue,
        getScalarDataPositionFromPlane,
        inPlaneSeedPoint,
        fixedDimensionValue,
      } = (this as any).generateHelpers(voxelManager, dimensions, index, fixedDimension);

      if (
        index[0] < 0 || index[0] >= dimensions[0] ||
        index[1] < 0 || index[1] >= dimensions[1] ||
        index[2] < 0 || index[2] >= dimensions[2]
      ) {
        return true;
      }

      const clickedLabelValue = getLabelValue(index[0], index[1], index[2]);
      if ((segmentsLocked as number[]).includes(clickedLabelValue)) return true;

      const flooded = floodFill2D(floodFillGetter, inPlaneSeedPoint);
      if (!flooded.length) return true;

      const [planeWidth, planeHeight] =
        fixedDimension === 0
          ? [dimensions[1], dimensions[2]]
          : fixedDimension === 1
            ? [dimensions[0], dimensions[2]]
            : [dimensions[0], dimensions[1]];

      if (clickedLabelValue === 0) {
        const planePixels =
          planeWidth * planeHeight;
        const fillRatio = flooded.length / Math.max(planePixels, 1);
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (const [fx, fy] of flooded) {
          if (fx < minX) minX = fx;
          if (fy < minY) minY = fy;
          if (fx > maxX) maxX = fx;
          if (fy > maxY) maxY = fy;
        }
        const touchesLeft = minX <= 0;
        const touchesRight = maxX >= planeWidth - 1;
        const touchesTop = minY <= 0;
        const touchesBottom = maxY >= planeHeight - 1;
        const touchesAnyEdge = touchesLeft || touchesRight || touchesTop || touchesBottom;
        const touchesAllEdges = touchesLeft && touchesRight && touchesTop && touchesBottom;

        // Background regions connected to image borders are usually "outside"
        // clicks; suppress them to avoid accidental full-slice fills.
        if (touchesAnyEdge && fillRatio > 0.05) {
          console.warn(
            `[SafePaintFillTool] Ignored background fill connected to slice edge (${(fillRatio * 100).toFixed(1)}% of slice).`,
          );
          return true;
        }

        if (touchesAllEdges && fillRatio >= MAX_BACKGROUND_FILL_RATIO) {
          console.warn(
            `[SafePaintFillTool] Ignored oversized background fill (${(fillRatio * 100).toFixed(1)}% of slice).`,
          );
          return true;
        }
      }

      const changes: FillChange[] = [];

      for (const pt of flooded) {
        const scalarDataIndex = getScalarDataPositionFromPlane(pt[0], pt[1]);
        const oldValue = voxelManager.getAtIndex?.(scalarDataIndex) ?? clickedLabelValue;
        if (oldValue === activeSegmentIndex) continue;
        changes.push({
          index: scalarDataIndex,
          oldValue,
          newValue: activeSegmentIndex,
        });
      }

      if (changes.length === 0) {
        return true;
      }

      for (const change of changes) {
        voxelManager.setAtIndex(change.index, change.newValue);
      }

      const framesModified = (this as any).getFramesModified(fixedDimension, fixedDimensionValue, { flooded });
      const memo = createPaintFillMemo(segmentationId, voxelManager, changes, framesModified);
      (this as any).memo = memo;
      this.doneEditMemo();

      csSegmentation.triggerSegmentationEvents.triggerSegmentationDataModified(
        segmentationId,
        framesModified,
        activeSegmentIndex,
      );

      return true;
    };
  }
}

export default SafePaintFillTool;
