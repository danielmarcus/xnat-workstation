/**
 * Scissor-tool subsystem for the tool service.
 *
 * Owns:
 *   - Scissor strategy state (`scissorShiftPressed`).
 *   - Strategy resolution helpers (primary, alternate, effective).
 *   - Preview-color helpers.
 *   - Cursor mapping (Cornerstone has no SVG for SphereScissors; CircleScissor
 *     stands in. CircleScissor lacks ERASE_INSIDE; ERASE_OUTSIDE is the
 *     visual proxy. These quirks live in `getScissorCursorStrategy`).
 *   - `patchScissorToolInstances` — wraps each scissor tool's
 *     `preMouseDownCallback` to consult the shift state at gesture-start
 *     and flip the strategy accordingly.
 *   - `applyScissorConfigurations` — sets the default strategies on the
 *     tool group and runs the patch.
 *   - Shift-key modifier listeners (window-scoped), which keep the cursor
 *     in step with the user's modifier state.
 *
 * Extracted from toolService.ts (Phase 0.6.A). No logic changes.
 *
 * Service-level dependencies are injected via `wireScissor()` to avoid a
 * circular import with toolService.ts. The orchestrator wires it up once
 * inside `toolService.initialize()`.
 */
import {
  CircleScissorsTool,
  RectangleScissorsTool,
  SphereScissorsTool,
  type Types as ToolTypes,
} from '@cornerstonejs/tools';
import { usePreferencesStore } from '../../../stores/preferencesStore';
import { ToolName } from '@shared/types/viewer';

// ─── Types & constants ───────────────────────────────────────────

export type ScissorStrategyName = 'FILL_INSIDE' | 'ERASE_INSIDE';

export type ScissorToolName =
  | ToolName.CircleScissors
  | ToolName.RectangleScissors
  | ToolName.SphereScissors;

export const SCISSOR_TOOLS: Set<ToolName> = new Set<ToolName>([
  ToolName.CircleScissors,
  ToolName.RectangleScissors,
  ToolName.SphereScissors,
]);

const SCISSOR_TOOL_NAMES = [
  CircleScissorsTool.toolName,
  RectangleScissorsTool.toolName,
  SphereScissorsTool.toolName,
] as const;

const SCISSOR_TOOL_PATCH_FLAG = '__xnatScissorToolPatched';

export function isScissorTool(toolName: ToolName): toolName is ScissorToolName {
  return SCISSOR_TOOLS.has(toolName);
}

type ScissorToolInstance = {
  preMouseDownCallback?: (evt: unknown) => unknown;
  editData?: {
    annotation?: {
      metadata?: {
        segmentColor?: [number, number, number, number];
      };
    };
    segmentColor?: [number, number, number, number];
  };
  [SCISSOR_TOOL_PATCH_FLAG]?: boolean;
};

// ─── Module-state ────────────────────────────────────────────────

let scissorShiftPressed = false;
let modifierListenersInstalled = false;

// ─── Dependency injection ────────────────────────────────────────

export interface ScissorDeps {
  /** The currently-active primary tool. */
  getCurrentActiveTool: () => ToolName;
  /** Map a logical ToolName to Cornerstone's tool name string. */
  getCsToolName: (toolName: ToolName) => string;
}

let deps: ScissorDeps = {
  getCurrentActiveTool: () => ToolName.WindowLevel,
  getCsToolName: () => '',
};

export function wireScissor(injected: ScissorDeps): void {
  deps = injected;
}

// ─── Helpers ─────────────────────────────────────────────────────

