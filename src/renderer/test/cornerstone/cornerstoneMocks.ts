import { vi } from 'vitest';
import { FakeEventTarget } from './fakeEventTarget';
import { TEST_IDS } from './fixtures';

export type RGBA = [number, number, number, number];

export interface MockStackViewport {
  setStack: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  setProperties: ReturnType<typeof vi.fn>;
  resetCamera: ReturnType<typeof vi.fn>;
  resetProperties: ReturnType<typeof vi.fn>;
  getCurrentImageIdIndex: ReturnType<typeof vi.fn>;
  scroll: ReturnType<typeof vi.fn>;
  getZoom: ReturnType<typeof vi.fn>;
  setZoom: ReturnType<typeof vi.fn>;
  getRotation: ReturnType<typeof vi.fn>;
  setRotation: ReturnType<typeof vi.fn>;
  flip: ReturnType<typeof vi.fn>;
  flipHorizontal: boolean;
  flipVertical: boolean;
}

interface MockRenderingEngine {
  id: string;
  enableElement: ReturnType<typeof vi.fn>;
  disableElement: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  getViewport: ReturnType<typeof vi.fn>;
  __setViewport: (viewportId: string, viewport: MockStackViewport) => void;
  __getViewport: (viewportId: string) => MockStackViewport | undefined;
}

interface MockToolGroup {
  id: string;
  addTool: ReturnType<typeof vi.fn>;
  setToolConfiguration: ReturnType<typeof vi.fn>;
  addViewport: ReturnType<typeof vi.fn>;
  removeViewports: ReturnType<typeof vi.fn>;
  getToolInstance: ReturnType<typeof vi.fn>;
  setActiveStrategy: ReturnType<typeof vi.fn>;
  setViewportsCursorByToolName: ReturnType<typeof vi.fn>;
  setToolActive: ReturnType<typeof vi.fn>;
  setToolDisabled: ReturnType<typeof vi.fn>;
  setToolEnabled: ReturnType<typeof vi.fn>;
  getViewportIds: ReturnType<typeof vi.fn>;
  __viewportIds: Set<string>;
}

