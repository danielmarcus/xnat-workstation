/**
 * DicomHeaderPanel — right-side panel displaying all DICOM tags for the
 * currently displayed image in the active viewport.
 *
 * Features:
 * - Grouped by DICOM module (Patient, Study, Series, Equipment, etc.)
 * - Collapsible group sections
 * - Text search filtering across tag name, keyword, tag number, and value
 * - Private tag toggle (hidden by default)
 * - Auto-updates when scrolling through images or switching viewport
 * - Graceful handling of binary/sequence values
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
// eslint-disable-next-line no-restricted-imports -- BOUNDARY-DEBT: pre-rewrite legacy, removed during annotation rebuild (R1–R3)
import { cachedDataset } from '../../lib/cornerstone/dicomDatasetSource';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { isPhiTag, PHI_MASK } from '@shared/phi';
import { useViewerStore } from '../../stores/viewerStore';
// eslint-disable-next-line no-restricted-imports -- BOUNDARY-DEBT: pre-rewrite legacy, removed during annotation rebuild (R1–R3)
import { viewportService } from '../../lib/cornerstone/viewportService';
import {
  DICOM_TAG_DICTIONARY,
  DICOM_TAG_GROUPS_ORDER,
  formatTagKey,
  isPrivateTag,
  type DicomTagGroup,
} from '@shared/dicomTagDictionary';
import { IconClose } from '../icons';

// ─── Types ──────────────────────────────────────────────────────────

interface ParsedTag {
  /** Raw tag key, e.g. 'x00100010' */
  tagKey: string;
  /** Formatted tag, e.g. '(0010,0010)' */
  tag: string;
  /** Human-readable name or raw keyword */
  name: string;
  /** VR from dictionary or element */
  vr: string;
  /** Display value (string, formatted number, or placeholder) */
  value: string;
  /** Module group for section grouping */
  group: DicomTagGroup;
  /** Whether this is a private tag (odd group number) */
  isPrivate: boolean;
}

// ─── String VRs that can be read via dataSet.string() ───────────────
const STRING_VRS = new Set([
  'AE', 'AS', 'AT', 'CS', 'DA', 'DS', 'DT', 'IS', 'LO', 'LT',
  'PN', 'SH', 'ST', 'TM', 'UC', 'UI', 'UR', 'UT',
]);

// ─── Value Extraction ───────────────────────────────────────────────

/**
 * Read a human-readable value from a dicom-parser DataSet element.
 */
