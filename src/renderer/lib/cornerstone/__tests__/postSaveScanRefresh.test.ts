import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createXnatTransportService } from '../transportService';

vi.mock('../../../stores/transportStore', () => ({
  useTransportStore: {
    getState: () => ({ setPhase: vi.fn(), markSaved: vi.fn(), setError: vi.fn() }),
  },
}));

const transport = vi.hoisted(() => ({
  save: vi.fn(async () => ({ ok: true, versionToken: 'v1' }) as never),
  getServerVersion: vi.fn(async () => 'v1'),
}));
vi.mock('../xnatTransport', () => ({ createXnatTransport: () => transport }));

/**
 * A save can CREATE a derived scan on the server — the first save of a new annotation
 * always does. Nothing observed that, so the session's scan list stayed stale: the
 * annotation count in the XNAT browser did not move, and re-opening the source scan found
 * nothing to auto-load even though the annotation was on the server.
 */
describe('a successful save reports that the server changed', () => {
  beforeEach(() => {
    transport.save.mockResolvedValue({ ok: true, versionToken: 'v1' } as never);
  });

  const build = (onSaved: (id: string) => void) =>
    createXnatTransportService({
      api: {} as never,
      serialize: async () => ({ containerId: 'c1', kind: 'SEG' }) as never,
      kindOf: () => 'SEG',
      onSaved,
    });

  it('calls onSaved when the save succeeds', async () => {
    const onSaved = vi.fn();
    await build(onSaved).saveContainer('c1');
    expect(onSaved).toHaveBeenCalledWith('c1');
  });

  it('does NOT call onSaved when the save fails — nothing was created to go and read', async () => {
    transport.save.mockResolvedValue({ ok: false, kind: 'transient', error: 'boom' } as never);
    const onSaved = vi.fn();
    await build(onSaved).saveContainer('c1');
    expect(onSaved).not.toHaveBeenCalled();
  });
});
