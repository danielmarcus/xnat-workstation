import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAnnotationStore } from '../../../stores/annotationStore';
import {
  createCornerstoneMockState,
  createCoreModuleMock,
  createToolsModuleMock,
} from '../../../test/cornerstone/cornerstoneMocks';
import { expectListenersRegistered, expectNoListenersLeft } from '../../../test/cornerstone/listenerAssertions';
import { resetCornerstoneMocks } from '../../../test/cornerstone/resetCornerstoneMocks';

const cs = createCornerstoneMockState();

let annotationService: (typeof import('../annotationService'))['annotationService'];
const Events = cs.tools.Enums.Events;

beforeAll(async () => {
  vi.doMock('@cornerstonejs/core', () => createCoreModuleMock(cs));
  vi.doMock('@cornerstonejs/tools', () => createToolsModuleMock(cs));

  ({ annotationService } = await import('../annotationService'));
});

function resetAnnotationStore(): void {
  useAnnotationStore.setState(useAnnotationStore.getInitialState(), true);
}

describe('annotationService', () => {
  beforeEach(() => {
    resetCornerstoneMocks(cs);
    resetAnnotationStore();
    annotationService.dispose();
  });

  afterEach(() => {
    annotationService.dispose();
    expectNoListenersLeft(cs.eventTarget);
  });

  it('registers and removes annotation event listeners', () => {
    annotationService.initialize();

    expectListenersRegistered(cs.eventTarget, [
      Events.ANNOTATION_COMPLETED,
      Events.ANNOTATION_MODIFIED,
      Events.ANNOTATION_REMOVED,
    ]);

    annotationService.dispose();
    expectNoListenersLeft(cs.eventTarget);
  });

  it('syncs formatted summaries for common tool types from events', () => {
    cs.setAnnotations([
      {
        annotationUID: 'ann-length',
        metadata: { toolName: 'Length' },
        data: { cachedStats: { target: { length: 12.34, unit: 'mm' } } },
      },
      {
        annotationUID: 'ann-angle',
        metadata: { toolName: 'Angle' },
        data: { cachedStats: { target: { angle: 45.67 } } },
      },
      {
        annotationUID: 'ann-bidir',
        metadata: { toolName: 'Bidirectional' },
        data: { cachedStats: { target: { length: 11.29, width: 3.01, unit: 'cm' } } },
      },
      {
        annotationUID: 'ann-ignore',
        metadata: { toolName: 'Crosshairs' },
        data: { cachedStats: { target: { length: 999 } } },
      },
    ]);

    annotationService.initialize();
    cs.eventTarget.dispatch(Events.ANNOTATION_COMPLETED);

    const summaries = useAnnotationStore.getState().annotations;
    expect(summaries).toHaveLength(3);

    expect(summaries[0]).toMatchObject({
      annotationUID: 'ann-length',
      toolName: 'Length',
      displayText: '12.3 mm',
    });
    expect(summaries[1]).toMatchObject({
      annotationUID: 'ann-angle',
      toolName: 'Angle',
      displayText: '45.7°',
    });
    expect(summaries[2]).toMatchObject({
      annotationUID: 'ann-bidir',
      toolName: 'Bidirectional',
      displayText: '11.3 × 3.0 cm',
    });
  });

  it('is resilient to missing stats and missing metadata', () => {
    cs.setAnnotations([
      {
        annotationUID: 'ann-arrow',
        metadata: { toolName: 'ArrowAnnotate' },
        data: { label: 'Focus area' },
      },
      {
        annotationUID: 'ann-length-no-stats',
        metadata: { toolName: 'Length' },
        data: {},
      },
      {
        annotationUID: 'ann-missing-tool',
        metadata: {},
        data: { cachedStats: { target: { value: 1 } } },
      },
    ]);

    expect(() => annotationService.sync()).not.toThrow();

    const summaries = useAnnotationStore.getState().annotations;
    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({
      annotationUID: 'ann-arrow',
      displayText: 'Focus area',
      label: 'Focus area',
    });
    expect(summaries[1]).toMatchObject({
      annotationUID: 'ann-length-no-stats',
      displayText: '',
    });
  });

  it('removeAnnotation and removeAllAnnotations sync store state', () => {
    cs.setAnnotations([
      {
        annotationUID: 'ann-1',
        metadata: { toolName: 'Length' },
        data: { cachedStats: { target: { length: 3.2, unit: 'mm' } } },
      },
      {
        annotationUID: 'ann-2',
        metadata: { toolName: 'Angle' },
        data: { cachedStats: { target: { angle: 90 } } },
      },
    ]);

    annotationService.sync();
    expect(useAnnotationStore.getState().annotations).toHaveLength(2);

    annotationService.removeAnnotation('ann-1');
    expect(useAnnotationStore.getState().annotations).toHaveLength(1);
    expect(useAnnotationStore.getState().annotations[0]?.annotationUID).toBe('ann-2');

    annotationService.removeAllAnnotations();
    expect(useAnnotationStore.getState().annotations).toEqual([]);
  });

  it('formats ROI/probe variants and updates selection highlighting safely', () => {
    const annotations = [
      {
        annotationUID: 'ann-elliptical',
        highlighted: false,
        metadata: { toolName: 'EllipticalROI' },
        data: { cachedStats: { target: { area: 24.12, areaUnit: 'mm²', mean: 11.51 } } },
      },
      {
        annotationUID: 'ann-circle',
        highlighted: false,
        metadata: { toolName: 'CircleROI' },
        data: {
          cachedStats: {
            target: { area: 30.48, areaUnit: 'mm²', radius: 3.456, radiusUnit: 'mm', mean: 8.23 },
          },
        },
      },
      {
        annotationUID: 'ann-probe-ct',
        highlighted: false,
        metadata: { toolName: 'Probe' },
        data: { cachedStats: { target: { value: 42.49, Modality: 'CT' } } },
      },
      {
        annotationUID: 'ann-probe-mr',
        highlighted: false,
        metadata: { toolName: 'Probe' },
        data: { cachedStats: { target: { value: 7.11, Modality: 'MR' } } },
      },
      {
        annotationUID: 'ann-unknown',
        highlighted: false,
        metadata: { toolName: 'UnmappedTool' },
        data: { cachedStats: { target: { value: 123 } } },
      },
    ];
    cs.setAnnotations(annotations);

    annotationService.sync();
    const summaries = useAnnotationStore.getState().annotations;

    expect(summaries).toHaveLength(4);
    expect(summaries[0]?.displayText).toBe('24.1 mm², μ=11.5');
    expect(summaries[1]?.displayText).toBe('30.5 mm², r=3.5 mm, μ=8.2');
    expect(summaries[2]?.displayText).toBe('42.5 HU');
    expect(summaries[3]?.displayText).toBe('7.1');

    annotationService.selectAnnotation('ann-circle');
    expect(annotations[1]?.highlighted).toBe(true);
    expect(annotations[0]?.highlighted).toBe(false);
    expect(useAnnotationStore.getState().selectedUID).toBe('ann-circle');

    annotationService.selectAnnotation(null);
    expect(annotations[1]?.highlighted).toBe(false);
    expect(useAnnotationStore.getState().selectedUID).toBeNull();
  });
});
