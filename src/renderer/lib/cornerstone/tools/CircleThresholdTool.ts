/**
 * Circle Threshold: drag a circle, and everything inside it within the intensity window joins
 * the active segment — the circle counterpart of Rect Threshold, on the slice on screen.
 *
 * It is Cornerstone's Circle scissors with the brush's circle-threshold strategy in place of its
 * fill. Rect Threshold's route (draw an ROI annotation, then fill it with
 * `rectangleROIThresholdVolumeByRange`) has no circle equivalent: that utility rejects any other
 * annotation. The scissors already draw the circle, write it as one undo step and honour segment
 * locks, and their in-circle test runs in the view's own axes, so an oblique reformat fills what
 * is on screen.
 *
 * The scissors never hand the tool's configuration to the strategy (their operation data is
 * built from `editData` alone), and Cornerstone's threshold test passes EVERY voxel when it finds
 * no range — so without the window injected here this fills the whole circle. The window is read
 * from the store when the drag ends, as Rect Threshold does, so it is always the one the panel
 * shows. Its bounds are inclusive.
 */
import { CircleScissorsTool } from '@cornerstonejs/tools';
// Published subpath export (package.json "./tools/*"): the strategy is not re-exported at the root.
import { thresholdInsideCircle } from '@cornerstonejs/tools/tools/segmentation/strategies/fillCircle';
import { useSegmentationStore } from '../../../stores/segmentationStore';

type ApplyArgs = Parameters<CircleScissorsTool['applyActiveStrategy']>;

export class CircleThresholdTool extends CircleScissorsTool {
  static toolName = 'CircleThreshold';

  constructor(toolProps = {}) {
    super(toolProps, {
      supportedInteractionTypes: ['Mouse', 'Touch'],
      configuration: {
        strategies: { THRESHOLD_INSIDE: thresholdInsideCircle },
        defaultStrategy: 'THRESHOLD_INSIDE',
        activeStrategy: 'THRESHOLD_INSIDE',
      },
    });
  }

  applyActiveStrategy(enabledElement: ApplyArgs[0], operationData: ApplyArgs[1]) {
    const [a, b] = useSegmentationStore.getState().thresholdRange;
    const range: [number, number] = a <= b ? [a, b] : [b, a];
    return super.applyActiveStrategy(enabledElement, {
      ...(operationData as object),
      configuration: { ...this.configuration, threshold: { ...this.configuration.threshold, range } },
    });
  }
}