export interface CornerstoneMockState {
  eventTarget: FakeEventTarget;
  core: {
    eventTarget: FakeEventTarget;
    metaData: {
      get: ReturnType<typeof vi.fn>;
      addProvider: ReturnType<typeof vi.fn>;
      removeProvider: ReturnType<typeof vi.fn>;
    };
    cache: {
      getVolume: ReturnType<typeof vi.fn>;
      putVolumeLoadObject: ReturnType<typeof vi.fn>;
      removeVolumeLoadObject: ReturnType<typeof vi.fn>;
      purgeCache: ReturnType<typeof vi.fn>;
    };
    imageLoader: {
      createAndCacheLocalImage: ReturnType<typeof vi.fn>;
      createAndCacheDerivedLabelmapImages: ReturnType<typeof vi.fn>;
      loadAndCacheImage: ReturnType<typeof vi.fn>;
    };
    utilities: {
      HistoryMemo: {
        DefaultHistoryMemo: {
          canUndo: boolean;
          canRedo: boolean;
          size: number;
        };
      };
      uuidv4: ReturnType<typeof vi.fn>;
    };
    getEnabledElementByViewportId: ReturnType<typeof vi.fn>;
    getRenderingEngine: ReturnType<typeof vi.fn>;
    RenderingEngine: ReturnType<typeof vi.fn>;
    Enums: {
      ViewportType: {
        STACK: string;
      };
    };
  };
  tools: {
    Enums: {
      MouseBindings: {
        Primary: number;
        Secondary: number;
        Auxiliary: number;
      };
      KeyboardBindings: {
        Shift: number;
      };
      SegmentationRepresentations: {
        Labelmap: string;
        Contour: string;
      };
      Events: Record<string, string>;
    };
    annotation: {
      state: {
        getAllAnnotations: ReturnType<typeof vi.fn>;
        removeAnnotation: ReturnType<typeof vi.fn>;
        removeAllAnnotations: ReturnType<typeof vi.fn>;
      };
    };
    segmentation: {
      state: {
        getSegmentations: ReturnType<typeof vi.fn>;
        getSegmentation: ReturnType<typeof vi.fn>;
        getViewportIdsWithSegmentation: ReturnType<typeof vi.fn>;
      };
      config: {
        color: {
          getSegmentIndexColor: ReturnType<typeof vi.fn>;
          setSegmentIndexColor: ReturnType<typeof vi.fn>;
        };
        visibility: {
          getSegmentIndexVisibility: ReturnType<typeof vi.fn>;
          setSegmentIndexVisibility: ReturnType<typeof vi.fn>;
        };
      };
      segmentationStyle: {
        setStyle: ReturnType<typeof vi.fn>;
      };
      segmentIndex: {
        setActiveSegmentIndex: ReturnType<typeof vi.fn>;
      };
      segmentLocking: {
        isSegmentIndexLocked: ReturnType<typeof vi.fn>;
        setSegmentIndexLocked: ReturnType<typeof vi.fn>;
      };
      addLabelmapRepresentationToViewport: ReturnType<typeof vi.fn>;
      removeSegmentationRepresentations: ReturnType<typeof vi.fn>;
      removeSegmentationRepresentationsFromToolGroup: ReturnType<typeof vi.fn>;
      defaultSegmentationStateManager: {
        _stackLabelmapImageIdReferenceMap: Map<string, Map<string, string>>;
      };
      helpers: {
        convertStackToVolumeLabelmap: ReturnType<typeof vi.fn>;
      };
    };
    utilities: {
      segmentation: {
        triggerSegmentationRender: ReturnType<typeof vi.fn>;
        setBrushSizeForToolGroup: ReturnType<typeof vi.fn>;
      };
    };
    ToolGroupManager: {
      createToolGroup: ReturnType<typeof vi.fn>;
      getToolGroup: ReturnType<typeof vi.fn>;
      destroyToolGroup: ReturnType<typeof vi.fn>;
    };
    __toolGroups: Map<string, MockToolGroup>;
    __lastCreatedToolGroup: MockToolGroup | null;
  };
  adapters: {
    adaptersSEG: {
      Segmentation: {
        generateToolState: ReturnType<typeof vi.fn>;
        generateSegmentation: ReturnType<typeof vi.fn>;
      };
    };
    utilities: Record<string, never>;
  };
  setAnnotations: (annotations: any[]) => void;
  setSegmentations: (segmentations: any[]) => void;
  setViewportIdsForSegmentation: (segmentationId: string, viewportIds: string[]) => void;
  setSegmentColor: (viewportId: string, segmentationId: string, segmentIndex: number, color: RGBA) => void;
  setSegmentVisibility: (viewportId: string, segmentationId: string, segmentIndex: number, visible: boolean) => void;
  setSegmentLocked: (segmentationId: string, segmentIndex: number, locked: boolean) => void;
  setEnabledElement: (viewportId: string, enabledElement: { viewport: { render?: () => void } }) => void;
  clearEnabledElements: () => void;
  getOrCreateEngine: (engineId?: string) => MockRenderingEngine;
  setViewport: (viewportId: string, viewport: MockStackViewport, engineId?: string) => void;
  getLastToolGroup: () => MockToolGroup | null;
  reset: () => void;
}

function makeToolExport(toolName: string): { toolName: string } {
  return { toolName };
}

function colorKey(viewportId: string, segmentationId: string, segmentIndex: number): string {
  return `${viewportId}|${segmentationId}|${segmentIndex}`;
}

function lockKey(segmentationId: string, segmentIndex: number): string {
  return `${segmentationId}|${segmentIndex}`;
}

