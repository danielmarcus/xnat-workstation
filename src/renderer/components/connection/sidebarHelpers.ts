/**
 * Pure helpers for the XNAT browser sidebar — spec §7.
 *
 * Lifted out of `XnatBrowser.tsx` so each piece is independently
 * testable without rendering the 1500-line component tree:
 *   - Modality detection at the scans level (drives the PET/CT chip
 *     row, spec §7.2).
 *   - Derived-assessor counting (spec §7.4 footer pill).
 *   - Multi-select range computation (spec §7.5 Shift-click).
 *   - Bulk-load layout options (spec §7.5 "Load 1×N / 2×2").
 *
 * No store reads — caller passes data in. No DOM access.
 */
import type { XnatScan } from '@shared/types/xnat';
import {
  isRtStructScan,
  isSegScan,
  isSrScan,
} from '../../stores/sessionDerivedIndexStore';

// ─── Modality detection (spec §7.2) ───────────────────────────────

/**
 * Set of distinct modality codes present in a list of scans. Empty
 * / unknown modalities are dropped. Result is uppercased so callers
 * can compare against `'PT'` / `'CT'` directly.
 */
export function sessionModalities(scans: ReadonlyArray<XnatScan>): string[] {
  const set = new Set<string>();
  for (const s of scans) {
    const m = (s.modality ?? '').trim().toUpperCase();
    if (m) set.add(m);
  }
  return Array.from(set).sort();
}

/**
 * Whether the session contains scans from more than one modality.
 * Drives the chip-row visibility per spec §7.2 PET/CT special case.
 */
export function hasMixedModality(scans: ReadonlyArray<XnatScan>): boolean {
  return sessionModalities(scans).length > 1;
}

// ─── Derived-assessor counts (spec §7.4) ──────────────────────────

export interface DerivedAssessorCounts {
  seg: number;
  rtstruct: number;
  sr: number;
  /** Sum of seg + rtstruct + sr. Other derived kinds aren't surfaced today. */
  total: number;
}

/**
 * Count SEG / RTSTRUCT / SR among the session's derived scans.
 * Anything else (RTPLAN, RTDOSE, REG, KO, etc.) doesn't appear in
 * the §7.4 pill — the count covers the three annotation peers.
 */
export function countDerivedAssessors(scans: ReadonlyArray<XnatScan>): DerivedAssessorCounts {
  let seg = 0;
  let rtstruct = 0;
  let sr = 0;
  for (const scan of scans) {
    if (isSegScan(scan)) seg++;
    else if (isRtStructScan(scan)) rtstruct++;
    else if (isSrScan(scan)) sr++;
  }
  return { seg, rtstruct, sr, total: seg + rtstruct + sr };
}

/**
 * Localised copy for the spec §7.4 pill. Returns `null` when there
 * are no derived assessors to surface.
 */
export function derivedPillLabel(counts: DerivedAssessorCounts): string | null {
  if (counts.total === 0) return null;
  const parts: string[] = [];
  if (counts.seg > 0) parts.push(`${counts.seg} SEG`);
  if (counts.rtstruct > 0) parts.push(`${counts.rtstruct} RTSTRUCT`);
  if (counts.sr > 0) parts.push(`${counts.sr} SR`);
  const headline = `${counts.total} annotation${counts.total === 1 ? '' : 's'} auto-load`;
  return `${headline}   (${parts.join(' · ')})`;
}

// ─── Multi-select range (spec §7.5) ───────────────────────────────

/**
 * Return the inclusive id range between `anchor` and `target` from
 * the `allIds` list — used for Shift+click range selection. If
 * either id isn't in the list, returns just `[target]`. Always
 * returns ids in display order (the order in `allIds`).
 */
export function selectRange(
  allIds: ReadonlyArray<string>,
  anchor: string,
  target: string,
): string[] {
  const anchorIdx = allIds.indexOf(anchor);
  const targetIdx = allIds.indexOf(target);
  if (anchorIdx === -1 || targetIdx === -1) return [target];
  const [lo, hi] = anchorIdx <= targetIdx
    ? [anchorIdx, targetIdx]
    : [targetIdx, anchorIdx];
  return allIds.slice(lo, hi + 1);
}

/**
 * Toggle a single id in / out of a selection set — for Cmd/Ctrl+click.
 * Returns a fresh array; never mutates input.
 */
export function toggleSelection(
  current: ReadonlyArray<string>,
  id: string,
): string[] {
  return current.includes(id)
    ? current.filter((x) => x !== id)
    : [...current, id];
}

// ─── Bulk-load layouts (spec §7.5) ────────────────────────────────

export interface BulkLoadOption {
  /** Display label (e.g. "1×3" or "2×2"). */
  label: string;
  /** Grid dimensions for `setCustomLayout(rows, cols)`. */
  rows: number;
  cols: number;
  /** Max scans this layout consumes — `rows * cols`. */
  capacity: number;
}

/**
 * Layouts available for the §7.5 bulk-load action bar given N
 * selected scans:
 *   - "Load 1×N" — single linear strip sized for the selection
 *     (capped at 1×4 — the largest single-row preset). Caller drops
 *     leftovers when N > 4.
 *   - "2×2" — visible only when N ≤ 4 per spec §7.5.
 *
 * The action bar itself is hidden when N < 2 (caller checks
 * `result.length === 0`).
 */
export function bulkLoadOptions(selectedCount: number): BulkLoadOption[] {
  if (selectedCount < 2) return [];
  const opts: BulkLoadOption[] = [];
  if (selectedCount === 2) opts.push({ label: '1×2', rows: 1, cols: 2, capacity: 2 });
  else if (selectedCount === 3) opts.push({ label: '1×3', rows: 1, cols: 3, capacity: 3 });
  else opts.push({ label: '1×4', rows: 1, cols: 4, capacity: 4 });
  if (selectedCount <= 4) opts.push({ label: '2×2', rows: 2, cols: 2, capacity: 4 });
  return opts;
}
