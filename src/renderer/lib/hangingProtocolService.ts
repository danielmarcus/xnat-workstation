/**
 * Hanging Protocol Service — matches scans against protocol rules
 * and assigns them to viewport panels.
 *
 * Pure logic, no UI dependencies.
 */
import type { XnatScan } from '@shared/types/xnat';
import type {
  HangingProtocol,
  PanelRule,
  ProtocolResult,
  ScanMatcher,
} from '@shared/types/hangingProtocol';
import { BUILT_IN_PROTOCOLS } from '@shared/types/hangingProtocol';

// ─── Matcher Helpers ─────────────────────────────────────────────

/**
 * Check if a scan matches a single matcher rule.
 * Returns true if ALL specified criteria match (AND logic across fields).
 * An empty matcher matches any scan.
 */
function scanMatchesMatcher(scan: XnatScan, matcher: ScanMatcher): boolean {
  // Modality exact match (case-insensitive)
  if (matcher.modality) {
    if (!scan.modality || scan.modality.toUpperCase() !== matcher.modality.toUpperCase()) {
      return false;
    }
  }

  // Description contains ANY of the strings (case-insensitive)
  if (matcher.descriptionContains && matcher.descriptionContains.length > 0) {
    const desc = (scan.seriesDescription ?? '').toLowerCase();
    const matched = matcher.descriptionContains.some((s) => desc.includes(s.toLowerCase()));
    if (!matched) return false;
  }

  // Type contains ANY of the strings (case-insensitive)
  if (matcher.typeContains && matcher.typeContains.length > 0) {
    const type = (scan.type ?? '').toLowerCase();
    const matched = matcher.typeContains.some((s) => type.includes(s.toLowerCase()));
    if (!matched) return false;
  }

  // preferMostFrames is a sorting hint, not a filter — always passes
  return true;
}

/**
 * Find the best matching scan for a panel rule from the available pool.
 * Returns the matched scan or null.
 */
function findBestMatch(
  rule: PanelRule,
  availableScans: XnatScan[],
): XnatScan | null {
  // Filter candidates that match the criteria
  const candidates = availableScans.filter((s) => scanMatchesMatcher(s, rule.matcher));

  if (candidates.length === 0) return null;

  // If preferMostFrames, sort by frames descending and pick first
  if (rule.matcher.preferMostFrames) {
    candidates.sort((a, b) => (b.frames ?? 0) - (a.frames ?? 0));
  }

  return candidates[0];
}

// ─── Protocol Scoring ────────────────────────────────────────────

/**
 * Try to apply a protocol to a set of scans. Returns the assignment
 * result with a score (number of matched rules).
 */