export function createFakeStackViewport(overrides: Partial<MockStackViewport> = {}): MockStackViewport {
  let currentIndex = 0;
  let currentZoom = 1;
  let currentRotation = 0;
  const viewport: MockStackViewport = {
    setStack: vi.fn(async () => undefined),
    render: vi.fn(),
    setProperties: vi.fn(),
    resetCamera: vi.fn(),
    resetProperties: vi.fn(),
    getCurrentImageIdIndex: vi.fn(() => currentIndex),
    scroll: vi.fn((delta: number) => {
      if (Number.isFinite(delta)) {
        currentIndex += delta;
      }
    }),
    getZoom: vi.fn(() => currentZoom),
    setZoom: vi.fn((nextZoom: number) => {
      currentZoom = nextZoom;
    }),
    getRotation: vi.fn(() => currentRotation),
    setRotation: vi.fn((nextRotation: number) => {
      currentRotation = nextRotation;
    }),
    flip: vi.fn((opts: { flipHorizontal?: boolean; flipVertical?: boolean }) => {
      if (opts.flipHorizontal) {
        viewport.flipHorizontal = !viewport.flipHorizontal;
      }
      if (opts.flipVertical) {
        viewport.flipVertical = !viewport.flipVertical;
      }
    }),
    flipHorizontal: false,
    flipVertical: false,
  };

  return {
    ...viewport,
    ...overrides,
  };
}

function createToolGroup(id: string): MockToolGroup {
  const viewports = new Set<string>();
  return {
    id,
    __viewportIds: viewports,
    addTool: vi.fn(),
    setToolConfiguration: vi.fn(),
    addViewport: vi.fn((viewportId: string) => {
      viewports.add(viewportId);
    }),
    removeViewports: vi.fn((_engineId: string, viewportId: string) => {
      viewports.delete(viewportId);
    }),
    getToolInstance: vi.fn(() => undefined),
    setActiveStrategy: vi.fn(),
    setViewportsCursorByToolName: vi.fn(),
    setToolActive: vi.fn(),
    setToolDisabled: vi.fn(),
    setToolEnabled: vi.fn(),
    getViewportIds: vi.fn(() => Array.from(viewports)),
  };
}

