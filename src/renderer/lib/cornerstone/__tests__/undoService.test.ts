import { describe, it, expect, beforeEach } from 'vitest';
import { undoService } from '../undoService';

describe('undoService (skeleton)', () => {
  beforeEach(() => {
    undoService.dispose();
  });

  it('initializes idempotently', () => {
    expect(undoService.isInitialized()).toBe(false);
    undoService.initialize();
    undoService.initialize();
    expect(undoService.isInitialized()).toBe(true);
  });

  it('reports no undo/redo available and no-ops without throwing (inert skeleton)', () => {
    undoService.initialize();
    expect(undoService.canUndo()).toBe(false);
    expect(undoService.canRedo()).toBe(false);
    expect(() => undoService.undo()).not.toThrow();
    expect(() => undoService.redo()).not.toThrow();
  });

  it('resets state on dispose', () => {
    undoService.initialize();
    undoService.dispose();
    expect(undoService.isInitialized()).toBe(false);
  });
});
