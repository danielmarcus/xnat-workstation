import { init as initCore } from '@cornerstonejs/core';
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
  RegionSegmentTool,
  RegionSegmentPlusTool,
  SegmentBidirectionalTool,
  RectangleROIThresholdTool,
  CircleROIStartEndThresholdTool,
  LabelMapEditWithContourTool,
} from '@cornerstonejs/tools';
import SafePaintFillTool from './tools/SafePaintFillTool';
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

  // Segmentation tools — smart/AI (GrowCut)
  addTool(RegionSegmentTool);
  addTool(RegionSegmentPlusTool);

  // Segmentation tools — utility
  addTool(SegmentSelectTool);
  addTool(SegmentBidirectionalTool);

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