export function createCornerstoneMockState(): CornerstoneMockState {
  const eventTarget = new FakeEventTarget();
  const metadataMap = new Map<string, unknown>();
  const enabledElements = new Map<string, { viewport: { render?: () => void } }>();
  const engines = new Map<string, MockRenderingEngine>();

  const annotations: any[] = [];
  const segmentations: any[] = [];
  const viewportIdsBySegmentation = new Map<string, string[]>();
  const colorsByKey = new Map<string, RGBA>();
  const visibilityByKey = new Map<string, boolean>();
  const lockingByKey = new Map<string, boolean>();

  const toolGroups = new Map<string, MockToolGroup>();
  const historyMemo = {
    canUndo: false,
    canRedo: false,
    size: 50,
  };

  const core = {
    eventTarget,
    metaData: {
      get: vi.fn((type: string, imageId: string) => metadataMap.get(`${type}|${imageId}`)),
      addProvider: vi.fn(),
      removeProvider: vi.fn(),
    },
    cache: {
      getVolume: vi.fn(),
      putVolumeLoadObject: vi.fn(),
      removeVolumeLoadObject: vi.fn(),
      purgeCache: vi.fn(),
    },
    imageLoader: {
      createAndCacheLocalImage: vi.fn(async () => ({ imageId: 'mock:image' })),
      createAndCacheDerivedLabelmapImages: vi.fn(async () => []),
      loadAndCacheImage: vi.fn(async () => ({ imageId: 'mock:image' })),
    },
    utilities: {
      HistoryMemo: {
        DefaultHistoryMemo: historyMemo,
      },
      uuidv4: vi.fn(() => 'mock-uuid'),
    },
    getEnabledElementByViewportId: vi.fn((viewportId: string) => enabledElements.get(viewportId)),
    getRenderingEngine: vi.fn((engineId: string) => engines.get(engineId) ?? null),
    RenderingEngine: vi.fn((engineId: string) => {
      const viewportMap = new Map<string, MockStackViewport>();
      const engine: MockRenderingEngine = {
        id: engineId,
        enableElement: vi.fn((input: { viewportId: string }) => {
          if (!viewportMap.has(input.viewportId)) {
            viewportMap.set(input.viewportId, createFakeStackViewport());
          }
        }),
        disableElement: vi.fn((viewportId: string) => {
          viewportMap.delete(viewportId);
        }),
        destroy: vi.fn(() => {
          viewportMap.clear();
          engines.delete(engineId);
        }),
        resize: vi.fn(),
        getViewport: vi.fn((viewportId: string) => {
          const viewport = viewportMap.get(viewportId);
          if (!viewport) {
            throw new Error(`Viewport ${viewportId} not found`);
          }
          return viewport;
        }),
        __setViewport: (viewportId: string, viewport: MockStackViewport) => {
          viewportMap.set(viewportId, viewport);
        },
        __getViewport: (viewportId: string) => viewportMap.get(viewportId),
      };
      engines.set(engineId, engine);
      return engine;
    }),
    Enums: {
      ViewportType: {
        STACK: 'STACK',
      },
    },
  };

  const tools = {
    Enums: {
      MouseBindings: {
        Primary: 1,
        Secondary: 2,
        Auxiliary: 4,
      },
      KeyboardBindings: {
        Shift: 16,
      },
      SegmentationRepresentations: {
        Labelmap: 'Labelmap',
        Contour: 'Contour',
      },
      Events: {
        ANNOTATION_COMPLETED: 'ANNOTATION_COMPLETED',
        ANNOTATION_MODIFIED: 'ANNOTATION_MODIFIED',
        ANNOTATION_REMOVED: 'ANNOTATION_REMOVED',
        SEGMENTATION_MODIFIED: 'SEGMENTATION_MODIFIED',
        SEGMENTATION_DATA_MODIFIED: 'SEGMENTATION_DATA_MODIFIED',
        SEGMENTATION_ADDED: 'SEGMENTATION_ADDED',
        SEGMENTATION_REMOVED: 'SEGMENTATION_REMOVED',
        SEGMENTATION_REPRESENTATION_MODIFIED: 'SEGMENTATION_REPRESENTATION_MODIFIED',
        SEGMENTATION_REPRESENTATION_ADDED: 'SEGMENTATION_REPRESENTATION_ADDED',
        SEGMENTATION_REPRESENTATION_REMOVED: 'SEGMENTATION_REPRESENTATION_REMOVED',
      },
    },
    annotation: {
      state: {
        getAllAnnotations: vi.fn(() => annotations),
        removeAnnotation: vi.fn((uid: string) => {
          const idx = annotations.findIndex((entry) => entry.annotationUID === uid);
          if (idx >= 0) {
            annotations.splice(idx, 1);
          }
        }),
        removeAllAnnotations: vi.fn(() => {
          annotations.length = 0;
        }),
      },
    },
    segmentation: {
      state: {
        getSegmentations: vi.fn(() => segmentations),
        getSegmentation: vi.fn((segmentationId: string) =>
          segmentations.find((entry) => entry.segmentationId === segmentationId) ?? null),
        getViewportIdsWithSegmentation: vi.fn((segmentationId: string) =>
          viewportIdsBySegmentation.get(segmentationId) ?? []),
      },
      config: {
        color: {
          getSegmentIndexColor: vi.fn((viewportId: string, segmentationId: string, segmentIndex: number) =>
            colorsByKey.get(colorKey(viewportId, segmentationId, segmentIndex)) ?? [255, 255, 255, 255]),
          setSegmentIndexColor: vi.fn((viewportId: string, segmentationId: string, segmentIndex: number, color: RGBA) => {
            colorsByKey.set(colorKey(viewportId, segmentationId, segmentIndex), color);
          }),
        },
        visibility: {
          getSegmentIndexVisibility: vi.fn((viewportId: string, spec: { segmentationId: string }, segmentIndex: number) =>
            visibilityByKey.get(colorKey(viewportId, spec.segmentationId, segmentIndex)) ?? true),
          setSegmentIndexVisibility: vi.fn((viewportId: string, spec: { segmentationId: string }, segmentIndex: number, visible: boolean) => {
            visibilityByKey.set(colorKey(viewportId, spec.segmentationId, segmentIndex), visible);
          }),
        },
      },
      segmentationStyle: {
        setStyle: vi.fn(),
      },
      segmentIndex: {
        setActiveSegmentIndex: vi.fn(),
      },
      segmentLocking: {
        isSegmentIndexLocked: vi.fn((segmentationId: string, segmentIndex: number) =>
          lockingByKey.get(lockKey(segmentationId, segmentIndex)) ?? false),
        setSegmentIndexLocked: vi.fn((segmentationId: string, segmentIndex: number, locked: boolean) => {
          lockingByKey.set(lockKey(segmentationId, segmentIndex), locked);
        }),
      },
      addLabelmapRepresentationToViewport: vi.fn(),
      removeSegmentationRepresentations: vi.fn(),
      removeSegmentationRepresentationsFromToolGroup: vi.fn(),
      defaultSegmentationStateManager: {
        _stackLabelmapImageIdReferenceMap: new Map<string, Map<string, string>>(),
      },
      helpers: {
        convertStackToVolumeLabelmap: vi.fn(async () => undefined),
      },
    },
    utilities: {
      segmentation: {
        triggerSegmentationRender: vi.fn(),
        setBrushSizeForToolGroup: vi.fn(),
      },
    },
    ToolGroupManager: {
      createToolGroup: vi.fn((toolGroupId: string) => {
        const group = createToolGroup(toolGroupId);
        toolGroups.set(toolGroupId, group);
        tools.__lastCreatedToolGroup = group;
        return group;
      }),
      getToolGroup: vi.fn((toolGroupId: string) => toolGroups.get(toolGroupId)),
      destroyToolGroup: vi.fn((toolGroupId: string) => {
        toolGroups.delete(toolGroupId);
      }),
    },
    __toolGroups: toolGroups,
    __lastCreatedToolGroup: null as MockToolGroup | null,
  };

  const adapters = {
    adaptersSEG: {
      Segmentation: {
        generateToolState: vi.fn(),
        generateSegmentation: vi.fn(),
      },
    },
    utilities: {},
  };

  const state: CornerstoneMockState = {
    eventTarget,
    core,
    tools,
    adapters,
    setAnnotations(next) {
      annotations.length = 0;
      annotations.push(...next);
    },
    setSegmentations(next) {
      segmentations.length = 0;
      segmentations.push(...next);
    },
    setViewportIdsForSegmentation(segmentationId, viewportIds) {
      viewportIdsBySegmentation.set(segmentationId, [...viewportIds]);
    },
    setSegmentColor(viewportId, segmentationId, segmentIndex, color) {
      colorsByKey.set(colorKey(viewportId, segmentationId, segmentIndex), color);
    },
    setSegmentVisibility(viewportId, segmentationId, segmentIndex, visible) {
      visibilityByKey.set(colorKey(viewportId, segmentationId, segmentIndex), visible);
    },
    setSegmentLocked(segmentationId, segmentIndex, locked) {
      lockingByKey.set(lockKey(segmentationId, segmentIndex), locked);
    },
    setEnabledElement(viewportId, enabledElement) {
      enabledElements.set(viewportId, enabledElement);
    },
    clearEnabledElements() {
      enabledElements.clear();
    },
    getOrCreateEngine(engineId = TEST_IDS.renderingEngineId) {
      const existing = engines.get(engineId);
      if (existing) return existing;
      return core.RenderingEngine(engineId) as unknown as MockRenderingEngine;
    },
    setViewport(viewportId, viewport, engineId = TEST_IDS.renderingEngineId) {
      const engine = state.getOrCreateEngine(engineId);
      engine.__setViewport(viewportId, viewport);
    },
    getLastToolGroup() {
      return tools.__lastCreatedToolGroup;
    },
    reset() {
      eventTarget.clear();
      annotations.length = 0;
      segmentations.length = 0;
      viewportIdsBySegmentation.clear();
      colorsByKey.clear();
      visibilityByKey.clear();
      lockingByKey.clear();
      metadataMap.clear();
      enabledElements.clear();
      engines.clear();
      toolGroups.clear();
      tools.__lastCreatedToolGroup = null;
      tools.segmentation.defaultSegmentationStateManager._stackLabelmapImageIdReferenceMap.clear();
      historyMemo.canUndo = false;
      historyMemo.canRedo = false;
      historyMemo.size = 50;
      vi.clearAllMocks();
    },
  };

  return state;
}

