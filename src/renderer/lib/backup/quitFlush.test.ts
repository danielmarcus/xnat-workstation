import { describe, expect, it, vi } from 'vitest';
import {
  runQuitFlush,
  summarizeQuitFlush,
  type QuitFlushSaveFn,
  type QuitFlushItem,
} from './quitFlush';

const items: QuitFlushItem[] = [
  { id: 'a', name: 'Tumor A' },
  { id: 'b', name: 'Heart B' },
  { id: 'c', name: 'Liver C' },
];

describe('runQuitFlush', () => {
  it('empty list → noop, durationMs reported', async () => {
    let t = 1000;
    const result = await runQuitFlush([], vi.fn(), () => (t += 5));
    expect(result.outcome).toBe('noop');
    expect(result.savedIds).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('every item saves → outcome="all-ok"; saved ids in input order', async () => {
    const seen: string[] = [];
    const saveFn: QuitFlushSaveFn = async (item) => {
      seen.push(item.id);
      return 'saved';
    };
    const result = await runQuitFlush(items, saveFn);
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(result.outcome).toBe('all-ok');
    expect(result.savedIds).toEqual(['a', 'b', 'c']);
    expect(result.failures).toEqual([]);
  });

  it("'failed' adapter outcome → failure with generic message", async () => {
    const saveFn: QuitFlushSaveFn = async (item) => (item.id === 'b' ? 'failed' : 'saved');
    const result = await runQuitFlush(items, saveFn);
    expect(result.outcome).toBe('partial-fail');
    expect(result.savedIds).toEqual(['a', 'c']);
    expect(result.failures).toEqual([
      { id: 'b', name: 'Heart B', errorMessage: 'Backup failed' },
    ]);
  });

  it('thrown error → failure carries the error message; batch continues', async () => {
    const saveFn: QuitFlushSaveFn = async (item) => {
      if (item.id === 'b') throw new Error('ENOSPC: no space left');
      return 'saved';
    };
    const result = await runQuitFlush(items, saveFn);
    expect(result.outcome).toBe('partial-fail');
    expect(result.savedIds).toEqual(['a', 'c']);
    expect(result.failures[0]).toEqual({ id: 'b', name: 'Heart B', errorMessage: 'ENOSPC: no space left' });
  });

  it('non-Error throw → stringified message', async () => {
    const saveFn: QuitFlushSaveFn = async () => {
      throw 'EACCES';
    };
    const result = await runQuitFlush([items[0]], saveFn);
    expect(result.failures[0].errorMessage).toBe('EACCES');
  });

  it('arbitrary string outcome ≠ "saved"/"failed" is captured as the error message', async () => {
    const saveFn: QuitFlushSaveFn = async () => 'permission denied';
    const result = await runQuitFlush([items[0]], saveFn);
    expect(result.failures[0].errorMessage).toBe('permission denied');
  });

  it('flush is sequential — saveFn for item N+1 starts only after item N resolves', async () => {
    let inFlight = 0;
    let maxConcurrent = 0;
    const saveFn: QuitFlushSaveFn = async () => {
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return 'saved';
    };
    await runQuitFlush(items, saveFn);
    expect(maxConcurrent).toBe(1);
  });
});

describe('summarizeQuitFlush', () => {
  it('all-ok → friendly success copy', () => {
    expect(summarizeQuitFlush({
      outcome: 'all-ok', savedIds: [], failures: [], durationMs: 0,
    })).toMatch(/All changes backed up/);
  });

  it('noop → same success copy', () => {
    expect(summarizeQuitFlush({
      outcome: 'noop', savedIds: [], failures: [], durationMs: 0,
    })).toMatch(/All changes backed up/);
  });

  it('partial-fail with ≤ maxNames lists every failed name', () => {
    const msg = summarizeQuitFlush({
      outcome: 'partial-fail',
      savedIds: [],
      failures: [
        { id: 'a', name: 'Tumor A', errorMessage: 'x' },
        { id: 'b', name: 'Heart B', errorMessage: 'x' },
      ],
      durationMs: 0,
    });
    expect(msg).toMatch(/Tumor A, Heart B/);
    expect(msg).not.toMatch(/more/);
  });

  it('partial-fail beyond maxNames → "(+N more)"', () => {
    const failures = Array.from({ length: 5 }, (_, i) => ({
      id: String(i), name: `Item ${i}`, errorMessage: 'x',
    }));
    const msg = summarizeQuitFlush({
      outcome: 'partial-fail', savedIds: [], failures, durationMs: 0,
    }, 3);
    expect(msg).toMatch(/Item 0, Item 1, Item 2 \(\+2 more\)/);
  });
});
