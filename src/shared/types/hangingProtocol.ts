/**
 * Hanging Protocol types and built-in protocol definitions.
 *
 * A hanging protocol defines a layout and rules for automatically
 * assigning scans to viewport panels based on scan metadata.
 */
import type { LayoutType } from './viewer';
import type { XnatScan } from './xnat';

// ─── Matcher & Rule Types ────────────────────────────────────────

/** Rule for matching a scan to a panel */
export interface ScanMatcher {
  /** Match scan seriesDescription (case-insensitive substring) */
  descriptionContains?: string[];
  /** Match scan modality exactly */
  modality?: string;
  /** Match scan type (case-insensitive substring) */
  typeContains?: string[];
  /** Among candidates, prefer the scan with the most frames */
  preferMostFrames?: boolean;
}

/** Assignment rule: which scan goes in which panel */
export interface PanelRule {
  /** 0-based panel position in the layout grid */
  panelIndex: number;
  /** Human-readable label for UI display (e.g. "T1 Axial") */
  label: string;
  /** How to find the right scan for this panel */
  matcher: ScanMatcher;
  /** If true, the protocol is not considered a match when this rule has no scan */
  required?: boolean;
}

// ─── Protocol Definition ─────────────────────────────────────────

/** A hanging protocol definition */
export interface HangingProtocol {
  /** Unique identifier */
  id: string;
  /** Display name for the protocol picker */
  name: string;
  /** Only consider this protocol when session modality matches (e.g. "CT", "MR") */
  modality?: string;
  /** Grid layout to apply when this protocol is active */
  layout: LayoutType;
  /** Panel assignment rules */
  rules: PanelRule[];
  /** Higher priority = preferred when multiple protocols match. Default 0. */
  priority: number;
}

/** Result of applying a protocol to a set of scans */
export interface ProtocolResult {
  /** The protocol that was applied */
  protocol: HangingProtocol;
  /** panelIndex → matched scan */
  assignments: Map<number, XnatScan>;
  /** Scans that didn't match any panel rule */
  unmatched: XnatScan[];
}

// ─── Built-in Protocols ──────────────────────────────────────────

export const BUILT_IN_PROTOCOLS: HangingProtocol[] = [
  {
    id: 'ct-contrast',
    name: 'CT Pre/Post Contrast',
    modality: 'CT',
    layout: '1x2',
    priority: 10,
    rules: [
      {
        panelIndex: 0,
        label: 'Pre-Contrast',
        matcher: { descriptionContains: ['pre', 'without', 'non-contrast', 'non contrast'] },
      },
      {
        panelIndex: 1,
        label: 'Post-Contrast',
        matcher: { descriptionContains: ['post', 'with contrast', 'contrast', 'enhanced', 'ce'] },
      },
    ],
  },
  {
    id: 'mr-brain',
    name: 'MR Brain Standard',
    modality: 'MR',
    layout: '2x2',
    priority: 10,
    rules: [
      {
        panelIndex: 0,
        label: 'T1',
        matcher: { descriptionContains: ['t1', 'mprage', 'bravo', 'spgr'] },
      },
      {
        panelIndex: 1,
        label: 'T2',
        matcher: { descriptionContains: ['t2'] },
      },
      {
        panelIndex: 2,
        label: 'FLAIR',
        matcher: { descriptionContains: ['flair'] },
      },
      {
        panelIndex: 3,
        label: 'DWI',
        matcher: { descriptionContains: ['dwi', 'diffusion', 'adc', 'dti'] },
      },
    ],
  },
  {
    id: 'two-series',
    name: 'Side by Side',
    layout: '1x2',
    priority: 1,
    rules: [
      {
        panelIndex: 0,
        label: 'Series 1',
        matcher: { preferMostFrames: true },
      },
      {
        panelIndex: 1,
        label: 'Series 2',
        matcher: {},
      },
    ],
  },
  {
    id: 'single',
    name: 'Single Series',
    layout: '1x1',
    priority: 0,
    rules: [
      {
        panelIndex: 0,
        label: 'Primary',
        matcher: { preferMostFrames: true },
      },
    ],
  },
];
