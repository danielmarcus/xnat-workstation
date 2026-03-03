import { beforeEach, describe, expect, it, vi } from 'vitest';

const mprToolMocks = vi.hoisted(() => {
  const toolGroup = {
    addTool: vi.fn(),
    setToolActive: vi.fn(),
    setToolEnabled: vi.fn(),
    addViewport: vi.fn(),
    removeViewports: vi.fn(),
  };

  return {
    toolGroup,
    createToolGroup: vi.fn(() => toolGroup),
    getToolGroup: vi.fn(() => toolGroup),
    destroyToolGroup: vi.fn(),
  };
});

vi.mock('@cornerstonejs/tools', () => ({
  ToolGroupManager: {
    createToolGroup: mprToolMocks.createToolGroup,
    getToolGroup: mprToolMocks.getToolGroup,
    destroyToolGroup: mprToolMocks.destroyToolGroup,
  },
  CrosshairsTool: { toolName: 'Crosshairs' },
  WindowLevelTool: { toolName: 'WindowLevel' },
  PanTool: { toolName: 'Pan' },
  ZoomTool: { toolName: 'Zoom' },
  Enums: {
    MouseBindings: {
      Primary: 1,
      Auxiliary: 2,
      Secondary: 3,
    },
  },
}));

vi.mock('../viewportService', () => ({
  viewportService: {
    ENGINE_ID: 'xnatRenderingEngine',
  },
}));

import { mprToolService } from '../mprToolService';

describe('mprToolService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mprToolMocks.createToolGroup.mockReturnValue(mprToolMocks.toolGroup);
    mprToolMocks.getToolGroup.mockReturnValue(mprToolMocks.toolGroup);
  });

  it('initializes MPR tool group with expected tools and bindings', () => {
    mprToolService.initialize();

    expect(mprToolMocks.destroyToolGroup).toHaveBeenCalledWith('xnatToolGroup_mpr');
    expect(mprToolMocks.createToolGroup).toHaveBeenCalledWith('xnatToolGroup_mpr');
    expect(mprToolMocks.toolGroup.addTool).toHaveBeenCalledWith('Crosshairs');
    expect(mprToolMocks.toolGroup.addTool).toHaveBeenCalledWith('WindowLevel');
    expect(mprToolMocks.toolGroup.addTool).toHaveBeenCalledWith('Pan');
    expect(mprToolMocks.toolGroup.addTool).toHaveBeenCalledWith('Zoom');

    expect(mprToolMocks.toolGroup.setToolActive).toHaveBeenCalledWith(
      'Crosshairs',
      { bindings: [{ mouseButton: 1 }] },
    );
    expect(mprToolMocks.toolGroup.setToolActive).toHaveBeenCalledWith(
      'Pan',
      { bindings: [{ mouseButton: 2 }] },
    );
    expect(mprToolMocks.toolGroup.setToolActive).toHaveBeenCalledWith(
      'Zoom',
      { bindings: [{ mouseButton: 3 }] },
    );
    expect(mprToolMocks.toolGroup.setToolEnabled).toHaveBeenCalledWith('WindowLevel');
  });

  it('handles initialize failure path when tool group cannot be created', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mprToolMocks.createToolGroup.mockReturnValue(undefined);

    mprToolService.initialize();

    expect(errorSpy).toHaveBeenCalledWith('[mprToolService] Failed to create tool group');
    errorSpy.mockRestore();
  });

  it('adds/removes viewports and guards missing tool groups', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mprToolService.addViewport('mpr_panel_0');
    expect(mprToolMocks.toolGroup.addViewport).toHaveBeenCalledWith('mpr_panel_0', 'xnatRenderingEngine');

    mprToolService.removeViewport('mpr_panel_0');
    expect(mprToolMocks.toolGroup.removeViewports).toHaveBeenCalledWith('xnatRenderingEngine', 'mpr_panel_0');

    mprToolMocks.getToolGroup.mockReturnValue(undefined);
    mprToolService.addViewport('mpr_panel_1');
    expect(warnSpy).toHaveBeenCalledWith('[mprToolService] No tool group — call initialize() first');

    expect(() => mprToolService.removeViewport('mpr_panel_1')).not.toThrow();
    warnSpy.mockRestore();
  });

  it('swallows tool group removal errors on remove/destroy', () => {
    mprToolMocks.toolGroup.removeViewports.mockImplementation(() => {
      throw new Error('already removed');
    });
    expect(() => mprToolService.removeViewport('mpr_panel_0')).not.toThrow();

    mprToolMocks.destroyToolGroup.mockImplementation(() => {
      throw new Error('destroy failed');
    });
    expect(() => mprToolService.destroy()).not.toThrow();
  });
});
