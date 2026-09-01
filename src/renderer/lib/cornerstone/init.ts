import { init as initCore, volumeLoader } from '@cornerstonejs/core';
import { geometryDynamicVolumeLoader, GEOMETRY_DYNAMIC_VOLUME_SCHEME } from './dynamicVolumeLoader';
import { init as initTools, addTool } from '@cornerstonejs/tools';
import * as polySeg from '@cornerstonejs/polymorphic-segmentation';
import {
  StackScrollTool,
  ZoomTool,
  PanTool,
  WindowLevelTool,
  LengthTool,
  AngleTool,
  BidirectionalTool,
  EllipticalROITool,
  RectangleROITool,
  CircleROITool,
  ProbeTool,
  ArrowAnnotateTool,
  PlanarFreehandROITool,
  CrosshairsTool,
  BrushTool,
  PlanarFreehandContourSegmentationTool,
  SplineContourSegmentationTool,
  LivewireContourSegmentationTool,
  CircleScissorsTool,
  RectangleScissorsTool,
  SphereScissorsTool,
  SculptorTool,
  SegmentSelectTool,
  TrackballRotateTool,
  RegionSegmentTool,
  RegionSegmentPlusTool,
  SegmentBidirectionalTool,
  RectangleROIThresholdTool,
  CircleROIStartEndThresholdTool,
  LabelMapEditWithContourTool,
} from '@cornerstonejs/tools';
import SafePaintFillTool from './tools/SafePaintFillTool';
import { utilities as csToolsUtilities } from '@cornerstonejs/tools';
import { init as initDicomImageLoader } from '@cornerstonejs/dicom-image-loader';

let initialized = false;

/**
 * Initialize Cornerstone3D v4: core rendering, tools, and DICOM image loader.
 * Must be called once before any viewports are created.
 *
 * V4 uses a centralized web worker manager and ESM-based worker loading.
 * No need to set external.cornerstone or external.dicomParser — v4 handles
 * peer dependencies internally.
 */
export async function initCornerstone(): Promise<void> {
  if (initialized) return;

  // ---------- 1. Initialize Cornerstone3D Core ----------
  // Handles rendering engine setup, GPU detection, WebGL context pool
  initCore();

  // 4D / multi-volume (functional) series → a geometry-split dynamic volume loader
  // (Cornerstone's own only detects vendor-tagged cardiac/diffusion 4D). volumeService
  // routes such series here so every time point keeps correct geometry AND time
  // points are navigable via volume.dimensionGroupNumber (the scrubber).
  volumeLoader.registerVolumeLoader(GEOMETRY_DYNAMIC_VOLUME_SCHEME, geometryDynamicVolumeLoader as never);

  // ---------- 2. Initialize Cornerstone Tools ----------
  // Register PolySeg addon for automatic conversion between segmentation
  // representations (labelmap ↔ contour ↔ surface)
  initTools({
    addons: {
      polySeg,
    },
  });

  // Register standard interaction and annotation tools globally
  addTool(StackScrollTool);
  addTool(ZoomTool);
  addTool(PanTool);
  addTool(WindowLevelTool);
  addTool(LengthTool);
  addTool(AngleTool);
  addTool(BidirectionalTool);
  addTool(EllipticalROITool);
  addTool(RectangleROITool);
  addTool(CircleROITool);
  addTool(ProbeTool);
  addTool(ArrowAnnotateTool);
  addTool(PlanarFreehandROITool);

  // MPR tools
  addTool(CrosshairsTool);

  // Segmentation tools — labelmap
  addTool(BrushTool);
  addTool(CircleScissorsTool);
  addTool(RectangleScissorsTool);
  addTool(SphereScissorsTool);
  addTool(SafePaintFillTool);
  addTool(RectangleROIThresholdTool);
  addTool(CircleROIStartEndThresholdTool);

  // Segmentation tools — contour
  addTool(PlanarFreehandContourSegmentationTool);
  addTool(SplineContourSegmentationTool);
  addTool(LivewireContourSegmentationTool);
  addTool(SculptorTool);
  addTool(LabelMapEditWithContourTool);

  // SplineContourSegmentationTool inherits getContourSequence from
  // ContourBaseTool but doesn't self-register with AnnotationToPointData
  // (unlike PlanarFreehand and Livewire which do). Without registration,
  // RTSTRUCT export throws "Unknown tool type" for spline annotations.
  const { AnnotationToPointData } = csToolsUtilities.contours;
  if (AnnotationToPointData && !AnnotationToPointData.TOOL_NAMES[SplineContourSegmentationTool.toolName]) {
    AnnotationToPointData.register(SplineContourSegmentationTool);
  }

  // Segmentation tools — smart/AI (GrowCut)
  addTool(RegionSegmentTool);
  addTool(RegionSegmentPlusTool);

  // Segmentation tools — utility
  addTool(SegmentSelectTool);
  addTool(SegmentBidirectionalTool);

  // 3D volume-rendering interaction (C5c — the MPR layout's fourth slot).
  addTool(TrackballRotateTool);

  // ---------- 3. Initialize DICOM Image Loader ----------
  // V4 uses CentralizedWebWorkerManager and import.meta.url for worker loading.
  // Registers wadouri: and wadors: image loader schemes automatically.
  const maxWebWorkers = Math.min(navigator.hardwareConcurrency || 4, 4);
  initDicomImageLoader({
    maxWebWorkers,
  });

  initialized = true;
  console.log('Cornerstone3D v4 initialized successfully');
  console.log(`  Web workers: ${maxWebWorkers}`);
  console.log(`  Hardware concurrency: ${navigator.hardwareConcurrency}`);
}
