export const TEST_IDS = {
  renderingEngineId: 'xnatRenderingEngine',
  viewportId: 'panel_0',
  secondaryViewportId: 'panel_1',
  toolGroupId: 'xnatToolGroup_primary',
  annotationUid: 'annotation-1',
  segmentationId: 'segmentation-1',
  sourceImageId: 'wadouri:https://example.org/wado?objectUID=1.2.3.4',
} as const;

export const TEST_COLORS = {
  red: [220, 50, 50, 255] as [number, number, number, number],
  green: [50, 200, 50, 255] as [number, number, number, number],
};
