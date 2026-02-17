import { BaseVolumeViewport, cache, getEnabledElement, utilities as csUtilities } from '@cornerstonejs/core';
import { PaintFillTool, segmentation as csSegmentation } from '@cornerstonejs/tools';

const { transformWorldToIndex } = csUtilities;
const coreUtils = csUtilities as any;
const DefaultHistoryMemo = coreUtils.HistoryMemo?.DefaultHistoryMemo;
const { VoxelManager, RLEVoxelMap, uuidv4 } = coreUtils;

const MAX_BACKGROUND_FILL_RATIO = 0.95;

type FillPoint = [number, number];

type PaintFillMemo = {
  id: string;
  operationType: 'labelmap';
  segmentationId: string;
  segmentationVoxelManager: any;
  voxelManager: any;
  undoVoxelManager?: any;
  redoVoxelManager?: any;
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
  const useVoxelManager = isUndo === false ? this.redoVoxelManager : this.undoVoxelManager;
  if (!useVoxelManager) return;

  useVoxelManager.forEach(({ value, pointIJK }: { value: number; pointIJK: [number, number, number] }) => {
    this.segmentationVoxelManager.setAtIJKPoint(pointIJK, value);
  });

  const slices = useVoxelManager.getArrayOfModifiedSlices();
  csSegmentation.triggerSegmentationEvents.triggerSegmentationDataModified(this.segmentationId, slices);
}

function commitPaintFillMemo(this: PaintFillMemo): boolean {
  if (this.redoVoxelManager) return true;
  if (!this.voxelManager?.modifiedSlices?.size) return false;

  const undoVoxelManager = VoxelManager.createRLEHistoryVoxelManager(this.segmentationVoxelManager);
  RLEVoxelMap.copyMap(undoVoxelManager.map, this.voxelManager.map);
  for (const key of this.voxelManager.modifiedSlices.keys()) {
    undoVoxelManager.modifiedSlices.add(key);
  }
  this.undoVoxelManager = undoVoxelManager;

  const redoVoxelManager = VoxelManager.createRLEVolumeVoxelManager({
    dimensions: this.segmentationVoxelManager.dimensions,
  });
  this.redoVoxelManager = redoVoxelManager;

  undoVoxelManager.forEach(({ index, pointIJK, value }: { index: number; pointIJK: [number, number, number]; value: number }) => {
    const currentValue = this.segmentationVoxelManager.getAtIJKPoint(pointIJK);
    if (currentValue === value) return;
    redoVoxelManager.setAtIndex(index, currentValue);
  });

  return true;
}

function createPaintFillMemo(segmentationId: string, segmentationVoxelManager: any): PaintFillMemo {
  const voxelManager = VoxelManager.createRLEHistoryVoxelManager(segmentationVoxelManager);
  return {
    id: uuidv4(),
    operationType: 'labelmap',
    segmentationId,
    segmentationVoxelManager,
    voxelManager,
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
      if (segmentsLocked.includes(clickedLabelValue)) return true;

      const flooded = floodFill2D(floodFillGetter, inPlaneSeedPoint);
      if (!flooded.length) return true;

      if (clickedLabelValue === 0) {
        const planePixels =
          fixedDimension === 0
            ? dimensions[1] * dimensions[2]
            : fixedDimension === 1
              ? dimensions[0] * dimensions[2]
              : dimensions[0] * dimensions[1];
        const fillRatio = flooded.length / Math.max(planePixels, 1);
        if (fillRatio >= MAX_BACKGROUND_FILL_RATIO) {
          console.warn(
            `[SafePaintFillTool] Ignored oversized background fill (${(fillRatio * 100).toFixed(1)}% of slice).`,
          );
          return true;
        }
      }

      const memo = createPaintFillMemo(segmentationId, voxelManager);
      const memoVoxelManager = memo.voxelManager;

      for (const pt of flooded) {
        const scalarDataIndex = getScalarDataPositionFromPlane(pt[0], pt[1]);
        memoVoxelManager.setAtIndex(scalarDataIndex, activeSegmentIndex);
      }

      const committed = memo.commitMemo();
      if (committed && DefaultHistoryMemo?.push) {
        DefaultHistoryMemo.push(memo);
      }

      const framesModified = (this as any).getFramesModified(fixedDimension, fixedDimensionValue, { flooded });
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