function tryProtocol(
  protocol: HangingProtocol,
  scans: XnatScan[],
): { score: number; result: ProtocolResult } | null {
  const remaining = [...scans];
  const assignments = new Map<number, XnatScan>();
  let matchedCount = 0;

  for (const rule of protocol.rules) {
    const match = findBestMatch(rule, remaining);
    if (match) {
      assignments.set(rule.panelIndex, match);
      // Remove from remaining pool so each scan is used once
      const idx = remaining.indexOf(match);
      if (idx >= 0) remaining.splice(idx, 1);
      matchedCount++;
    } else if (rule.required) {
      // Required rule couldn't be matched — protocol fails
      return null;
    }
  }

  // Need at least one match for the protocol to be viable
  if (matchedCount === 0) return null;

  return {
    score: matchedCount,
    result: {
      protocol,
      assignments,
      unmatched: remaining,
    },
  };
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Apply a specific protocol to a set of scans.
 * Always returns a result (even with 0 matches).
 */
export function applyProtocol(
  scans: XnatScan[],
  protocol: HangingProtocol,
): ProtocolResult {
  const remaining = [...scans];
  const assignments = new Map<number, XnatScan>();

  for (const rule of protocol.rules) {
    const match = findBestMatch(rule, remaining);
    if (match) {
      assignments.set(rule.panelIndex, match);
      const idx = remaining.indexOf(match);
      if (idx >= 0) remaining.splice(idx, 1);
    }
  }

  return { protocol, assignments, unmatched: remaining };
}

/**
 * Auto-detect the best protocol for a set of scans.
 *
 * Tries all provided protocols (or built-ins) sorted by priority.
 * Returns the best match, or a fallback auto-layout if nothing matches.
 */
export function matchProtocol(
  scans: XnatScan[],
  protocols: HangingProtocol[] = BUILT_IN_PROTOCOLS,
): ProtocolResult {
  if (scans.length === 0) {
    // No scans — return single layout with empty assignments
    const fallback = protocols.find((p) => p.id === 'single') ?? protocols[protocols.length - 1];
    return { protocol: fallback, assignments: new Map(), unmatched: [] };
  }

  // Determine dominant modality from scans (most common)
  const modalityCounts = new Map<string, number>();
  for (const scan of scans) {
    const mod = (scan.modality ?? '').toUpperCase();
    if (mod) modalityCounts.set(mod, (modalityCounts.get(mod) ?? 0) + 1);
  }
  const dominantModality = modalityCounts.size > 0
    ? [...modalityCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
    : null;

  // Sort protocols: highest priority first
  const sorted = [...protocols].sort((a, b) => b.priority - a.priority);

  let bestResult: { score: number; result: ProtocolResult } | null = null;

  for (const protocol of sorted) {
    // Skip protocols that require a modality that doesn't match
    if (protocol.modality && dominantModality && protocol.modality.toUpperCase() !== dominantModality) {
      continue;
    }

    const attempt = tryProtocol(protocol, scans);
    if (!attempt) continue;

    // Prefer: higher priority first, then higher score
    if (!bestResult || attempt.score > bestResult.score) {
      bestResult = attempt;
    }

    // If all rules matched, this is a perfect fit — stop searching
    if (attempt.score === protocol.rules.length) {
      bestResult = attempt;
      break;
    }
  }

  if (bestResult) return bestResult.result;

  // Fallback: auto-layout based on scan count
  return createFallbackResult(scans);
}

/**
 * Create a fallback result that distributes scans left-to-right
 * with a layout based on scan count.
 */
function createFallbackResult(scans: XnatScan[]): ProtocolResult {
  // Pick layout based on count
  const layoutId = scans.length === 1 ? 'single'
    : scans.length === 2 ? 'two-series'
    : 'single'; // For 3+ scans, still use the best-matching protocol above

  const protocol = BUILT_IN_PROTOCOLS.find((p) => p.id === layoutId)
    ?? BUILT_IN_PROTOCOLS[BUILT_IN_PROTOCOLS.length - 1];

  // Auto-layout fallback protocol for arbitrary scan counts
  const autoLayout = scans.length <= 1 ? '1x1' as const
    : scans.length <= 2 ? '1x2' as const
    : '2x2' as const;

  const autoProtocol: HangingProtocol = {
    id: 'auto',
    name: 'Auto Layout',
    layout: autoLayout,
    priority: -1,
    rules: scans.slice(0, autoLayout === '2x2' ? 4 : autoLayout === '1x2' ? 2 : 1).map((_, i) => ({
      panelIndex: i,
      label: `Series ${i + 1}`,
      matcher: {},
    })),
  };

  // Assign scans left-to-right, prefer most frames for first panel
  const sorted = [...scans].sort((a, b) => (b.frames ?? 0) - (a.frames ?? 0));
  const maxPanels = autoLayout === '2x2' ? 4 : autoLayout === '1x2' ? 2 : 1;
  const assignments = new Map<number, XnatScan>();
  const assigned = sorted.slice(0, maxPanels);
  assigned.forEach((scan, i) => assignments.set(i, scan));

  return {
    protocol: autoProtocol,
    assignments,
    unmatched: sorted.slice(maxPanels),
  };
}
