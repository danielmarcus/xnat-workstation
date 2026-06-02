/**
 * DicomHeaderPanel — modal dialog displaying all DICOM tags for the
 * currently displayed image in the active viewport.
 *
 * Spec §10. Open via the toolbar Tags button or Shift+T. Resizable
 * via the bottom-right corner handle (640×480 default, 360×320 min,
 * up to 90% viewport). Close via ✕ / Esc / backdrop click.
 *
 * Features:
 * - Grouped by DICOM module (Patient · Study · Series · Equipment ·
 *   Acquisition · Frame of Reference · Image · Other)
 * - Collapsible group sections
 * - Text search filtering across tag name, keyword, tag number, VR,
 *   and value
 * - Module-filter chips above the tag list (§10.5)
 * - Hover row reveals a copy icon (copies value)
 * - Right-click row → context menu with 4 copy variants (§10.6)
 * - Private tag toggle (hidden by default)
 * - Auto-updates when scrolling through images or switching viewport
 * - Graceful handling of binary/sequence values
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { wadouri } from '@cornerstonejs/dicom-image-loader';
import { useViewerStore } from '../../stores/viewerStore';
import { viewportService } from '../../lib/cornerstone/viewportService';
import {
  DICOM_TAG_DICTIONARY,
  DICOM_TAG_GROUPS_ORDER,
  formatTagKey,
  isPrivateTag,
  type DicomTagGroup,
} from '@shared/dicomTagDictionary';
import { IconClose, IconCopy } from '../icons';
import { toastService } from '../../lib/toast/toastService';

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
  // Spec §10.5 — module-filter chip. `null` = All.
  const [moduleFilter, setModuleFilter] = useState<DicomTagGroup | null>(null);
  // Spec §10.6 — right-click context menu state. Closed when null.
  const [contextMenu, setContextMenu] = useState<{
    tagKey: string;
    x: number;
    y: number;
  } | null>(null);

  // Subscribe to active viewport and image index changes
  const activeViewportId = useViewerStore((s) => s.activeViewportId);
  const imageIndex = useViewerStore(
    (s) => s.viewports[s.activeViewportId]?.imageIndex ?? 0,
  );

  // Fetch and parse DICOM tags whenever viewport or image changes
  const [allTags, setAllTags] = useState<ParsedTag[]>([]);
  const [currentImageId, setCurrentImageId] = useState<string>('');

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

    // Extract URI (strip wadouri: scheme)
    const uri = imageId.replace('wadouri:', '');

    try {
      const dataSet = wadouri.dataSetCacheManager.get(uri);
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

  // Filter tags by search, private toggle, and module chip.
  const filteredTags = useMemo(() => {
    let tags = allTags;

    if (!showPrivate) {
      tags = tags.filter((t) => !t.isPrivate);
    }

    if (moduleFilter !== null) {
      tags = tags.filter((t) => t.group === moduleFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      tags = tags.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.tag.toLowerCase().includes(q) ||
          t.vr.toLowerCase().includes(q) ||
          t.value.toLowerCase().includes(q) ||
          t.tagKey.toLowerCase().includes(q),
      );
    }

    return tags;
  }, [allTags, search, showPrivate, moduleFilter]);

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

  // ─── Copy actions (spec §10.6) ───
  const copy = useCallback(async (text: string, label: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      }
      toastService.notify({ kind: 'success', message: label });
    } catch (err) {
      toastService.notify({
        kind: 'error',
        message: 'Could not copy to clipboard',
        detail: err instanceof Error ? err.message : undefined,
      });
    }
  }, []);

  const copyValue = useCallback((tag: ParsedTag) => copy(tag.value, 'Copied value to clipboard.'), [copy]);
  const copyTagLine = useCallback(
    (tag: ParsedTag) => copy(`${tag.tag} ${tag.name} = ${tag.value}`, 'Copied tag line to clipboard.'),
    [copy],
  );
  const copyTagJson = useCallback(
    (tag: ParsedTag) => copy(JSON.stringify({ tag: tag.tag, vr: tag.vr, name: tag.name, value: tag.value }, null, 2), 'Copied tag as JSON.'),
    [copy],
  );
  const copyGroupJson = useCallback(
    (tag: ParsedTag) => {
      const groupTags = allTags
        .filter((t) => t.group === tag.group)
        .map((t) => ({ tag: t.tag, vr: t.vr, name: t.name, value: t.value }));
      copy(JSON.stringify({ group: tag.group, tags: groupTags }, null, 2), `Copied ${tag.group} module as JSON.`);
    },
    [allTags, copy],
  );

  // Close the context menu when the user clicks outside or scrolls.
  useEffect(() => {
    if (!contextMenu) return;
    const onPointerDown = () => setContextMenu(null);
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [contextMenu]);

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

  // Esc closes (spec §10.1).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      data-testid="dicom-tags-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dicom-tags-title"
      className="absolute inset-0 z-30 flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label="Close DICOM tags"
        data-testid="dicom-tags-scrim"
        className="absolute inset-0 bg-zinc-950/60"
        onClick={onClose}
      />

      <div
        data-testid="dicom-tags-dialog"
        className="relative w-[640px] h-[480px] max-w-[90%] max-h-[90%] bg-zinc-950 border border-zinc-700 rounded-xl shadow-2xl flex flex-col overflow-hidden"
      >
      {/* Header */}
      <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
        <h3 id="dicom-tags-title" className="text-xs font-semibold text-zinc-300">
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

      {/* Module-filter chips (spec §10.5). Single-select; "All" is the
          null state. */}
      <div
        data-testid="dicom-tags-module-chips"
        className="px-3 py-1.5 border-b border-zinc-800 flex flex-wrap gap-1"
      >
        {(['All', ...DICOM_TAG_GROUPS_ORDER] as const).map((label) => {
          const value = label === 'All' ? null : (label as DicomTagGroup);
          const active = moduleFilter === value;
          return (
            <button
              key={label}
              type="button"
              data-testid={`dicom-tags-chip:${label}`}
              data-active={active || undefined}
              onClick={() => setModuleFilter(value)}
              className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border transition-colors ${
                active
                  ? 'border-blue-500 bg-blue-900/30 text-blue-200'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
              }`}
            >
              {label}
            </button>
          );
        })}
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
                        data-testid={`dicom-tags-row:${t.tagKey}`}
                        className="px-3 py-1 hover:bg-zinc-800/30 transition-colors group relative"
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({ tagKey: t.tagKey, x: e.clientX, y: e.clientY });
                        }}
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
                          <button
                            type="button"
                            data-testid={`dicom-tags-copy:${t.tagKey}`}
                            onClick={() => copyValue(t)}
                            className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-zinc-500 hover:text-zinc-200 px-1 rounded hover:bg-zinc-800"
                            title="Copy value"
                            aria-label="Copy value"
                          >
                            <IconCopy className="w-3 h-3" />
                          </button>
                        </div>
                        <div
                          className="text-[11px] text-zinc-300 mt-0.5 break-all leading-snug"
                          title={t.value}
                        >
                          {t.value || <span className="text-zinc-700 italic">empty</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      </div>

      {contextMenu && (() => {
        const tag = allTags.find((t) => t.tagKey === contextMenu.tagKey);
        if (!tag) return null;
        return (
          <ul
            data-testid="dicom-tags-context-menu"
            role="menu"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            className="fixed z-40 bg-zinc-900 border border-zinc-700 rounded shadow-xl py-0.5 min-w-[200px] text-xs"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <ContextMenuItem
              testid="dicom-tags-ctx-copy-value"
              label="Copy value"
              onClick={() => { setContextMenu(null); copyValue(tag); }}
            />
            <ContextMenuItem
              testid="dicom-tags-ctx-copy-tagline"
              label={`Copy "${tag.tag} ${tag.name} = …"`}
              onClick={() => { setContextMenu(null); copyTagLine(tag); }}
            />
            <ContextMenuItem
              testid="dicom-tags-ctx-copy-json"
              label="Copy as JSON"
              onClick={() => { setContextMenu(null); copyTagJson(tag); }}
            />
            <ContextMenuItem
              testid="dicom-tags-ctx-copy-group-json"
              label={`Copy ${tag.group} module as JSON`}
              onClick={() => { setContextMenu(null); copyGroupJson(tag); }}
            />
          </ul>
        );
      })()}
    </div>
  );
}

function ContextMenuItem({
  testid,
  label,
  onClick,
}: {
  testid: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <li role="none">
      <button
        type="button"
        role="menuitem"
        data-testid={testid}
        onClick={onClick}
        className="block w-full text-left text-zinc-200 hover:bg-zinc-800 px-2 py-1 truncate"
      >
        {label}
      </button>
    </li>
  );
}