function readTagValue(dataSet: any, element: any, tagKey: string): string {
  const vr = element.vr ?? '';
  const length = element.length ?? 0;

  // Pixel Data — just show size
  if (tagKey === 'x7fe00010') {
    return `<pixel data: ${formatBytes(length)}>`;
  }

  // Sequences
  if (vr === 'SQ') {
    const items = element.items;
    const count = Array.isArray(items) ? items.length : 0;
    return `<sequence: ${count} item${count !== 1 ? 's' : ''}>`;
  }

  // Binary data types
  if (['OB', 'OW', 'OF', 'OD', 'UN'].includes(vr)) {
    if (length > 64) {
      return `<binary: ${formatBytes(length)}>`;
    }
    // Short binary — try to read as string
    try {
      const val = dataSet.string(tagKey);
      if (val != null && val.length > 0) return val;
    } catch { /* fall through */ }
    return `<binary: ${formatBytes(length)}>`;
  }

  // Numeric VRs
  try {
    if (vr === 'US') return String(dataSet.uint16(tagKey) ?? '');
    if (vr === 'SS') return String(dataSet.int16(tagKey) ?? '');
    if (vr === 'UL') return String(dataSet.uint32(tagKey) ?? '');
    if (vr === 'SL') return String(dataSet.int32(tagKey) ?? '');
    if (vr === 'FL') return String(dataSet.float(tagKey) ?? '');
    if (vr === 'FD') return String(dataSet.double(tagKey) ?? '');
  } catch { /* fall through to string */ }

  // String VRs and fallback
  if (STRING_VRS.has(vr) || vr === '' || vr === undefined) {
    try {
      const val = dataSet.string(tagKey);
      if (val == null) return '';

      // Format date values
      if (vr === 'DA' && val.length === 8) {
        return `${val.substring(0, 4)}-${val.substring(4, 6)}-${val.substring(6, 8)}`;
      }
      // Format time values
      if (vr === 'TM' && val.length >= 6) {
        const h = val.substring(0, 2);
        const m = val.substring(2, 4);
        const s = val.substring(4, 6);
        const frac = val.length > 6 ? val.substring(6) : '';
        return `${h}:${m}:${s}${frac ? `.${frac.replace('.', '')}` : ''}`;
      }

      return val.trim();
    } catch {
      return '';
    }
  }

  return '';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Parse all tags from a DataSet ──────────────────────────────────

function parseDataSet(dataSet: any): ParsedTag[] {
  if (!dataSet?.elements) return [];

  const tags: ParsedTag[] = [];

  for (const tagKey of Object.keys(dataSet.elements)) {
    const element = dataSet.elements[tagKey];
    const dictEntry = DICOM_TAG_DICTIONARY[tagKey];
    const priv = isPrivateTag(tagKey);

    const vr = dictEntry?.vr ?? element.vr ?? '';
    const name = dictEntry?.name ?? (priv ? '[Private]' : tagKey);
    const group: DicomTagGroup = dictEntry?.group ?? 'Other';

    tags.push({
      tagKey,
      tag: formatTagKey(tagKey),
      name,
      vr,
      value: readTagValue(dataSet, element, tagKey),
      group,
      isPrivate: priv,
    });
  }

  // Sort by tag key
  tags.sort((a, b) => a.tagKey.localeCompare(b.tagKey));

  return tags;
}

// ─── Component ──────────────────────────────────────────────────────

interface DicomHeaderPanelProps {
  onClose: () => void;
}

export default function DicomHeaderPanel({ onClose }: DicomHeaderPanelProps) {
  const [search, setSearch] = useState('');
  const [showPrivate, setShowPrivate] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // Hide PHI (SegWorks parity D7): PHI values are masked unless revealed one at a time.
  const hidePhi = usePreferencesStore((s) => s.preferences.hidePhi === true);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const masked = (t: ParsedTag) => hidePhi && isPhiTag(t.tagKey) && !revealed.has(t.tagKey);

  // Subscribe to active viewport and image index changes
  const activeViewportId = useViewerStore((s) => s.activeViewportId);
  const imageIndex = useViewerStore(
    (s) => s.viewports[s.activeViewportId]?.imageIndex ?? 0,
  );

  // Fetch and parse DICOM tags whenever viewport or image changes
  const [allTags, setAllTags] = useState<ParsedTag[]>([]);
  const [currentImageId, setCurrentImageId] = useState<string>('');
  // A revealed PHI value is masked again when Hide PHI is switched (back) on, and when another
  // image is shown — revealing is for one value, now, not for the session.
  useEffect(() => { setRevealed(new Set()); }, [hidePhi, currentImageId]);

  useEffect(() => {
    const viewport = viewportService.getViewport(activeViewportId);
    if (!viewport) {
      setAllTags([]);
      setCurrentImageId('');
      return;
    }

    let imageId: string;
    try {
      imageId = viewport.getCurrentImageId();
    } catch {
      setAllTags([]);
      setCurrentImageId('');
      return;
    }

    if (!imageId) {
      setAllTags([]);
      setCurrentImageId('');
      return;
    }

    setCurrentImageId(imageId);

    try {
      const dataSet = cachedDataset(imageId);
      if (dataSet) {
        setAllTags(parseDataSet(dataSet));
      } else {
        setAllTags([]);
      }
    } catch (err) {
      console.warn('[DicomHeaderPanel] Failed to get dataset:', err);
      setAllTags([]);
    }
  }, [activeViewportId, imageIndex]);

  // Filter tags by search and private toggle
  const filteredTags = useMemo(() => {
    let tags = allTags;

    if (!showPrivate) {
      tags = tags.filter((t) => !t.isPrivate);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      tags = tags.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.tag.toLowerCase().includes(q) ||
          t.vr.toLowerCase().includes(q) ||
          // A masked value must not be findable: matching it would reveal it.
          (!masked(t) && t.value.toLowerCase().includes(q)) ||
          t.tagKey.toLowerCase().includes(q),
      );
    }

    return tags;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTags, search, showPrivate, hidePhi, revealed]);

  // Group tags by module
  const groupedTags = useMemo(() => {
    const groups = new Map<DicomTagGroup, ParsedTag[]>();

    for (const tag of filteredTags) {
      if (!groups.has(tag.group)) {
        groups.set(tag.group, []);
      }
      groups.get(tag.group)!.push(tag);
    }

    // Return ordered groups
    return DICOM_TAG_GROUPS_ORDER.filter((g) => groups.has(g)).map((g) => ({
      group: g,
      tags: groups.get(g)!,
    }));
  }, [filteredTags]);

  const toggleGroup = useCallback((group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  }, []);

  const totalCount = allTags.length;
  const visibleCount = filteredTags.length;
  const privateCount = allTags.filter((t) => t.isPrivate).length;

  return (
    <aside
      aria-label="DICOM tags"
      className="w-80 shrink-0 border-l border-zinc-800 bg-zinc-950 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-zinc-300">
          DICOM Tags
          <span className="text-zinc-500 font-normal ml-1.5">
            {visibleCount !== totalCount
              ? `${visibleCount} / ${totalCount}`
              : totalCount}
          </span>
        </h3>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-300 transition-colors p-1 rounded hover:bg-zinc-800"
          title="Close DICOM tags panel"
        >
          <IconClose className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Search + filter controls */}
      <div className="px-3 py-2 border-b border-zinc-800 space-y-1.5">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tags..."
          className="w-full px-2 py-1 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-300 placeholder-zinc-600 outline-none focus:border-zinc-500"
        />
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-500 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showPrivate}
            onChange={(e) => setShowPrivate(e.target.checked)}
            className="accent-blue-500"
          />
          Show private tags ({privateCount})
        </label>
      </div>

      {/* Tag list */}
      <div className="flex-1 overflow-y-auto">
        {allTags.length === 0 ? (
          <div className="p-3 text-xs text-zinc-600 text-center leading-relaxed">
            {currentImageId
              ? 'No DICOM tags available for this image.'
              : 'No image loaded in active viewport.'}
          </div>
        ) : filteredTags.length === 0 ? (
          <div className="p-3 text-xs text-zinc-600 text-center">
            No tags match &ldquo;{search}&rdquo;
          </div>
        ) : (
          groupedTags.map(({ group, tags }) => {
            const isCollapsed = collapsedGroups.has(group);
            return (
              <div key={group}>
                {/* Group header */}
                <button
                  onClick={() => toggleGroup(group)}
                  className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-zinc-400 bg-zinc-900/50 hover:bg-zinc-800/50 transition-colors sticky top-0 z-10"
                >
                  <svg
                    className={`w-3 h-3 shrink-0 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <polyline points="4,2 8,6 4,10" />
                  </svg>
                  {group}
                  <span className="text-zinc-600 font-normal">({tags.length})</span>
                </button>

                {/* Tag rows */}
                {!isCollapsed && (
                  <div className="divide-y divide-zinc-900">
                    {tags.map((t) => (
                      <div
                        key={t.tagKey}
                        data-tag={t.tag}
                        className="px-3 py-1 hover:bg-zinc-800/30 transition-colors group"
                      >
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-[10px] font-mono text-zinc-600 shrink-0">
                            {t.tag}
                          </span>
                          <span className="text-[10px] font-mono text-zinc-600 shrink-0 w-5">
                            {t.vr}
                          </span>
                          <span className="text-[11px] text-zinc-400 truncate">
                            {t.name}
                          </span>
                        </div>
                        {masked(t) ? (
                          <div className="flex items-center gap-2 text-[11px] mt-0.5" data-testid={`phi-masked:${t.tagKey}`}>
                            <span className="text-zinc-500 tracking-widest">{PHI_MASK}</span>
                            <button
                              type="button"
                              onClick={() => setRevealed((r) => new Set(r).add(t.tagKey))}
                              className="text-[10px] text-zinc-400 hover:text-zinc-200 underline"
                            >
                              Reveal
                            </button>
                          </div>
                        ) : (
                          <div
                            className="text-[11px] text-zinc-300 mt-0.5 break-all leading-snug"
                            title={t.value}
                          >
                            {t.value || <span className="text-zinc-700 italic">empty</span>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
