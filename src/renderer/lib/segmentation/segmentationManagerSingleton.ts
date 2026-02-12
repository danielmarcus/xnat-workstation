/**
 * Singleton instance of SegmentationManager.
 *
 * Import this module to get the shared manager instance.
 * Call segmentationManager.initialize(deps) once from ViewerPage on mount.
 */
import { SegmentationManager } from './SegmentationManager';

export const segmentationManager = new SegmentationManager();