export function createCoreModuleMock(state: CornerstoneMockState): Record<string, unknown> {
  return {
    eventTarget: state.core.eventTarget,
    metaData: state.core.metaData,
    cache: state.core.cache,
    imageLoader: state.core.imageLoader,
    utilities: state.core.utilities,
    getEnabledElementByViewportId: state.core.getEnabledElementByViewportId,
    getRenderingEngine: state.core.getRenderingEngine,
    RenderingEngine: state.core.RenderingEngine,
    Enums: state.core.Enums,
    Types: {},
  };
}

export function createToolsModuleMock(state: CornerstoneMockState): Record<string, unknown> {
  return {
    ToolGroupManager: state.tools.ToolGroupManager,
    annotation: state.tools.annotation,
    segmentation: state.tools.segmentation,
    utilities: state.tools.utilities,
    Enums: state.tools.Enums,
    Types: {},
    StackScrollTool: makeToolExport('StackScroll'),
    ZoomTool: makeToolExport('Zoom'),
    PanTool: makeToolExport('Pan'),
    WindowLevelTool: makeToolExport('WindowLevel'),
    LengthTool: makeToolExport('Length'),
    AngleTool: makeToolExport('Angle'),
    BidirectionalTool: makeToolExport('Bidirectional'),
    EllipticalROITool: makeToolExport('EllipticalROI'),
    RectangleROITool: makeToolExport('RectangleROI'),
    CircleROITool: makeToolExport('CircleROI'),
    ProbeTool: makeToolExport('Probe'),
    ArrowAnnotateTool: makeToolExport('ArrowAnnotate'),
    PlanarFreehandROITool: makeToolExport('PlanarFreehandROI'),
    CrosshairsTool: makeToolExport('Crosshairs'),
    BrushTool: makeToolExport('Brush'),
    PlanarFreehandContourSegmentationTool: makeToolExport('PlanarFreehandContourSegmentation'),
    SplineContourSegmentationTool: makeToolExport('SplineContourSegmentation'),
    LivewireContourSegmentationTool: makeToolExport('LivewireContourSegmentation'),
    CircleScissorsTool: makeToolExport('CircleScissors'),
    RectangleScissorsTool: makeToolExport('RectangleScissors'),
    SphereScissorsTool: makeToolExport('SphereScissors'),
    SculptorTool: makeToolExport('Sculptor'),
    SegmentSelectTool: makeToolExport('SegmentSelect'),
    RegionSegmentTool: makeToolExport('RegionSegment'),
    RegionSegmentPlusTool: makeToolExport('RegionSegmentPlus'),
    SegmentBidirectionalTool: makeToolExport('SegmentBidirectional'),
    RectangleROIThresholdTool: makeToolExport('RectangleROIThreshold'),
    CircleROIStartEndThresholdTool: makeToolExport('CircleROIStartEndThreshold'),
    LabelMapEditWithContourTool: makeToolExport('LabelMapEditWithContour'),
  };
}

export function createAdaptersModuleMock(state: CornerstoneMockState): Record<string, unknown> {
  return {
    adaptersSEG: state.adapters.adaptersSEG,
    utilities: state.adapters.utilities,
  };
}
