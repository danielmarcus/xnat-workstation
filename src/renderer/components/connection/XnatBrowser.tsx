/**
 * XnatBrowser — drill-down panel for browsing XNAT hierarchy.
 *
 * Project > Subject > Session > Scan > Load
 *
 * Each level fetches data via IPC from the main process.
 * Selecting a scan triggers image loading.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { imageLoader } from '@cornerstonejs/core';
import type {
  XnatProject,
  XnatSubject,
  XnatSession,
  XnatScan,
} from '@shared/types/xnat';
import { useConnectionStore } from '../../stores/connectionStore';
import {
  IconPin,
  IconGrid4,
  IconList as IconListView,
  IconSegmentationAnnotation,
  IconStructureAnnotation,
} from '../icons';
import type { PinnedItem, NavigateToTarget } from '../../lib/pinnedItems';
import { isPinned } from '../../lib/pinnedItems';
import { dicomwebLoader } from '../../lib/cornerstone/dicomwebLoader';
import { pLimit } from '../../lib/util/pLimit';
import {
  useSessionDerivedIndexStore,
  isDerivedScan,
  isSegScan,
  isRtStructScan,
} from '../../stores/sessionDerivedIndexStore';

// ─── Component Props ──────────────────────────────────────────────

interface XnatBrowserProps {
  onLoadScan: (sessionId: string, scanId: string, scan: XnatScan, context: {
    projectId: string;
    subjectId: string;
    sessionLabel: string;
    projectName?: string;
    subjectLabel?: string;
  }) => void;
  onLoadSession?: (sessionId: string, scans: XnatScan[], context: {
    projectId: string;
    subjectId: string;
    sessionLabel: string;
    projectName?: string;
    subjectLabel?: string;
  }) => void;
  navigateTo?: NavigateToTarget | null;
  onNavigateComplete?: () => void;
  pinnedItems?: PinnedItem[];
  onTogglePin?: (item: PinnedItem) => void;
}

type Level = 'projects' | 'subjects' | 'sessions' | 'scans';
type ScanViewMode = 'list' | 'grid';
const XNAT_SCAN_DRAG_MIME = 'application/x-xnat-scan';
const XNAT_SCAN_DRAG_FALLBACK_MIME = 'text/x-xnat-scan';

interface ScanThumbnailState {
  status: 'loading' | 'ready' | 'error';
  dataUrl?: string;
}

interface XnatScanDragPayload {
  sessionId: string;
  scanId: string;
  scan: XnatScan;
  context: {
    projectId: string;
    subjectId: string;
    sessionLabel: string;
    projectName?: string;
    subjectLabel?: string;
  };
}

const NON_THUMB_MODALITIES = new Set([
  'SR',
  'SEG',
  'RTSTRUCT',
  'RTPLAN',
  'RTDOSE',
  'RTRECORD',
  'REG',
  'KO',
  'PR',
]);

const NON_THUMB_SOP_CLASS_UID_PREFIXES = [
  '1.2.840.10008.5.1.4.1.1.88.',  // SR family
  '1.2.840.10008.5.1.4.1.1.11.',  // Presentation State family
  '1.2.840.10008.5.1.4.1.1.481.', // RT object family
];

const NON_THUMB_SOP_CLASS_UIDS = new Set([
  '1.2.840.10008.5.1.4.1.1.66.4',   // SEG
  '1.2.840.10008.5.1.4.1.1.481.3',  // RTSTRUCT
  '1.2.840.10008.5.1.4.1.1.66',     // Surface Segmentation
]);

function scanSupportsThumbnail(scan: XnatScan): boolean {
  const sopClassUID = (scan.sopClassUID ?? '').trim();
  if (sopClassUID.length > 0) {
    if (
      NON_THUMB_SOP_CLASS_UIDS.has(sopClassUID)
      || NON_THUMB_SOP_CLASS_UID_PREFIXES.some((prefix) => sopClassUID.startsWith(prefix))
    ) {
      return false;
    }
    // Prefer SOP Class UID as the authoritative signal when available.
    return true;
  }

  const modality = (scan.modality ?? '').toUpperCase();
  const type = (scan.type ?? '').toUpperCase();
  const description = (scan.seriesDescription ?? '').toUpperCase();
  if (NON_THUMB_MODALITIES.has(modality) || NON_THUMB_MODALITIES.has(type)) {
    return false;
  }
  // Heuristics for sources that are effectively reports/objects, not image stacks.
  if (
    modality.includes('SR') ||
    type.includes('SR') ||
    type.includes('STRUCTURED') ||
    type.includes('REPORT') ||
    description.includes('STRUCTURED REPORT')
  ) {
    return false;
  }
  return true;
}

function isStructuredReportScan(scan: XnatScan): boolean {
  const sopClassUID = (scan.sopClassUID ?? '').trim();
  if (sopClassUID.startsWith('1.2.840.10008.5.1.4.1.1.88.')) {
    return true;
  }
  const modality = (scan.modality ?? '').toUpperCase();
  const type = (scan.type ?? '').toUpperCase();
  const description = (scan.seriesDescription ?? '').toUpperCase();
  return (
    modality === 'SR' ||
    type === 'SR' ||
    type.includes('STRUCTURED REPORT') ||
    description.includes('STRUCTURED REPORT')
  );
}

function isBrowsableSourceScan(scan: XnatScan): boolean {
  return !isDerivedScan(scan) && !isStructuredReportScan(scan);
}

function toThumbCanvas(source: HTMLCanvasElement, size = 120): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.fillStyle = '#101014';
  ctx.fillRect(0, 0, size, size);
  const scale = Math.min(size / source.width, size / source.height);
  const drawWidth = Math.max(1, Math.round(source.width * scale));
  const drawHeight = Math.max(1, Math.round(source.height * scale));
  const x = Math.floor((size - drawWidth) / 2);
  const y = Math.floor((size - drawHeight) / 2);
  ctx.drawImage(source, x, y, drawWidth, drawHeight);
  return canvas;
}

function getFirstNumber(value: unknown): number | null {
  if (Array.isArray(value)) {
    const n = Number(value[0]);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toThumbnailDataUrl(image: any): string | null {
  try {
    if (typeof image?.getCanvas === 'function') {
      const sourceCanvas = image.getCanvas();
      if (sourceCanvas && sourceCanvas.width > 0 && sourceCanvas.height > 0) {
        return toThumbCanvas(sourceCanvas).toDataURL('image/jpeg', 0.82);
      }
    }
  } catch {
    // Fall through to pixel-data rendering.
  }

  const rows = Number(image?.rows ?? image?.height ?? 0);
  const cols = Number(image?.columns ?? image?.width ?? 0);
  const pixelData: ArrayLike<number> | undefined = image?.getPixelData?.();
  if (!rows || !cols || !pixelData || pixelData.length === 0) return null;

  const count = rows * cols;
  const isRgb = pixelData.length >= count * 3;
  const slope = Number(image?.slope ?? image?.rescaleSlope ?? 1) || 1;
  const intercept = Number(image?.intercept ?? image?.rescaleIntercept ?? 0) || 0;
  let wc = getFirstNumber(image?.windowCenter);
  let ww = getFirstNumber(image?.windowWidth);

  let low = 0;
  let high = 1;
  if (wc != null && ww != null && ww > 0) {
    low = wc - ww / 2;
    high = wc + ww / 2;
  } else {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < count; i++) {
      const raw = isRgb
        ? (Number(pixelData[i * 3]) + Number(pixelData[i * 3 + 1]) + Number(pixelData[i * 3 + 2])) / 3
        : Number(pixelData[i]);
      const value = raw * slope + intercept;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
      min = 0;
      max = 1;
    }
    low = min;
    high = max;
  }
  if (high <= low) high = low + 1;

  const mono1 = String(image?.photometricInterpretation ?? '')
    .toUpperCase()
    .includes('MONOCHROME1');

  const source = document.createElement('canvas');
  source.width = cols;
  source.height = rows;
  const ctx = source.getContext('2d');
  if (!ctx) return null;
  const imageData = ctx.createImageData(cols, rows);
  const out = imageData.data;

  for (let i = 0; i < count; i++) {
    let gray: number;
    if (isRgb) {
      const r = Number(pixelData[i * 3]) || 0;
      const g = Number(pixelData[i * 3 + 1]) || 0;
      const b = Number(pixelData[i * 3 + 2]) || 0;
      gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    } else {
      const value = (Number(pixelData[i]) || 0) * slope + intercept;
      const norm = Math.max(0, Math.min(1, (value - low) / (high - low)));
      gray = Math.round(norm * 255);
    }
    if (mono1) gray = 255 - gray;
    const base = i * 4;
    out[base] = gray;
    out[base + 1] = gray;
    out[base + 2] = gray;
    out[base + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  return toThumbCanvas(source).toDataURL('image/jpeg', 0.82);
}

// ─── Level Icons ──────────────────────────────────────────────────

function ProjectIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0 text-blue-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 4.5 V12 A1 1 0 0 0 3 13 H13 A1 1 0 0 0 14 12 V6.5 A1 1 0 0 0 13 5.5 H8.5 L7 4 H3 A1 1 0 0 0 2 4.5 Z" />
    </svg>
  );
}

function SubjectIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0 text-violet-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="5" r="3" />
      <path d="M3 14 C3 11 5.5 9 8 9 C10.5 9 13 11 13 14" />
    </svg>
  );
}

function SessionIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0 text-emerald-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <line x1="2" y1="6" x2="14" y2="6" />
      <line x1="6" y1="6" x2="6" y2="14" />
    </svg>
  );
}

function ScanIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0 text-amber-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="12" height="12" rx="1.5" />
      <circle cx="5.5" cy="5.5" r="1.5" />
      <polyline points="2,12 5,9 7,11 10,7 14,12" />
    </svg>
  );
}

function LoadAllIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1" />
      <rect x="9" y="1.5" width="5.5" height="5.5" rx="1" />
      <rect x="1.5" y="9" width="5.5" height="5.5" rx="1" />
      <rect x="9" y="9" width="5.5" height="5.5" rx="1" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-zinc-500" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="7" r="4.5" />
      <line x1="10.2" y1="10.2" x2="14" y2="14" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="3" y1="3" x2="9" y2="9" />
      <line x1="9" y1="3" x2="3" y2="9" />
    </svg>
  );
}

function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      className={`w-3.5 h-3.5 ${spinning ? 'animate-spin' : ''}`}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 8a5.5 5.5 0 0 1 9.3-4" />
      <polyline points="12 2 12 5 9 5" />
      <path d="M13.5 8a5.5 5.5 0 0 1-9.3 4" />
      <polyline points="4 14 4 11 7 11" />
    </svg>
  );
}

// ─── Loading Spinner ──────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-8">
      <svg className="animate-spin h-5 w-5 text-zinc-500" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
        <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
      </svg>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────

export default function XnatBrowser({
  onLoadScan,
  onLoadSession,
  navigateTo,
  onNavigateComplete,
  pinnedItems: pinnedItemsProp,
  onTogglePin,
}: XnatBrowserProps) {
  const [level, setLevel] = useState<Level>('projects');
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // Data for each level
  const [projects, setProjects] = useState<XnatProject[]>([]);
  const [subjects, setSubjects] = useState<XnatSubject[]>([]);
  const [sessions, setSessions] = useState<XnatSession[]>([]);
  const [scans, setScans] = useState<XnatScan[]>([]);

  // Selected items for breadcrumb trail
  const [selectedProject, setSelectedProject] = useState<XnatProject | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<XnatSubject | null>(null);
  const [selectedSession, setSelectedSession] = useState<XnatSession | null>(null);
  const [scanViewMode, setScanViewMode] = useState<ScanViewMode>('list');

  // Subject-level session expansion + per-session scan caches
  const [expandedSessionIds, setExpandedSessionIds] = useState<Record<string, boolean>>({});
  const [sessionScansById, setSessionScansById] = useState<Record<string, XnatScan[]>>({});
  const [sessionScansLoadingById, setSessionScansLoadingById] = useState<Record<string, boolean>>({});
  const [sessionScansErrorById, setSessionScansErrorById] = useState<Record<string, string>>({});

  // Scan thumbnail cache (used in grid mode)
  const [scanThumbnails, setScanThumbnails] = useState<Record<string, ScanThumbnailState>>({});
  const thumbLoadRef = useRef(pLimit(2));
  const thumbInFlightRef = useRef<Set<string>>(new Set());

  // Per-subject modality breakdown: subjectId → { CT: 2, MR: 1 }
  const [subjectModalityMap, setSubjectModalityMap] = useState<Record<string, Record<string, number>>>({});
  const derivedIndex = useSessionDerivedIndexStore((s) => s.derivedIndex);
  const sourceSeriesUidByScanId = useSessionDerivedIndexStore((s) => s.sourceSeriesUidByScanId);
  const derivedRefSeriesUidByScanId = useSessionDerivedIndexStore((s) => s.derivedRefSeriesUidByScanId);
  const resolvedSessionIds = useSessionDerivedIndexStore((s) => s.resolvedSessionIds);
  const resolveAssociationsForSession = useSessionDerivedIndexStore(
    (s) => s.resolveAssociationsForSession,
  );
  const uidResolutionRequestedRef = useRef<Set<string>>(new Set());

  const thumbObserverRef = useRef<IntersectionObserver | null>(null);
  const thumbNodeByKeyRef = useRef<Map<string, Element>>(new Map());
  const [visibleThumbKeys, setVisibleThumbKeys] = useState<Record<string, true>>({});

  const sourceScans = useMemo(() => {
    return scans.filter(isBrowsableSourceScan);
  }, [scans]);

  const scanById = useMemo(() => {
    const map: Record<string, XnatScan> = {};
    for (const s of scans) map[s.id] = s;
    return map;
  }, [scans]);

  const overlayCountsBySourceScanId = useMemo(() => {
    const counts: Record<string, { seg: number; rt: number }> = {};
    for (const source of sourceScans) {
      const entry = derivedIndex[source.id];
      if (!entry) continue;
      const seg = entry.segScans.filter((s) => {
        const current = scanById[s.id];
        return Boolean(current && isSegScan(current));
      }).length;
      const rt = entry.rtStructScans.filter((s) => {
        const current = scanById[s.id];
        return Boolean(current && isRtStructScan(current));
      }).length;
      if (seg > 0 || rt > 0) {
        counts[source.id] = { seg, rt };
      }
    }
    return counts;
  }, [sourceScans, derivedIndex, scanById]);

  const overlayCountsBySessionSourceScanId = useMemo(() => {
    const counts: Record<string, { seg: number; rt: number }> = {};

    for (const [sessionId, allScans] of Object.entries(sessionScansById)) {
      const sourceForUid = new Map<string, string[]>();
      for (const source of allScans.filter(isBrowsableSourceScan)) {
        const sourceKey = `${sessionId}/${source.id}`;
        counts[sourceKey] = { seg: 0, rt: 0 };
        const uid = sourceSeriesUidByScanId[sourceKey];
        if (!uid) continue;
        const existing = sourceForUid.get(uid) ?? [];
        existing.push(source.id);
        sourceForUid.set(uid, existing);
      }

      for (const derived of allScans.filter(isDerivedScan)) {
        const refUid = derivedRefSeriesUidByScanId[`${sessionId}/${derived.id}`];
        if (!refUid) continue;
        const sourceIds = sourceForUid.get(refUid) ?? [];
        for (const sourceId of sourceIds) {
          const sourceKey = `${sessionId}/${sourceId}`;
          const current = counts[sourceKey] ?? { seg: 0, rt: 0 };
          if (isSegScan(derived)) current.seg += 1;
          else if (isRtStructScan(derived)) current.rt += 1;
          counts[sourceKey] = current;
        }
      }
    }

    return counts;
  }, [sessionScansById, sourceSeriesUidByScanId, derivedRefSeriesUidByScanId]);

  const connection = useConnectionStore((s) => s.connection);
  const pins = pinnedItemsProp ?? [];

  const downloadDerivedScanFile = useCallback(async (sessionId: string, scanId: string) => {
    const result = await window.electronAPI.xnat.downloadScanFile(sessionId, scanId);
    if (!result.ok || !result.data) {
      throw new Error(result.error || 'Failed to download scan file');
    }
    const binaryString = atob(result.data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }, []);

  const maybeResolveSessionAssociations = useCallback(
    (sessionId: string, sessionScans: XnatScan[]) => {
      if (!sessionScans.some((scan) => isDerivedScan(scan))) return;
      if (resolvedSessionIds.has(sessionId)) return;
      if (uidResolutionRequestedRef.current.has(sessionId)) return;

      uidResolutionRequestedRef.current.add(sessionId);
      void resolveAssociationsForSession(
        sessionId,
        sessionScans,
        (sid, scanId) => dicomwebLoader.getScanImageIds(sid, scanId),
        downloadDerivedScanFile,
      )
        .catch((err) => {
          console.warn(`[XnatBrowser] Failed to resolve UID associations for session ${sessionId}:`, err);
        })
        .finally(() => {
          if (!useSessionDerivedIndexStore.getState().resolvedSessionIds.has(sessionId)) {
            uidResolutionRequestedRef.current.delete(sessionId);
          }
        });
    },
    [downloadDerivedScanFile, resolveAssociationsForSession, resolvedSessionIds],
  );

  // ─── Navigate-to Handler ───────────────────────────────────────
  useEffect(() => {
    if (!navigateTo) return;

    async function doNavigate(target: NavigateToTarget) {
      setLoading(true);
      try {
        if (target.type === 'project') {
          const project: XnatProject = { id: target.projectId, name: target.projectName };
          setSelectedProject(project);
          setSelectedSubject(null);
          setSelectedSession(null);
          setLevel('subjects');
          const data = await window.electronAPI.xnat.getSubjects(target.projectId);
          setSubjects(data);
        } else if (target.type === 'subject' && target.subjectId != null) {
          const project: XnatProject = { id: target.projectId, name: target.projectName };
          const subject: XnatSubject = { id: target.subjectId, label: target.subjectLabel ?? '', projectId: target.projectId };
          setSelectedProject(project);
          setSelectedSubject(subject);
          setSelectedSession(null);
          setLevel('sessions');
          const data = await window.electronAPI.xnat.getSessions(target.projectId, target.subjectId);
          setSessions(data);
        } else if (target.type === 'session' && target.subjectId != null && target.sessionId != null) {
          const project: XnatProject = { id: target.projectId, name: target.projectName };
          const subject: XnatSubject = { id: target.subjectId, label: target.subjectLabel ?? '', projectId: target.projectId };
          const session: XnatSession = { id: target.sessionId, label: target.sessionLabel ?? '', projectId: target.projectId, subjectId: target.subjectId };
          setSelectedProject(project);
          setSelectedSubject(subject);
          setSelectedSession(session);
          setLevel('scans');
          const data = await window.electronAPI.xnat.getScans(target.sessionId, {
            includeSopClassUID: true,
          });
          setScans(data);
          maybeResolveSessionAssociations(target.sessionId, data);
          // Auto-load session
          if (onLoadSession && data.length > 0) {
            onLoadSession(target.sessionId, data, {
              projectId: target.projectId,
              subjectId: target.subjectId!,
              sessionLabel: target.sessionLabel!,
              projectName: target.projectName,
              subjectLabel: target.subjectLabel,
            });
          }
        }
      } catch (err) {
        console.error('[XnatBrowser] Navigation failed:', err);
      } finally {
        setLoading(false);
        onNavigateComplete?.();
      }
    }

    doNavigate(navigateTo);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigateTo, maybeResolveSessionAssociations]);

  // Clear search when level changes
  useEffect(() => {
    setSearch('');
  }, [level]);

  // Reset expansion + per-session scans when subject context changes
  useEffect(() => {
    setExpandedSessionIds({});
    setSessionScansById({});
    setSessionScansLoadingById({});
    setSessionScansErrorById({});
    uidResolutionRequestedRef.current.clear();
  }, [selectedProject?.id, selectedSubject?.id]);

  // ─── Filtered lists ──────────────────────────────────────────────
  const q = search.toLowerCase().trim();

  const filteredProjects = useMemo(() => {
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description && p.description.toLowerCase().includes(q)) ||
        p.id.toLowerCase().includes(q),
    );
  }, [projects, q]);

  const filteredSubjects = useMemo(() => {
    if (!q) return subjects;
    return subjects.filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q),
    );
  }, [subjects, q]);

  const filteredSessions = useMemo(() => {
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        (s.modality && s.modality.toLowerCase().includes(q)) ||
        (s.date && s.date.toLowerCase().includes(q)),
    );
  }, [sessions, q]);

  const filteredScans = useMemo(() => {
    if (!q) return sourceScans;
    return sourceScans.filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        (s.seriesDescription && s.seriesDescription.toLowerCase().includes(q)) ||
        (s.type && s.type.toLowerCase().includes(q)) ||
        (s.modality && s.modality.toLowerCase().includes(q)),
    );
  }, [sourceScans, q]);

  const getSourceScansForSession = useCallback((sessionId: string): XnatScan[] => {
    const all = sessionScansById[sessionId] ?? [];
    return all.filter(isBrowsableSourceScan);
  }, [sessionScansById]);

  const ensureSessionScansLoaded = useCallback(async (session: XnatSession) => {
    if (sessionScansById[session.id] || sessionScansLoadingById[session.id]) return;

    setSessionScansLoadingById((prev) => ({ ...prev, [session.id]: true }));
    setSessionScansErrorById((prev) => {
      const next = { ...prev };
      delete next[session.id];
      return next;
    });

    try {
      const data = await window.electronAPI.xnat.getScans(session.id, {
        includeSopClassUID: true,
      });
      setSessionScansById((prev) => ({ ...prev, [session.id]: data }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load scans';
      setSessionScansErrorById((prev) => ({ ...prev, [session.id]: msg }));
      console.error(`[XnatBrowser] Failed to load scans for session ${session.id}:`, err);
    } finally {
      setSessionScansLoadingById((prev) => ({ ...prev, [session.id]: false }));
    }
  }, [sessionScansById, sessionScansLoadingById]);

  const toggleSessionExpanded = useCallback((session: XnatSession) => {
    setExpandedSessionIds((prev) => {
      const nextExpanded = !prev[session.id];
      const next = { ...prev, [session.id]: nextExpanded };
      if (nextExpanded) {
        void ensureSessionScansLoaded(session);
      }
      return next;
    });
  }, [ensureSessionScansLoaded]);

  const ensureScanThumbnail = useCallback((sessionId: string, scan: XnatScan) => {
    if (!scanSupportsThumbnail(scan)) return;
    const scanId = scan.id;
    const key = `${sessionId}/${scanId}`;
    const cached = scanThumbnails[key];
    // Don't repeatedly retry thumbnails that already failed.
    if (
      cached?.status === 'ready' ||
      cached?.status === 'loading' ||
      cached?.status === 'error' ||
      thumbInFlightRef.current.has(key)
    ) {
      return;
    }

    thumbInFlightRef.current.add(key);
    setScanThumbnails((prev) => ({ ...prev, [key]: { status: 'loading' } }));

    void thumbLoadRef.current(async () => {
      try {
        const imageIds = await dicomwebLoader.getScanImageIds(sessionId, scanId, {
          order: 'dicomMetadata',
        });
        if (!imageIds.length) {
          throw new Error('No images found');
        }
        const midId = imageIds[Math.floor(imageIds.length / 2)] ?? imageIds[0];
        const image = await imageLoader.loadAndCacheImage(midId);
        const dataUrl = toThumbnailDataUrl(image as any);
        if (!dataUrl) {
          throw new Error('Thumbnail conversion failed');
        }
        setScanThumbnails((prev) => ({ ...prev, [key]: { status: 'ready', dataUrl } }));
      } catch (err) {
        console.warn(`[XnatBrowser] Failed thumbnail for ${sessionId}/${scanId}:`, err);
        setScanThumbnails((prev) => ({ ...prev, [key]: { status: 'error' } }));
      } finally {
        thumbInFlightRef.current.delete(key);
      }
    });
  }, [scanThumbnails]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        setVisibleThumbKeys((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const entry of entries) {
            const key = (entry.target as HTMLElement).dataset.thumbKey;
            if (!key) continue;
            if (entry.isIntersecting) {
              if (!next[key]) {
                next[key] = true;
                changed = true;
              }
            } else if (next[key]) {
              delete next[key];
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      },
      {
        root: null,
        rootMargin: '140px 0px',
        threshold: 0.01,
      },
    );
    thumbObserverRef.current = observer;

    return () => {
      observer.disconnect();
      thumbObserverRef.current = null;
      thumbNodeByKeyRef.current.clear();
      setVisibleThumbKeys({});
    };
  }, []);

  const registerThumbVisibilityTarget = useCallback(
    (key: string) => (node: HTMLElement | null) => {
      const observer = thumbObserverRef.current;
      const current = thumbNodeByKeyRef.current.get(key);
      if (current && (!node || current !== node)) {
        observer?.unobserve(current);
        thumbNodeByKeyRef.current.delete(key);
      }
      if (!node || !observer) return;
      node.dataset.thumbKey = key;
      thumbNodeByKeyRef.current.set(key, node);
      observer.observe(node);
    },
    [],
  );

  const visibleGridThumbnailCandidates = useMemo(() => {
    const candidates: Array<{ key: string; sessionId: string; scan: XnatScan }> = [];
    if (scanViewMode !== 'grid') return candidates;

    if (level === 'sessions') {
      for (const session of filteredSessions) {
        if (!expandedSessionIds[session.id]) continue;
        const source = getSourceScansForSession(session.id);
        for (const scan of source) {
          candidates.push({ key: `${session.id}/${scan.id}`, sessionId: session.id, scan });
        }
      }
      return candidates;
    }

    if (level === 'scans' && selectedSession) {
      for (const scan of filteredScans) {
        candidates.push({ key: `${selectedSession.id}/${scan.id}`, sessionId: selectedSession.id, scan });
      }
    }

    return candidates;
  }, [
    scanViewMode,
    level,
    filteredSessions,
    expandedSessionIds,
    getSourceScansForSession,
    selectedSession,
    filteredScans,
  ]);

  useEffect(() => {
    if (scanViewMode !== 'grid') return;
    for (const candidate of visibleGridThumbnailCandidates) {
      if (!visibleThumbKeys[candidate.key]) continue;
      ensureScanThumbnail(candidate.sessionId, candidate.scan);
    }
  }, [scanViewMode, visibleGridThumbnailCandidates, visibleThumbKeys, ensureScanThumbnail]);

  // Fetch per-subject modality breakdown when subjects are loaded
  useEffect(() => {
    if (level !== 'subjects' || !selectedProject || subjects.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const sessions = await window.electronAPI.xnat.getProjectSessions(selectedProject.id);
        if (cancelled) return;
        const map: Record<string, Record<string, number>> = {};
        for (const s of sessions) {
          if (!map[s.subjectId]) map[s.subjectId] = {};
          map[s.subjectId][s.modality] = (map[s.subjectId][s.modality] || 0) + 1;
        }
        setSubjectModalityMap(map);
      } catch (err) {
        console.error('[XnatBrowser] Failed to fetch project sessions for modality breakdown:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [level, selectedProject, subjects]);

  // Load projects on mount
  useEffect(() => {
    loadProjects();
  }, []);

  async function loadProjects() {
    setLoading(true);
    try {
      const data = await window.electronAPI.xnat.getProjects();
      setProjects(data);
    } catch (err) {
      console.error('Failed to load projects:', err);
    } finally {
      setLoading(false);
    }
  }

  const selectProject = useCallback(async (project: XnatProject) => {
    setSelectedProject(project);
    setSelectedSubject(null);
    setSelectedSession(null);
    setLevel('subjects');
    setLoading(true);
    try {
      const data = await window.electronAPI.xnat.getSubjects(project.id);
      setSubjects(data);
    } catch (err) {
      console.error('Failed to load subjects:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const selectSubject = useCallback(async (subject: XnatSubject) => {
    if (!selectedProject) return;
    setSelectedSubject(subject);
    setSelectedSession(null);
    setLevel('sessions');
    setLoading(true);
    try {
      const data = await window.electronAPI.xnat.getSessions(
        selectedProject.id,
        subject.id,
      );
      setSessions(data);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedProject]);

  const selectSession = useCallback(async (session: XnatSession) => {
    setSelectedSession(session);
    setLevel('scans');
    setLoading(true);
    try {
      const data = await window.electronAPI.xnat.getScans(session.id, {
        includeSopClassUID: true,
      });
      setScans(data);
      maybeResolveSessionAssociations(session.id, data);
    } catch (err) {
      console.error('Failed to load scans:', err);
    } finally {
      setLoading(false);
    }
  }, [maybeResolveSessionAssociations]);

  const loadScanForSession = useCallback(
    (session: XnatSession, scan: XnatScan) => {
      if (!selectedProject || !selectedSubject) return;
      onLoadScan(session.id, scan.id, scan, {
        projectId: selectedProject.id,
        subjectId: selectedSubject.id,
        sessionLabel: session.label,
        projectName: selectedProject.name,
        subjectLabel: selectedSubject.label,
      });
    },
    [selectedProject, selectedSubject, onLoadScan],
  );

  const buildDragPayload = useCallback((session: XnatSession, scan: XnatScan): XnatScanDragPayload | null => {
    if (!selectedProject || !selectedSubject) return null;
    return {
      sessionId: session.id,
      scanId: scan.id,
      scan,
      context: {
        projectId: selectedProject.id,
        subjectId: selectedSubject.id,
        sessionLabel: session.label,
        projectName: selectedProject.name,
        subjectLabel: selectedSubject.label,
      },
    };
  }, [selectedProject, selectedSubject]);

  const handleScanDragStart = useCallback(
    (e: React.DragEvent, session: XnatSession, scan: XnatScan) => {
      const payload = buildDragPayload(session, scan);
      if (!payload) return;
      e.dataTransfer.effectAllowed = 'copy';
      const payloadJson = JSON.stringify(payload);
      e.dataTransfer.setData(XNAT_SCAN_DRAG_MIME, payloadJson);
      e.dataTransfer.setData(XNAT_SCAN_DRAG_FALLBACK_MIME, payloadJson);
      e.dataTransfer.setData('text/plain', `${scan.seriesDescription || scan.type || 'Scan'} (#${scan.id})`);
    },
    [buildDragPayload],
  );

  const selectScan = useCallback(
    (scan: XnatScan) => {
      if (!selectedSession) return;
      loadScanForSession(selectedSession, scan);
    },
    [selectedSession, loadScanForSession],
  );

  // Breadcrumb navigation
  function goToProjects() {
    setLevel('projects');
    setSelectedProject(null);
    setSelectedSubject(null);
    setSelectedSession(null);
  }

  async function goToSubjects() {
    setLevel('subjects');
    setSelectedSubject(null);
    setSelectedSession(null);
    // Re-fetch subjects if we don't have them (e.g. navigated via pinned session)
    if (selectedProject && subjects.length === 0) {
      setLoading(true);
      try {
        const data = await window.electronAPI.xnat.getSubjects(selectedProject.id);
        setSubjects(data);
      } catch (err) {
        console.error('Failed to load subjects:', err);
      } finally {
        setLoading(false);
      }
    }
  }

  async function goToSessions() {
    setLevel('sessions');
    setSelectedSession(null);
    // Re-fetch sessions if we don't have them (e.g. navigated via pinned session)
    if (selectedProject && selectedSubject && sessions.length === 0) {
      setLoading(true);
      try {
        const data = await window.electronAPI.xnat.getSessions(selectedProject.id, selectedSubject.id);
        setSessions(data);
      } catch (err) {
        console.error('Failed to load sessions:', err);
      } finally {
        setLoading(false);
      }
    }
  }

  // Refresh the current level's data
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      if (level === 'projects') {
        const data = await window.electronAPI.xnat.getProjects();
        setProjects(data);
      } else if (level === 'subjects' && selectedProject) {
        const data = await window.electronAPI.xnat.getSubjects(selectedProject.id);
        setSubjects(data);
      } else if (level === 'sessions' && selectedProject && selectedSubject) {
        const data = await window.electronAPI.xnat.getSessions(selectedProject.id, selectedSubject.id);
        setSessions(data);
      } else if (level === 'scans' && selectedSession) {
        const data = await window.electronAPI.xnat.getScans(selectedSession.id, {
          includeSopClassUID: true,
        });
        setScans(data);
        maybeResolveSessionAssociations(selectedSession.id, data);
      }
    } catch (err) {
      console.error(`Failed to refresh ${level}:`, err);
    } finally {
      setLoading(false);
    }
  }, [level, selectedProject, selectedSubject, selectedSession, maybeResolveSessionAssociations]);

  // ─── Pin Helpers ───────────────────────────────────────────────
  const serverUrl = connection?.serverUrl ?? '';

  function makePinItem(type: 'project', project: XnatProject): PinnedItem;
  function makePinItem(type: 'subject', subject: XnatSubject): PinnedItem;
  function makePinItem(type: 'session', session: XnatSession): PinnedItem;
  function makePinItem(type: PinnedItem['type'], item: XnatProject | XnatSubject | XnatSession): PinnedItem {
    if (type === 'project') {
      const p = item as XnatProject;
      return { type: 'project', serverUrl, projectId: p.id, projectName: p.name, timestamp: Date.now() };
    } else if (type === 'subject') {
      const s = item as XnatSubject;
      return {
        type: 'subject', serverUrl,
        projectId: selectedProject?.id ?? '', projectName: selectedProject?.name ?? '',
        subjectId: s.id, subjectLabel: s.label,
        timestamp: Date.now(),
      };
    } else {
      const sess = item as XnatSession;
      return {
        type: 'session', serverUrl,
        projectId: selectedProject?.id ?? '', projectName: selectedProject?.name ?? '',
        subjectId: selectedSubject?.id ?? '', subjectLabel: selectedSubject?.label ?? '',
        sessionId: sess.id, sessionLabel: sess.label,
        timestamp: Date.now(),
      };
    }
  }

  // Label for the search placeholder
  const searchPlaceholder = {
    projects: 'Filter projects...',
    subjects: 'Filter subjects...',
    sessions: 'Filter sessions...',
    scans: 'Filter scans...',
  }[level];

  // Total / filtered count for the current level
  const totalCount = { projects, subjects, sessions, scans: sourceScans }[level].length;
  const filteredCount = {
    projects: filteredProjects,
    subjects: filteredSubjects,
    sessions: filteredSessions,
    scans: filteredScans,
  }[level].length;

  return (
    <div className="h-full flex flex-col">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 px-3 py-2 text-xs text-zinc-400 border-b border-zinc-800 bg-zinc-900/50 shrink-0 flex-wrap min-h-[36px]">
        <button
          onClick={goToProjects}
          className={`hover:text-zinc-200 transition-colors ${level === 'projects' ? 'text-zinc-200 font-medium' : ''}`}
        >
          Projects
        </button>

        {selectedProject && (
          <>
            <span className="text-zinc-600">/</span>
            <button
              onClick={goToSubjects}
              className={`hover:text-zinc-200 transition-colors truncate max-w-[100px] ${level === 'subjects' ? 'text-zinc-200 font-medium' : ''}`}
              title={selectedProject.name}
            >
              {selectedProject.name}
            </button>
          </>
        )}

        {selectedSubject && (
          <>
            <span className="text-zinc-600">/</span>
            <button
              onClick={goToSessions}
              className={`hover:text-zinc-200 transition-colors truncate max-w-[100px] ${level === 'sessions' ? 'text-zinc-200 font-medium' : ''}`}
              title={selectedSubject.label}
            >
              {selectedSubject.label}
            </button>
          </>
        )}

        {selectedSession && (
          <>
            <span className="text-zinc-600">/</span>
            <span className="text-zinc-200 font-medium truncate max-w-[100px]" title={selectedSession.label}>
              {selectedSession.label}
            </span>
          </>
        )}
      </div>

      {/* Search bar + Refresh */}
      {!loading && totalCount > 0 && (
        <div className="px-3 py-2 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <div className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none">
                <SearchIcon />
              </div>
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full pl-7 pr-7 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded-md text-zinc-300 placeholder-zinc-600 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500/30"
              />
              {search && (
                <button
                  onClick={() => {
                    setSearch('');
                    searchRef.current?.focus();
                  }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-zinc-500 hover:text-zinc-300 transition-colors rounded hover:bg-zinc-700"
                  title="Clear search"
                >
                  <ClearIcon />
                </button>
              )}
            </div>
            {(level === 'sessions' || level === 'scans') && (
              <div className="flex items-center gap-0.5 bg-zinc-900 border border-zinc-700 rounded-md p-0.5">
                <button
                  onClick={() => setScanViewMode('list')}
                  className={`p-1 rounded transition-colors ${
                    scanViewMode === 'list'
                      ? 'bg-zinc-700 text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                  }`}
                  title="List view"
                >
                  <IconListView className="w-3 h-3" />
                </button>
                <button
                  onClick={() => setScanViewMode('grid')}
                  className={`p-1 rounded transition-colors ${
                    scanViewMode === 'grid'
                      ? 'bg-zinc-700 text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                  }`}
                  title="Grid view"
                >
                  <IconGrid4 className="w-3 h-3" />
                </button>
              </div>
            )}
            <button
              onClick={refresh}
              disabled={loading}
              className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 rounded-md transition-colors disabled:opacity-40 shrink-0"
              title={`Refresh ${level}`}
            >
              <RefreshIcon />
            </button>
          </div>
          {q && (
            <div className="text-[10px] text-zinc-600 mt-1 px-0.5">
              {filteredCount} of {totalCount} {level}
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <Spinner />
        ) : (
          <>
            {level === 'projects' && (
              <ItemList
                items={filteredProjects}
                renderItem={(p) => (
                  <div className="flex items-start gap-2.5">
                    <ProjectIcon />
                    <div className="min-w-0">
                      <div className="text-sm text-zinc-200 font-medium truncate">{p.name}</div>
                      {p.description && (
                        <div className="text-xs text-zinc-500 truncate mt-0.5">{p.description}</div>
                      )}
                      <div className="text-[11px] text-zinc-600 mt-0.5 tabular-nums">
                        {p.subjectCount != null && `${p.subjectCount} subjects`}
                        {p.subjectCount != null && p.sessionCount != null && ' · '}
                        {p.sessionCount != null && `${p.sessionCount} sessions`}
                      </div>
                    </div>
                  </div>
                )}
                renderAction={onTogglePin ? (p) => {
                  const pinned = isPinned(pins, 'project', p.id);
                  return (
                    <button
                      onClick={() => onTogglePin(makePinItem('project', p))}
                      className={`p-1 rounded transition-colors ${
                        pinned
                          ? 'text-amber-400 hover:text-amber-300 opacity-100'
                          : 'text-zinc-600 hover:text-amber-400 opacity-0 group-hover:opacity-100'
                      }`}
                      title={pinned ? 'Unpin' : 'Pin'}
                    >
                      <IconPin className="w-3 h-3" filled={pinned} />
                    </button>
                  );
                } : undefined}
                onSelect={selectProject}
                emptyMessage={q ? `No projects matching "${search}"` : 'No accessible projects found'}
              />
            )}

            {level === 'subjects' && (
              <ItemList
                items={filteredSubjects}
                renderItem={(s) => {
                  const modBreakdown = subjectModalityMap[s.id];
                  const modSummary = modBreakdown
                    ? Object.entries(modBreakdown)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([mod, count]) => `${count} ${mod}`)
                        .join(' \u00b7 ')
                    : null;
                  return (
                    <div className="flex items-start gap-2.5">
                      <SubjectIcon />
                      <div className="min-w-0">
                        <div className="text-sm text-zinc-200 font-medium truncate">{s.label}</div>
                        <div className="text-[11px] text-zinc-600 tabular-nums">
                          {modSummary || (s.sessionCount != null ? `${s.sessionCount} sessions` : '')}
                        </div>
                      </div>
                    </div>
                  );
                }}
                renderAction={onTogglePin ? (s) => {
                  const pinned = isPinned(pins, 'subject', s.id);
                  return (
                    <button
                      onClick={() => onTogglePin(makePinItem('subject', s))}
                      className={`p-1 rounded transition-colors ${
                        pinned
                          ? 'text-amber-400 hover:text-amber-300 opacity-100'
                          : 'text-zinc-600 hover:text-amber-400 opacity-0 group-hover:opacity-100'
                      }`}
                      title={pinned ? 'Unpin' : 'Pin'}
                    >
                      <IconPin className="w-3 h-3" filled={pinned} />
                    </button>
                  );
                } : undefined}
                onSelect={selectSubject}
                emptyMessage={q ? `No subjects matching "${search}"` : 'No subjects found'}
              />
            )}

            {level === 'sessions' && (
              filteredSessions.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-zinc-600 text-xs">
                  {q ? `No sessions matching "${search}"` : 'No sessions found'}
                </div>
              ) : (
                <div className="divide-y divide-zinc-800/50">
                  {filteredSessions.map((session) => {
                    const isExpanded = Boolean(expandedSessionIds[session.id]);
                    const isSessionLoading = Boolean(sessionScansLoadingById[session.id]);
                    const sessionError = sessionScansErrorById[session.id];
                    const sessionScans = getSourceScansForSession(session.id);
                    const overlayCount = (sessionScansById[session.id] ?? []).filter(isDerivedScan).length;
                    const isPinnedSession = isPinned(pins, 'session', session.id);

                    return (
                      <div key={session.id}>
                        <div
                          onClick={() => toggleSessionExpanded(session)}
                          className="w-full text-left px-3 py-2.5 hover:bg-zinc-800/50 transition-colors cursor-pointer flex items-start gap-2 group"
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              toggleSessionExpanded(session);
                            }
                          }}
                        >
                          <svg
                            className={`w-3 h-3 mt-1 text-zinc-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                            viewBox="0 0 12 12"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <polyline points="4,2 8,6 4,10" />
                          </svg>
                          <SessionIcon />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm text-zinc-200 font-medium truncate">
                              {session.label}
                              {session.modality?.trim() && (
                                <span className="ml-2 text-[10px] bg-zinc-700/80 text-zinc-300 px-1.5 py-0.5 rounded font-normal">
                                  {session.modality.trim()}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-zinc-600 tabular-nums">
                              {session.date && <span>{session.date}</span>}
                              {session.date && session.scanCount != null && ' · '}
                              {session.scanCount != null && `${session.scanCount} scans`}
                            </div>
                          </div>
                          <div className="shrink-0 flex items-center gap-1.5">
                            {onTogglePin && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onTogglePin(makePinItem('session', session));
                                }}
                                className={`p-1 rounded transition-colors ${
                                  isPinnedSession
                                    ? 'text-amber-400 hover:text-amber-300 opacity-100'
                                    : 'text-zinc-600 hover:text-amber-400 opacity-0 group-hover:opacity-100'
                                }`}
                                title={isPinnedSession ? 'Unpin' : 'Pin'}
                              >
                                <IconPin className="w-3 h-3" filled={isPinnedSession} />
                              </button>
                            )}
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="px-3 pb-2">
                            {isSessionLoading ? (
                              <div className="text-[11px] text-zinc-500 py-2">Loading scans...</div>
                            ) : sessionError ? (
                              <div className="text-[11px] text-red-400 py-2">{sessionError}</div>
                            ) : sessionScans.length === 0 ? (
                              <div className="text-[11px] text-zinc-600 py-2">No source scans in this session.</div>
                            ) : (
                              <div className="space-y-2">
                                {onLoadSession && sessionScans.length > 1 && selectedProject && selectedSubject && (
                                  <button
                                    onClick={() => {
                                      const allScans = sessionScansById[session.id] ?? [];
                                      if (!allScans.length) return;
                                      onLoadSession(session.id, allScans, {
                                        projectId: selectedProject.id,
                                        subjectId: selectedSubject.id,
                                        sessionLabel: session.label,
                                        projectName: selectedProject.name,
                                        subjectLabel: selectedSubject.label,
                                      });
                                    }}
                                    className="w-full bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-medium px-2.5 py-1.5 rounded-md transition-colors flex items-center justify-center gap-1.5"
                                  >
                                    <LoadAllIcon />
                                    Load All Scans ({sessionScans.length}{overlayCount > 0 ? ` + ${overlayCount} overlays` : ''})
                                  </button>
                                )}

                                {scanViewMode === 'grid' ? (
                                  <div className="grid grid-cols-2 gap-2">
                                    {sessionScans.map((scan) => {
                                      const thumb = scanThumbnails[`${session.id}/${scan.id}`];
                                      const supportsThumb = scanSupportsThumbnail(scan);
                                      const overlayCounts = overlayCountsBySessionSourceScanId[`${session.id}/${scan.id}`] ?? { seg: 0, rt: 0 };
                                      return (
                                        <button
                                          key={scan.id}
                                          ref={registerThumbVisibilityTarget(`${session.id}/${scan.id}`)}
                                          onClick={() => loadScanForSession(session, scan)}
                                          draggable
                                          onDragStart={(e) => handleScanDragStart(e, session, scan)}
                                          className="text-left border border-zinc-800 rounded-md overflow-hidden hover:border-zinc-600 hover:bg-zinc-800/30 transition-colors"
                                          title={`${scan.seriesDescription || scan.type || 'Scan'} (#${scan.id})`}
                                        >
                                          <div className="aspect-square bg-zinc-900 flex items-center justify-center">
                                            {!supportsThumb ? (
                                              <span className="text-[10px] text-zinc-600">No preview</span>
                                            ) : thumb?.status === 'ready' && thumb.dataUrl ? (
                                              <img src={thumb.dataUrl} alt={`Scan ${scan.id}`} className="w-full h-full object-cover" />
                                            ) : thumb?.status === 'error' ? (
                                              <span className="text-[10px] text-zinc-600">No preview</span>
                                            ) : (
                                              <span className="text-[10px] text-zinc-500">Loading...</span>
                                            )}
                                          </div>
                                          <div className="px-2 py-1.5">
                                            <div className="text-[11px] text-zinc-200 font-medium truncate">
                                              #{scan.id} {scan.seriesDescription || scan.type || 'Unknown'}
                                            </div>
                                            <div className="text-[10px] text-zinc-500 tabular-nums truncate">
                                              {scan.modality || scan.type || 'Scan'}
                                              {scan.frames != null ? ` · ${scan.frames} frames` : ''}
                                            </div>
                                            {(overlayCounts.seg > 0 || overlayCounts.rt > 0) && (
                                              <div className="text-[10px] mt-1">
                                                {overlayCounts.seg > 0 && (
                                                  <span className="inline-flex items-center gap-1 mr-2 text-purple-300">
                                                    <IconSegmentationAnnotation className="w-3 h-3" />
                                                    {overlayCounts.seg}
                                                  </span>
                                                )}
                                                {overlayCounts.rt > 0 && (
                                                  <span className="inline-flex items-center gap-1 text-emerald-300">
                                                    <IconStructureAnnotation className="w-3 h-3" />
                                                    {overlayCounts.rt}
                                                  </span>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        </button>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div className="divide-y divide-zinc-800/50 border border-zinc-800 rounded-md overflow-hidden">
                                    {sessionScans.map((scan) => {
                                      const overlayCounts = overlayCountsBySessionSourceScanId[`${session.id}/${scan.id}`] ?? { seg: 0, rt: 0 };
                                      return (
                                        <button
                                          key={scan.id}
                                          onClick={() => loadScanForSession(session, scan)}
                                          draggable
                                          onDragStart={(e) => handleScanDragStart(e, session, scan)}
                                          className="w-full text-left px-2.5 py-2 hover:bg-zinc-800/40 transition-colors"
                                        >
                                          <div className="text-xs text-zinc-200 truncate">
                                            <span className="text-zinc-500 mr-1">#{scan.id}</span>
                                            {scan.seriesDescription || scan.type || 'Unknown'}
                                          </div>
                                          <div className="text-[11px] text-zinc-600 tabular-nums">
                                            {scan.modality || scan.type || 'Scan'}
                                            {scan.frames != null ? ` · ${scan.frames} frames` : ''}
                                            {(overlayCounts.seg > 0 || overlayCounts.rt > 0) && (
                                              <>
                                                {' · '}
                                                {overlayCounts.seg > 0 && (
                                                  <span className="inline-flex items-center gap-1 mr-2 text-purple-300">
                                                    <IconSegmentationAnnotation className="w-3 h-3" />
                                                    {overlayCounts.seg}
                                                  </span>
                                                )}
                                                {overlayCounts.rt > 0 && (
                                                  <span className="inline-flex items-center gap-1 text-emerald-300">
                                                    <IconStructureAnnotation className="w-3 h-3" />
                                                    {overlayCounts.rt}
                                                  </span>
                                                )}
                                              </>
                                            )}
                                          </div>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )
            )}

            {level === 'scans' && onLoadSession && sourceScans.length > 1 && selectedSession && (() => {
              const overlayCount = scans.filter(isDerivedScan).length;
              return (
                <div className="px-3 py-2.5 border-b border-zinc-800">
                  <button
                    onClick={() => {
                      if (selectedProject && selectedSubject) {
                        onLoadSession(selectedSession.id, scans, {
                          projectId: selectedProject.id,
                          subjectId: selectedSubject.id,
                          sessionLabel: selectedSession.label,
                          projectName: selectedProject.name,
                          subjectLabel: selectedSubject.label,
                        });
                      }
                    }}
                    className="w-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium px-3 py-2 rounded-md transition-colors flex items-center justify-center gap-2"
                  >
                    <LoadAllIcon />
                    Load All Scans ({sourceScans.length}{overlayCount > 0 ? ` + ${overlayCount} overlays` : ''})
                  </button>
                </div>
              );
            })()}

            {level === 'scans' && (
              scanViewMode === 'grid' ? (
                filteredScans.length === 0 ? (
                  <div className="flex items-center justify-center py-8 text-zinc-600 text-xs">
                    {q ? `No scans matching "${search}"` : 'No scans found'}
                  </div>
                ) : (
                  <div className="p-3 grid grid-cols-2 gap-2">
                    {filteredScans.map((s) => {
                      const overlayCounts = overlayCountsBySourceScanId[s.id] ?? { seg: 0, rt: 0 };
                      const thumb = selectedSession ? scanThumbnails[`${selectedSession.id}/${s.id}`] : undefined;
                      const supportsThumb = scanSupportsThumbnail(s);
                      return (
                        <button
                          key={s.id}
                          ref={selectedSession ? registerThumbVisibilityTarget(`${selectedSession.id}/${s.id}`) : undefined}
                          onClick={() => selectScan(s)}
                          draggable
                          onDragStart={(e) => {
                            if (!selectedSession) return;
                            handleScanDragStart(e, selectedSession, s);
                          }}
                          className="text-left border border-zinc-800 rounded-md overflow-hidden hover:border-zinc-600 hover:bg-zinc-800/30 transition-colors"
                        >
                          <div className="aspect-square bg-zinc-900 flex items-center justify-center">
                            {!supportsThumb ? (
                              <span className="text-[10px] text-zinc-600">No preview</span>
                            ) : thumb?.status === 'ready' && thumb.dataUrl ? (
                              <img src={thumb.dataUrl} alt={`Scan ${s.id}`} className="w-full h-full object-cover" />
                            ) : thumb?.status === 'error' ? (
                              <span className="text-[10px] text-zinc-600">No preview</span>
                            ) : (
                              <span className="text-[10px] text-zinc-500">Loading...</span>
                            )}
                          </div>
                          <div className="px-2 py-1.5">
                            <div className="text-[11px] text-zinc-200 font-medium truncate">
                              #{s.id} {s.seriesDescription || s.type || 'Unknown'}
                            </div>
                            <div className="text-[10px] text-zinc-500 tabular-nums">
                              {s.modality || s.type || 'Scan'}
                              {s.frames != null ? ` · ${s.frames}` : ''}
                            </div>
                            {(overlayCounts.seg > 0 || overlayCounts.rt > 0) && (
                              <div className="text-[10px] mt-1">
                                {overlayCounts.seg > 0 && (
                                  <span className="inline-flex items-center gap-1 mr-2 text-purple-300">
                                    <IconSegmentationAnnotation className="w-3 h-3" />
                                    {overlayCounts.seg}
                                  </span>
                                )}
                                {overlayCounts.rt > 0 && (
                                  <span className="inline-flex items-center gap-1 text-emerald-300">
                                    <IconStructureAnnotation className="w-3 h-3" />
                                    {overlayCounts.rt}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )
              ) : (
                <ItemList
                  items={filteredScans}
                  renderItem={(s) => {
                    const overlayCounts = overlayCountsBySourceScanId[s.id] ?? { seg: 0, rt: 0 };
                    return (
                      <div className="flex items-center justify-between w-full gap-2">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <ScanIcon />
                          <div className="min-w-0">
                            <div className="text-sm text-zinc-200 font-medium truncate">
                              <span className="text-zinc-500 mr-1.5">#{s.id}</span>
                              {s.seriesDescription || s.type || 'Unknown'}
                              {s.modality && (
                                <span className="ml-2 text-[10px] bg-zinc-700/80 text-zinc-300 px-1.5 py-0.5 rounded font-normal">
                                  {s.modality}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-zinc-600 tabular-nums">
                              {s.type && <span>{s.type}</span>}
                              {s.frames != null && ` · ${s.frames} frames`}
                              {(overlayCounts.seg > 0 || overlayCounts.rt > 0) && (
                                <>
                                  {' · '}
                                  {overlayCounts.seg > 0 && (
                                    <span className="inline-flex items-center gap-1 mr-2 text-purple-300">
                                      <IconSegmentationAnnotation className="w-3 h-3" />
                                      {overlayCounts.seg}
                                    </span>
                                  )}
                                  {overlayCounts.rt > 0 && (
                                    <span className="inline-flex items-center gap-1 text-emerald-300">
                                      <IconStructureAnnotation className="w-3 h-3" />
                                      {overlayCounts.rt}
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }}
                  onSelect={selectScan}
                  onItemDragStart={(item, e) => {
                    if (!selectedSession) return;
                    handleScanDragStart(e, selectedSession, item);
                  }}
                  emptyMessage={q ? `No scans matching "${search}"` : 'No scans found'}
                />
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Generic List Component ─────────────────────────────────────

interface ItemListProps<T> {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  renderAction?: (item: T) => React.ReactNode;
  onSelect: (item: T) => void;
  onItemDragStart?: (item: T, e: React.DragEvent<HTMLDivElement>) => void;
  emptyMessage: string;
}

function ItemList<T>({ items, renderItem, renderAction, onSelect, onItemDragStart, emptyMessage }: ItemListProps<T>) {
  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-zinc-600 text-xs">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="divide-y divide-zinc-800/50">
      {items.map((item, i) => (
        <div
          key={i}
          onClick={() => onSelect(item)}
          draggable={Boolean(onItemDragStart)}
          onDragStart={onItemDragStart ? (e) => onItemDragStart(item, e) : undefined}
          className="w-full text-left px-3 py-2.5 hover:bg-zinc-800/50 transition-colors cursor-pointer flex items-center group"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(item); } }}
        >
          <div className="flex-1 min-w-0">{renderItem(item)}</div>
          {renderAction && (
            <div className="shrink-0 ml-1" onClick={(e) => e.stopPropagation()}>
              {renderAction(item)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
