import { describe, it, expect, beforeEach } from 'vitest';
import { viewportLayoutService } from '../viewportLayoutService';

describe('viewportLayoutService (skeleton)', () => {
  beforeEach(() => {
    viewportLayoutService.dispose();
  });

  it('initializes idempotently and defaults to a 1x1 grid', () => {
    expect(viewportLayoutService.isInitialized()).toBe(false);
    viewportLayoutService.initialize();
    viewportLayoutService.initialize();
    expect(viewportLayoutService.isInitialized()).toBe(true);
    expect(viewportLayoutService.getLayout()).toEqual({ rows: 1, cols: 1 });
    expect(viewportLayoutService.getPanelCount()).toBe(1);
  });

  it('sets layout and computes panel count', () => {
    viewportLayoutService.initialize();
    viewportLayoutService.setLayout({ rows: 2, cols: 3 });
    expect(viewportLayoutService.getLayout()).toEqual({ rows: 2, cols: 3 });
    expect(viewportLayoutService.getPanelCount()).toBe(6);
  });

  it('clamps invalid dimensions to >= 1', () => {
    viewportLayoutService.initialize();
    viewportLayoutService.setLayout({ rows: 0, cols: -4 });
    expect(viewportLayoutService.getLayout()).toEqual({ rows: 1, cols: 1 });
  });

  it('returns a defensive copy of the layout', () => {
    viewportLayoutService.initialize();
    viewportLayoutService.setLayout({ rows: 2, cols: 2 });
    const snap = viewportLayoutService.getLayout();
    snap.rows = 99;
    expect(viewportLayoutService.getLayout().rows).toBe(2);
  });

  it('resets to default and clears state on dispose', () => {
    viewportLayoutService.initialize();
    viewportLayoutService.setLayout({ rows: 4, cols: 4 });
    viewportLayoutService.dispose();
    expect(viewportLayoutService.isInitialized()).toBe(false);
    expect(viewportLayoutService.getLayout()).toEqual({ rows: 1, cols: 1 });
  });
});
