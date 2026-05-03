/**
 * Viewport — unified viewport routing component.
 *
 * 2-way switch between StackViewport (stack mode for non-volumetric
 * data per stackEligibility.ts — US/XA/RF/NM/DX/CR/MG, multi-frame
 * cine without spatial dim, single-image) and VolumeViewport (volume
 * mode for everything else, including the mpr-2x2 oriented panels).
 * Decision: `viewportService.resolveViewportType(imageIds)` —
 * inspects modality + image count to pick stack vs. volume.
 *
 * The legacy `multiViewport.enabled` preference flag deleted in
 * Phase 6.6; routing is unconditional now.
 */
import { useMemo } from 'react';
import { viewportService } from '../../lib/cornerstone/viewportService';
import StackViewport from './StackViewport';
import VolumeViewport from './VolumeViewport';

interface ViewportProps {
  panelId: string;
  imageIds: string[];
  /**
   * Optional volume orientation. When set to a non-AXIAL value the
   * panel is part of an MPR layout slot — Viewport routes through
   * VolumeViewport with the orientation prop. When undefined or
   * 'AXIAL', the panel renders in stack mode (if eligible per
   * `resolveViewportType`) or default axial volume mode.
   */
  orientation?: 'AXIAL' | 'SAGITTAL' | 'CORONAL';
}

export default function Viewport({ panelId, imageIds, orientation }: ViewportProps) {
  const resolvedType = useMemo(() => {
    if (imageIds.length === 0) return null;
    return viewportService.resolveViewportType(imageIds);
  }, [imageIds]);

  if (resolvedType === 'volume') {
    return <VolumeViewport panelId={panelId} imageIds={imageIds} orientation={orientation ?? 'AXIAL'} />;
  }

  return <StackViewport panelId={panelId} imageIds={imageIds} />;
}
