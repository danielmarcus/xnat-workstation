import { describe, expect, it } from 'vitest';
import {
  buildContainerPanelMap,
  viewportsForContainer,
  pillLabelForContainer,
  pillTooltipForContainer,
} from './containerPanelResolver';

describe('buildContainerPanelMap', () => {
  it('inverts per-viewport visibility into containerId → panels', () => {
    const resolve = (vp: string) => {
      if (vp === 'panel_0') return new Set(['c1', 'c2']);
      if (vp === 'panel_1') return new Set(['c2']);
      return new Set<string>();
    };
    const map = buildContainerPanelMap(
      ['panel_0', 'panel_1', 'panel_2'],
      ['c1', 'c2', 'c3'],
      resolve,
    );
    expect(map.c1).toEqual(['panel_0']);
    expect(map.c2).toEqual(['panel_0', 'panel_1']);
    expect(map.c3).toEqual([]);
  });

  it('null from resolver means "all containers visible on that viewport"', () => {
    const resolve = (vp: string) => (vp === 'panel_0' ? null : new Set<string>(['c1']));
    const map = buildContainerPanelMap(['panel_0', 'panel_1'], ['c1', 'c2'], resolve);
    expect(map.c1).toEqual(['panel_0', 'panel_1']);
    expect(map.c2).toEqual(['panel_0']);
  });

  it('panel lists are sorted', () => {
    const resolve = (vp: string) => new Set(['c1']);
    const map = buildContainerPanelMap(['panel_2', 'panel_0', 'panel_1'], ['c1'], resolve);
    expect(map.c1).toEqual(['panel_0', 'panel_1', 'panel_2']);
  });

  it('container with no resolver hit lands with an empty array', () => {
    const resolve = () => new Set<string>();
    const map = buildContainerPanelMap(['panel_0'], ['c1', 'c2'], resolve);
    expect(map.c1).toEqual([]);
    expect(map.c2).toEqual([]);
  });
});

describe('viewportsForContainer', () => {
  it('returns sorted list of viewports showing the container', () => {
    const resolve = (vp: string) => {
      if (vp === 'panel_2') return new Set(['c1']);
      if (vp === 'panel_0') return new Set(['c1']);
      return new Set<string>();
    };
    expect(viewportsForContainer('c1', ['panel_0', 'panel_1', 'panel_2'], resolve)).toEqual(['panel_0', 'panel_2']);
  });

  it('null resolver result counts the viewport in', () => {
    const resolve = () => null;
    expect(viewportsForContainer('c1', ['panel_0', 'panel_1'], resolve)).toEqual(['panel_0', 'panel_1']);
  });
});

describe('pillLabelForContainer', () => {
  it('null when the container is on the active viewport', () => {
    expect(pillLabelForContainer(['panel_0', 'panel_2'], 'panel_0')).toBeNull();
  });

  it('"↗ panel_X" when shown on exactly one off-panel viewport', () => {
    expect(pillLabelForContainer(['panel_2'], 'panel_0')).toBe('↗ panel_2');
  });

  it('"↗ N panels" when shown on multiple off-panel viewports', () => {
    expect(pillLabelForContainer(['panel_1', 'panel_2'], 'panel_0')).toBe('↗ 2 panels');
  });

  it('"↗ not loaded" when not shown anywhere', () => {
    expect(pillLabelForContainer([], 'panel_0')).toBe('↗ not loaded');
  });
});

describe('pillTooltipForContainer', () => {
  it('lists every viewport when present', () => {
    expect(pillTooltipForContainer(['panel_0', 'panel_2'])).toBe('Shown on: panel_0, panel_2');
  });
  it('explicit copy when not loaded', () => {
    expect(pillTooltipForContainer([])).toMatch(/Not currently shown/);
  });
});