function hexToRgba(hex: string): [number, number, number, number] | null {
  const match = hex.trim().match(/^#?([0-9a-fA-F]{6})$/);
  if (!match) return null;
  const raw = match[1];
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  return [r, g, b, 180];
}

function getPrimaryScissorStrategy(): ScissorStrategyName {
  const pref = usePreferencesStore.getState().preferences.annotation.scissors.defaultStrategy;
  return pref === 'fill' ? 'FILL_INSIDE' : 'ERASE_INSIDE';
}

function getAlternateScissorStrategy(strategy: ScissorStrategyName): ScissorStrategyName {
  return strategy === 'ERASE_INSIDE' ? 'FILL_INSIDE' : 'ERASE_INSIDE';
}

export function getEffectiveScissorStrategy(): ScissorStrategyName {
  const primary = getPrimaryScissorStrategy();
  return scissorShiftPressed ? getAlternateScissorStrategy(primary) : primary;
}

function getScissorPreviewColor(): [number, number, number, number] {
  const configured = usePreferencesStore.getState().preferences.annotation.scissors.previewColor;
  return hexToRgba(configured) ?? [255, 255, 255, 180];
}

function getScissorDisplayColor(): [number, number, number, number] {
  const [r, g, b] = getScissorPreviewColor();
  return [r, g, b, 255];
}

function getScissorCursorStrategy(
  csToolName: string,
  strategy: ScissorStrategyName,
): { cursorToolName: string; cursorStrategy: string } {
  const normalizedToolName = csToolName.replace(/Scissors$/, 'Scissor');

  if (normalizedToolName === 'SphereScissor') {
    // Sphere scissors has no dedicated SVG cursor in Cornerstone; use circle cursor family.
    return {
      cursorToolName: 'CircleScissor',
      cursorStrategy: strategy === 'ERASE_INSIDE' ? 'ERASE_OUTSIDE' : 'FILL_INSIDE',
    };
  }
  if (normalizedToolName === 'CircleScissor' && strategy === 'ERASE_INSIDE') {
    // Cornerstone defines CircleScissor.ERASE_OUTSIDE but not ERASE_INSIDE.
    return { cursorToolName: 'CircleScissor', cursorStrategy: 'ERASE_OUTSIDE' };
  }
  return { cursorToolName: normalizedToolName, cursorStrategy: strategy };
}

export function setScissorCursor(
  toolGroup: ToolTypes.IToolGroup,
  csToolName: string,
  strategy: ScissorStrategyName,
): void {
  const cursorApi = toolGroup as unknown as {
    setViewportsCursorByToolName?: (toolName: string, strategy?: string) => void;
  };
  const { cursorToolName, cursorStrategy } = getScissorCursorStrategy(csToolName, strategy);
  cursorApi.setViewportsCursorByToolName?.(cursorToolName, cursorStrategy);
}

// ─── Tool-instance patching ──────────────────────────────────────

function patchScissorToolInstances(toolGroup: ToolTypes.IToolGroup): void {
  const toolApi = toolGroup as unknown as {
    getToolInstance?: (toolName: string) => ScissorToolInstance | undefined;
  };
  if (typeof toolApi.getToolInstance !== 'function') return;

  for (const toolName of SCISSOR_TOOL_NAMES) {
    const toolInstance = toolApi.getToolInstance(toolName);
    if (!toolInstance) continue;
    if (toolInstance[SCISSOR_TOOL_PATCH_FLAG]) continue;
    if (typeof toolInstance.preMouseDownCallback !== 'function') continue;

    const originalPreMouseDown = toolInstance.preMouseDownCallback.bind(toolInstance);

    toolInstance.preMouseDownCallback = (evt: unknown) => {
      const mouseEvent = (evt as { detail?: { event?: { shiftKey?: boolean } } })?.detail?.event;
      if (typeof mouseEvent?.shiftKey === 'boolean') {
        scissorShiftPressed = mouseEvent.shiftKey;
      }

      const strategy = getEffectiveScissorStrategy();
      toolGroup.setActiveStrategy(toolName, strategy);
      setScissorCursor(toolGroup, toolName, strategy);

      const result = originalPreMouseDown(evt);

      const prefs = usePreferencesStore.getState().preferences.annotation.scissors;
      if (prefs.previewEnabled) {
        const displayColor = getScissorDisplayColor();
        if (toolInstance.editData?.annotation?.metadata) {
          toolInstance.editData.annotation.metadata.segmentColor = displayColor;
        }
        if (toolInstance.editData) {
          toolInstance.editData.segmentColor = displayColor;
        }
      }

      return result;
    };

    toolInstance[SCISSOR_TOOL_PATCH_FLAG] = true;
  }
}

export function applyScissorConfigurations(toolGroup: ToolTypes.IToolGroup): void {
  const primaryStrategy = getPrimaryScissorStrategy();

  for (const toolName of SCISSOR_TOOL_NAMES) {
    toolGroup.setToolConfiguration(toolName, {
      preview: {
        // Keep Cornerstone preview disabled for scissors; enabling it writes
        // preview indices that are not committed by scissor tools.
        enabled: false,
      },
      defaultStrategy: primaryStrategy,
      activeStrategy: primaryStrategy,
    });
  }

  patchScissorToolInstances(toolGroup);
}

export function syncActiveScissorStrategy(toolGroup: ToolTypes.IToolGroup | undefined): void {
  if (!toolGroup) return;
  const currentTool = deps.getCurrentActiveTool();
  if (!isScissorTool(currentTool)) return;
  const csName = deps.getCsToolName(currentTool);
  if (!csName) return;
  const strategy = getEffectiveScissorStrategy();
  toolGroup.setActiveStrategy(csName, strategy);
  setScissorCursor(toolGroup, csName, strategy);
}

// ─── Shift-key modifier listeners ────────────────────────────────

function isShiftKeyEvent(evt: Event): boolean {
  const key = (evt as KeyboardEvent).key;
  return key === 'Shift' || key === 'ShiftLeft' || key === 'ShiftRight';
}

function syncShiftState(nextShiftPressed: boolean, getToolGroup: () => ToolTypes.IToolGroup | undefined): void {
  if (scissorShiftPressed === nextShiftPressed) return;
  scissorShiftPressed = nextShiftPressed;
  syncActiveScissorStrategy(getToolGroup());
}

let onShiftKeyDown: ((evt: Event) => void) | null = null;
let onShiftKeyUp: ((evt: Event) => void) | null = null;

export function installModifierListeners(getToolGroup: () => ToolTypes.IToolGroup | undefined): void {
  if (modifierListenersInstalled) return;
  if (typeof window === 'undefined') return;
  if (typeof window.addEventListener !== 'function') return;
  onShiftKeyDown = (evt: Event) => {
    if (!isShiftKeyEvent(evt)) return;
    syncShiftState(true, getToolGroup);
  };
  onShiftKeyUp = (evt: Event) => {
    if (!isShiftKeyEvent(evt)) return;
    syncShiftState(false, getToolGroup);
  };
  window.addEventListener('keydown', onShiftKeyDown);
  window.addEventListener('keyup', onShiftKeyUp);
  modifierListenersInstalled = true;
}

/** Reset module-state during service teardown. */
export function resetScissorState(): void {
  scissorShiftPressed = false;
}

export function removeModifierListeners(): void {
  if (!modifierListenersInstalled) return;
  if (typeof window === 'undefined') {
    modifierListenersInstalled = false;
    return;
  }
  if (onShiftKeyDown) window.removeEventListener('keydown', onShiftKeyDown);
  if (onShiftKeyUp) window.removeEventListener('keyup', onShiftKeyUp);
  onShiftKeyDown = null;
  onShiftKeyUp = null;
  modifierListenersInstalled = false;
}
