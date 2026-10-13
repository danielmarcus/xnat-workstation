/**
 * The Smart-tab tools (SegWorks parity branch 4) as Cornerstone tools, in the manner of the
 * app's Select tool: each consumes the press in `preMouseDownCallback` and drives its own
 * drag through window listeners, so no other tool acts on the gesture.
 *
 *  - Level Trace:   click → preview of the traced region (⏎ commits).
 *  - Smart Brush:   drag → paints the tissue under the brush; one undo step per stroke.
 *  - ROI limit:     drag a rectangle → confines Level Trace, Random Walker and Cleanup.
 *  - Random Walker: left-drag foreground seeds, right- or ⇧-drag background seeds.
 */
import { BaseTool } from '@cornerstonejs/tools';
import type { Types as ToolTypes } from '@cornerstonejs/tools';
import { semiAutoBridge as bridge } from './semiAutoBridge';

const getWorldPointFromClientPoint = (id: string, x: number, y: number) => bridge.clientToWorld?.(id, x, y) ?? null;

type Detail = ToolTypes.EventTypes.InteractionEventType['detail'] & { event?: MouseEvent };

/** Follow a drag that began on `viewportId` until release. */
function followDrag(viewportId: string, onMove: (world: number[]) => void, onUp: () => void): void {
  const move = (e: MouseEvent) => {
    const w = getWorldPointFromClientPoint(viewportId, e.clientX, e.clientY);
    if (w) onMove(w as number[]);
  };
  const up = () => {
    window.removeEventListener('mousemove', move, true);
    window.removeEventListener('mouseup', up, true);
    onUp();
  };
  window.addEventListener('mousemove', move, true);
  window.addEventListener('mouseup', up, true);
}

export class LevelTraceTool extends BaseTool {
  static toolName = 'XnatLevelTrace';
  constructor(toolProps = {}, defaultToolProps = { supportedInteractionTypes: ['Mouse'], configuration: {} }) {
    super(toolProps, defaultToolProps);
  }
  preMouseDownCallback = (evt: ToolTypes.EventTypes.InteractionEventType): boolean => {
    const { viewportId, currentPoints } = evt.detail as Detail;
    bridge.levelTraceAt?.(viewportId, currentPoints.world as number[]);
    return true;
  };
}

export class SmartBrushTool extends BaseTool {
  static toolName = 'XnatSmartBrush';
  constructor(toolProps = {}, defaultToolProps = { supportedInteractionTypes: ['Mouse'], configuration: {} }) {
    super(toolProps, defaultToolProps);
  }
  preMouseDownCallback = (evt: ToolTypes.EventTypes.InteractionEventType): boolean => {
    const { viewportId, currentPoints } = evt.detail as Detail;
    if (!bridge.smartBrushBegin?.(viewportId, currentPoints.world as number[])) return true;
    followDrag(viewportId, (w) => bridge.smartBrushExtend?.(w), () => bridge.smartBrushEnd?.());
    return true;
  };
}

export class RoiLimitTool extends BaseTool {
  static toolName = 'XnatRoiLimit';
  constructor(toolProps = {}, defaultToolProps = { supportedInteractionTypes: ['Mouse'], configuration: {} }) {
    super(toolProps, defaultToolProps);
  }
  preMouseDownCallback = (evt: ToolTypes.EventTypes.InteractionEventType): boolean => {
    const { viewportId, currentPoints, event } = evt.detail as Detail;
    const startClient = event ? [event.clientX, event.clientY] : null;
    if (!startClient) return true;
    const cornersFor = (cx: number, cy: number) => {
      const [x0, y0] = startClient;
      const pts = [[x0, y0], [cx, y0], [cx, cy], [x0, cy]].map(([x, y]) => getWorldPointFromClientPoint(viewportId, x, y));
      return pts.every(Boolean) ? (pts as number[][]) : null;
    };
    const first = cornersFor(startClient[0], startClient[1]);
    if (first) bridge.setRoi?.(viewportId, first);
    void currentPoints;
    const move = (e: MouseEvent) => {
      const c = cornersFor(e.clientX, e.clientY);
      if (c) bridge.setRoi?.(viewportId, c);
    };
    const up = () => {
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', up, true);
    };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up, true);
    return true;
  };
}

export class RandomWalkerSeedTool extends BaseTool {
  static toolName = 'XnatRandomWalkerSeeds';
  constructor(toolProps = {}, defaultToolProps = { supportedInteractionTypes: ['Mouse'], configuration: {} }) {
    super(toolProps, defaultToolProps);
  }
  preMouseDownCallback = (evt: ToolTypes.EventTypes.InteractionEventType): boolean => {
    const { viewportId, currentPoints, event } = evt.detail as Detail;
    const kind = event && (event.button === 2 || event.shiftKey) ? 'bg' : 'fg';
    bridge.addSeedStroke?.(viewportId, kind, currentPoints.world as number[]);
    followDrag(viewportId, (w) => bridge.extendSeedStroke?.(w), () => {});
    return true;
  };
}

/**
 * The Seeded segmentation operation's seed painter (branch 5, G2): a pointer mode the
 * operation turns on. Drag lays the chosen class (or erases); ⇧-drag lays Background — the
 * right button zooms in every viewport, so it cannot carry #104's "opposite class".
 */
export class SolverSeedTool extends BaseTool {
  static toolName = 'XnatSolverSeeds';
  constructor(toolProps = {}, defaultToolProps = { supportedInteractionTypes: ['Mouse'], configuration: {} }) {
    super(toolProps, defaultToolProps);
  }
  preMouseDownCallback = (evt: ToolTypes.EventTypes.InteractionEventType): boolean => {
    const { viewportId, currentPoints, event } = evt.detail as Detail;
    bridge.solverSeedBegin?.(viewportId, currentPoints.world as number[], !!event?.shiftKey);
    followDrag(viewportId, (w) => bridge.solverSeedExtend?.(w), () => {});
    return true;
  };
}

export const SEMI_AUTO_TOOLS = [LevelTraceTool, SmartBrushTool, RoiLimitTool, RandomWalkerSeedTool, SolverSeedTool];
