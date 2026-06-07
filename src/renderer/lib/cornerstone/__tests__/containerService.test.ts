import { describe, it, expect, beforeEach } from 'vitest';
import { containerService } from '../containerService';
import type { Container } from '@shared/types/annotation';

function makeContainer(id: string): Container {
  return {
    id,
    kind: 'SEG',
    label: `Container ${id}`,
    members: [],
    source: { projectId: 'P1', subjectId: 'S1', sessionId: 'E1', sourceScanId: '4' },
  };
}

describe('containerService (skeleton)', () => {
  beforeEach(() => {
    containerService.dispose();
  });

  it('initializes idempotently', () => {
    expect(containerService.isInitialized()).toBe(false);
    containerService.initialize();
    containerService.initialize();
    expect(containerService.isInitialized()).toBe(true);
  });

  it('registers, retrieves, lists, and unregisters containers', () => {
    containerService.initialize();
    const c = makeContainer('seg-1');
    containerService.register(c);

    expect(containerService.getContainer('seg-1')).toEqual(c);
    expect(containerService.listContainers()).toHaveLength(1);

    expect(containerService.unregister('seg-1')).toBe(true);
    expect(containerService.unregister('seg-1')).toBe(false);
    expect(containerService.getContainer('seg-1')).toBeUndefined();
  });

  it('clears the registry and resets state on dispose', () => {
    containerService.initialize();
    containerService.register(makeContainer('seg-1'));
    containerService.dispose();

    expect(containerService.isInitialized()).toBe(false);
    expect(containerService.listContainers()).toHaveLength(0);
  });
});
