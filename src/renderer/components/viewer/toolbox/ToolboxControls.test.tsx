/**
 * ToolboxControls component tests — spec §4.8.4.
 *
 * Pure-render checks per family. The brush-family tests also assert
 * the live two-way binding to `useSegmentationStore.brushSize`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import ToolboxControls, { TOOLBOX_CONTROLS_HEIGHT_PX } from './ToolboxControls';
import { useSegmentationStore } from '../../../stores/segmentationStore';
import { usePreferencesStore } from '../../../stores/preferencesStore';

beforeEach(() => {
  useSegmentationStore.setState({ brushSize: 5 } as Partial<ReturnType<typeof useSegmentationStore.getState>>);
});
afterEach(() => {
  // Reset preferences pref state so cross-test edits don't leak.
  usePreferencesStore.getState().setAnnotationSegmentOpacity(0.5);
  usePreferencesStore.getState().setAnnotationContourThickness(2);
});

describe('ToolboxControls (spec §4.8.4)', () => {
  it('reserves the 110 px fixed height regardless of family', () => {
    const { rerender } = render(
      <ToolboxControls family="none" activeMemberName={null} activeMemberColor={null} />,
    );
    const el = screen.getByTestId('toolbox-controls');
    expect(el.style.height).toBe(`${TOOLBOX_CONTROLS_HEIGHT_PX}px`);
    expect(el.style.minHeight).toBe(`${TOOLBOX_CONTROLS_HEIGHT_PX}px`);
    rerender(<ToolboxControls family="brush" activeMemberName={null} activeMemberColor={null} />);
    expect(screen.getByTestId('toolbox-controls').style.height).toBe(`${TOOLBOX_CONTROLS_HEIGHT_PX}px`);
  });

  it('header shows the active member name + color swatch', () => {
    render(
      <ToolboxControls family="brush" activeMemberName="Tumor 1" activeMemberColor={[220, 50, 50]} />,
    );
    const header = screen.getByTestId('toolbox-controls-active-member');
    expect(header.textContent).toMatch(/Tumor 1/);
    const swatch = header.querySelector('span[aria-hidden]') as HTMLSpanElement | null;
    expect(swatch?.style.backgroundColor).toBe('rgb(220, 50, 50)');
  });

  it('no active member → no member chip rendered', () => {
    render(<ToolboxControls family="brush" activeMemberName={null} activeMemberColor={null} />);
    expect(screen.queryByTestId('toolbox-controls-active-member')).toBeNull();
  });

  describe('family bodies', () => {
    it('"none" → empty-tool hint copy', () => {
      render(<ToolboxControls family="none" activeMemberName={null} activeMemberColor={null} />);
      expect(screen.getByTestId('toolbox-controls-no-tool').textContent).toMatch(/Pick a tool/);
    });

    it('"meas-hint" → "Draw on canvas to add"', () => {
      render(<ToolboxControls family="meas-hint" activeMemberName={null} activeMemberColor={null} />);
      expect(screen.getByTestId('toolbox-controls-meas-hint').textContent).toMatch(/Draw on canvas/);
    });

    it('"brush" → brush-size slider + labelmap-opacity slider', () => {
      render(<ToolboxControls family="brush" activeMemberName={null} activeMemberColor={null} />);
      expect(screen.queryByTestId('control-brush-size')).not.toBeNull();
      expect(screen.queryByTestId('control-labelmap-opacity')).not.toBeNull();
    });

    it('brush slider writes through to useSegmentationStore.brushSize', () => {
      render(<ToolboxControls family="brush" activeMemberName={null} activeMemberColor={null} />);
      const slider = screen.getByTestId('control-brush-size') as HTMLInputElement;
      act(() => {
        fireEvent.change(slider, { target: { value: '17' } });
      });
      expect(useSegmentationStore.getState().brushSize).toBe(17);
    });

    it('labelmap-opacity slider writes through to preferences as 0..1 fraction', () => {
      render(<ToolboxControls family="brush" activeMemberName={null} activeMemberColor={null} />);
      const slider = screen.getByTestId('control-labelmap-opacity') as HTMLInputElement;
      act(() => {
        fireEvent.change(slider, { target: { value: '40' } });
      });
      expect(usePreferencesStore.getState().preferences.annotation.defaultSegmentOpacity).toBeCloseTo(0.4);
    });

    it('"sphere-brush" → sphere-radius slider replaces brush-size', () => {
      render(<ToolboxControls family="sphere-brush" activeMemberName={null} activeMemberColor={null} />);
      expect(screen.queryByTestId('control-sphere-radius')).not.toBeNull();
      expect(screen.queryByTestId('control-brush-size')).toBeNull();
    });

    it('"threshold-range" → HU min/max inputs + brush slider', () => {
      render(<ToolboxControls family="threshold-range" activeMemberName={null} activeMemberColor={null} />);
      expect(screen.queryByTestId('control-threshold-min')).not.toBeNull();
      expect(screen.queryByTestId('control-threshold-max')).not.toBeNull();
      expect(screen.queryByTestId('control-brush-size')).not.toBeNull();
    });

    it('"dynamic-threshold" → sensitivity slider', () => {
      render(<ToolboxControls family="dynamic-threshold" activeMemberName={null} activeMemberColor={null} />);
      expect(screen.queryByTestId('control-sensitivity')).not.toBeNull();
    });

    it('"region-strength" → strength slider', () => {
      render(<ToolboxControls family="region-strength" activeMemberName={null} activeMemberColor={null} />);
      expect(screen.queryByTestId('control-region-strength')).not.toBeNull();
    });

    it('"spline-type" → dropdown with Catmull-Rom / Cardinal / B-Spline / Linear', () => {
      render(<ToolboxControls family="spline-type" activeMemberName={null} activeMemberColor={null} />);
      const select = screen.getByTestId('control-spline-type') as HTMLSelectElement;
      const values = Array.from(select.options).map((o) => o.value);
      expect(values).toEqual(['CATMULL_ROM', 'CARDINAL', 'BSPLINE', 'LINEAR']);
    });

    it('"struct-contour" → contour-thickness + contour-opacity sliders', () => {
      render(<ToolboxControls family="struct-contour" activeMemberName={null} activeMemberColor={null} />);
      expect(screen.queryByTestId('control-contour-thickness')).not.toBeNull();
      expect(screen.queryByTestId('control-contour-opacity')).not.toBeNull();
    });

    it('struct-contour thickness slider writes through to preferences', () => {
      render(<ToolboxControls family="struct-contour" activeMemberName={null} activeMemberColor={null} />);
      const slider = screen.getByTestId('control-contour-thickness') as HTMLInputElement;
      act(() => {
        fireEvent.change(slider, { target: { value: '6' } });
      });
      expect(usePreferencesStore.getState().preferences.annotation.defaultContourThickness).toBe(6);
    });
  });

  it('data-family attribute reflects the family prop — useful for layout assertions', () => {
    const { rerender } = render(
      <ToolboxControls family="brush" activeMemberName={null} activeMemberColor={null} />,
    );
    expect(screen.getByTestId('toolbox-controls').dataset.family).toBe('brush');
    rerender(<ToolboxControls family="spline-type" activeMemberName={null} activeMemberColor={null} />);
    expect(screen.getByTestId('toolbox-controls').dataset.family).toBe('spline-type');
  });
});
