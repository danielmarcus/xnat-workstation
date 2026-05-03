/**
 * Tests for the dirty-tracking suppression API in autoSave.ts.
 *
 * Coverage focus: per-segmentation deadline isolation. Earlier the
 * suppression window was global (`suppressDirtyTrackingUntilMs`) so an
 * operation's grace period for segmentation A would also drop legitimate
 * user edits on segmentation B if they happened in the same ms range —
 * the root cause of the "brush stroke does not mark dirty" bug
 * (PHASES.md Item 1, 06-save-upload row, 10-layout-switching:399-416).
 *
 * The blanket counter (`runWithDirtyTrackingSuppressed`) is unaffected
 * and intentionally suppresses ALL events for the duration of the
 * synchronous block.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllSuppressionDeadlines,
  decrementSuppression,
  incrementSuppression,
  isDirtyTrackingSuppressed,
  runWithDirtyTrackingSuppressed,
  setDirtyTrackingSuppressedFor,
} from './autoSave';

describe('autoSave suppression API', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearAllSuppressionDeadlines();
  });
  afterEach(() => {
    vi.useRealTimers();
    clearAllSuppressionDeadlines();
  });

  describe('isDirtyTrackingSuppressed', () => {
    it('returns false on a fresh module with no suppression', () => {
      expect(isDirtyTrackingSuppressed()).toBe(false);
      expect(isDirtyTrackingSuppressed('any-seg')).toBe(false);
    });

    it('returns true while the blanket counter is active (no segmentationId)', () => {
      incrementSuppression();
      try {
        expect(isDirtyTrackingSuppressed()).toBe(true);
        expect(isDirtyTrackingSuppressed('any-seg')).toBe(true);
      } finally {
        decrementSuppression();
      }
      expect(isDirtyTrackingSuppressed()).toBe(false);
    });

    it('runWithDirtyTrackingSuppressed scopes the counter', () => {
      let inside = false;
      runWithDirtyTrackingSuppressed(() => {
        inside = isDirtyTrackingSuppressed();
      });
      expect(inside).toBe(true);
      expect(isDirtyTrackingSuppressed()).toBe(false);
    });
  });

  describe('per-segmentation deadlines', () => {
    it('suppresses only the targeted segmentationId', () => {
      setDirtyTrackingSuppressedFor('seg-A', 1000);
      expect(isDirtyTrackingSuppressed('seg-A')).toBe(true);
      expect(isDirtyTrackingSuppressed('seg-B')).toBe(false);
      // Without an id, only the blanket counter suppresses.
      expect(isDirtyTrackingSuppressed()).toBe(false);
    });

    it('expires after the deadline passes', () => {
      setDirtyTrackingSuppressedFor('seg-A', 1000);
      vi.advanceTimersByTime(999);
      expect(isDirtyTrackingSuppressed('seg-A')).toBe(true);
      vi.advanceTimersByTime(2);
      expect(isDirtyTrackingSuppressed('seg-A')).toBe(false);
    });

    it('extends but never shrinks the deadline (Math.max)', () => {
      setDirtyTrackingSuppressedFor('seg-A', 2000);
      // A subsequent shorter call must not pull the deadline in.
      setDirtyTrackingSuppressedFor('seg-A', 100);
      vi.advanceTimersByTime(500);
      expect(isDirtyTrackingSuppressed('seg-A')).toBe(true);
      vi.advanceTimersByTime(1600);
      expect(isDirtyTrackingSuppressed('seg-A')).toBe(false);
    });

    it('a longer subsequent call extends the deadline', () => {
      setDirtyTrackingSuppressedFor('seg-A', 500);
      vi.advanceTimersByTime(100);
      setDirtyTrackingSuppressedFor('seg-A', 5000);
      vi.advanceTimersByTime(2000);
      expect(isDirtyTrackingSuppressed('seg-A')).toBe(true);
    });

    it('ignores zero / negative ms', () => {
      setDirtyTrackingSuppressedFor('seg-A', 0);
      expect(isDirtyTrackingSuppressed('seg-A')).toBe(false);
      setDirtyTrackingSuppressedFor('seg-A', -100);
      expect(isDirtyTrackingSuppressed('seg-A')).toBe(false);
    });

    it('ignores empty segmentationId', () => {
      setDirtyTrackingSuppressedFor('', 1000);
      expect(isDirtyTrackingSuppressed('')).toBe(false);
    });
  });

  describe('isolation between segmentations', () => {
    it('a load operation on seg-A does not swallow user edits on seg-B', () => {
      // Simulate: removeSegmentationsFromViewport opens a 1500ms window for seg-A
      setDirtyTrackingSuppressedFor('seg-A', 1500);
      // Before the previous fix, the global deadline would also block seg-B.
      // Now seg-B is unaffected.
      vi.advanceTimersByTime(500);
      expect(isDirtyTrackingSuppressed('seg-A')).toBe(true);
      expect(isDirtyTrackingSuppressed('seg-B')).toBe(false);
    });

    it('overlapping windows for different segmentations are independent', () => {
      setDirtyTrackingSuppressedFor('seg-A', 400);
      vi.advanceTimersByTime(100);
      setDirtyTrackingSuppressedFor('seg-B', 1500);
      // At t=300, seg-A still suppressed (300 < 400), seg-B still suppressed.
      vi.advanceTimersByTime(200);
      expect(isDirtyTrackingSuppressed('seg-A')).toBe(true);
      expect(isDirtyTrackingSuppressed('seg-B')).toBe(true);
      // At t=500, seg-A expired (500 > 400), seg-B still active (400 < 1500).
      vi.advanceTimersByTime(200);
      expect(isDirtyTrackingSuppressed('seg-A')).toBe(false);
      expect(isDirtyTrackingSuppressed('seg-B')).toBe(true);
      // At t=1700, both expired.
      vi.advanceTimersByTime(1200);
      expect(isDirtyTrackingSuppressed('seg-A')).toBe(false);
      expect(isDirtyTrackingSuppressed('seg-B')).toBe(false);
    });
  });

  describe('clearAllSuppressionDeadlines', () => {
    it('drops every per-seg deadline', () => {
      setDirtyTrackingSuppressedFor('seg-A', 5000);
      setDirtyTrackingSuppressedFor('seg-B', 5000);
      clearAllSuppressionDeadlines();
      expect(isDirtyTrackingSuppressed('seg-A')).toBe(false);
      expect(isDirtyTrackingSuppressed('seg-B')).toBe(false);
    });

    it('does not affect the blanket counter', () => {
      incrementSuppression();
      try {
        clearAllSuppressionDeadlines();
        expect(isDirtyTrackingSuppressed()).toBe(true);
      } finally {
        decrementSuppression();
      }
    });
  });
});
