/**
 * XnatBrowser — drill-down panel for browsing XNAT hierarchy.
 *
 * Project > Subject > Session > Scan > Load
 *
 * Each level fetches data via IPC from the main process.
 * Selecting a scan triggers image loading.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type {
  XnatProject,
  XnatSubject,
  XnatSession,
  XnatScan,
} from '@shared/types/xnat';
import { useViewerStore } from '../../stores/viewerStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { IconPin } from '../icons';
import type { PinnedItem, NavigateToTarget } from '../../lib/pinnedItems';
import { isPinned } from '../../lib/pinnedItems';

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

  // Per-subject modality breakdown: subjectId → { CT: 2, MR: 1 }
  const [subjectModalityMap, setSubjectModalityMap] = useState<Record<string, Record<string, number>>>({});

  const connection = useConnectionStore((s) => s.connection);
  const pins = pinnedItemsProp ?? [];

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
          const data = await window.electronAPI.xnat.getScans(target.sessionId);
          setScans(data);
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
  }, [navigateTo]);

  // Clear search when level changes
  useEffect(() => {
    setSearch('');
  }, [level]);

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
    if (!q) return scans;
    return scans.filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        (s.seriesDescription && s.seriesDescription.toLowerCase().includes(q)) ||
        (s.type && s.type.toLowerCase().includes(q)) ||
        (s.modality && s.modality.toLowerCase().includes(q)),
    );
  }, [scans, q]);

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
      const data = await window.electronAPI.xnat.getScans(session.id);
      setScans(data);
    } catch (err) {
      console.error('Failed to load scans:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const selectScan = useCallback(
    (scan: XnatScan) => {
      if (!selectedSession || !selectedProject || !selectedSubject) return;
      onLoadScan(selectedSession.id, scan.id, scan, {
        projectId: selectedProject.id,
        subjectId: selectedSubject.id,
        sessionLabel: selectedSession.label,
        projectName: selectedProject.name,
        subjectLabel: selectedSubject.label,
      });
    },
    [selectedSession, selectedProject, selectedSubject, onLoadScan],
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
        const data = await window.electronAPI.xnat.getScans(selectedSession.id);
        setScans(data);
      }
    } catch (err) {
      console.error(`Failed to refresh ${level}:`, err);
    } finally {
      setLoading(false);
    }
  }, [level, selectedProject, selectedSubject, selectedSession]);

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
  const totalCount = { projects, subjects, sessions, scans }[level].length;
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
              <ItemList
                items={filteredSessions}
                renderItem={(e) => (
                  <div className="flex items-start gap-2.5">
                    <SessionIcon />
                    <div className="min-w-0">
                      <div className="text-sm text-zinc-200 font-medium truncate">
                        {e.label}
                        {e.modality?.trim() && (
                          <span className="ml-2 text-[10px] bg-zinc-700/80 text-zinc-300 px-1.5 py-0.5 rounded font-normal">
                            {e.modality.trim()}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-zinc-600 tabular-nums">
                        {e.date && <span>{e.date}</span>}
                        {e.date && e.scanCount != null && ' · '}
                        {e.scanCount != null && `${e.scanCount} scans`}
                      </div>
                    </div>
                  </div>
                )}
                renderAction={onTogglePin ? (e) => {
                  const pinned = isPinned(pins, 'session', e.id);
                  return (
                    <button
                      onClick={() => onTogglePin(makePinItem('session', e))}
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
                onSelect={selectSession}
                emptyMessage={q ? `No sessions matching "${search}"` : 'No sessions found'}
              />
            )}

            {level === 'scans' && onLoadSession && scans.length > 1 && selectedSession && (() => {
              const imagingScans = scans.filter((s) => {
                const t = s.type?.toUpperCase();
                return t !== 'SEG' && t !== 'RTSTRUCT' && t !== 'RT';
              });
              const derivedCount = scans.length - imagingScans.length;
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
                    Load All Scans ({imagingScans.length}{derivedCount > 0 ? ` + ${derivedCount} derived` : ''})
                  </button>
                </div>
              );
            })()}

            {level === 'scans' && (
              <ItemList
                items={filteredScans}
                renderItem={(s) => {
                  const isSeg = s.type?.toUpperCase() === 'SEG';
                  const isRT = s.type?.toUpperCase() === 'RTSTRUCT' || s.type?.toUpperCase() === 'RT';
                  const isDerived = isSeg || isRT;
                  return (
                    <div className="flex items-center justify-between w-full gap-2">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <ScanIcon />
                        <div className="min-w-0">
                          <div className="text-sm text-zinc-200 font-medium truncate">
                            <span className="text-zinc-500 mr-1.5">#{s.id}</span>
                            {s.seriesDescription || s.type || 'Unknown'}
                            {isSeg && (
                              <span className="ml-2 text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded font-normal">
                                SEG
                              </span>
                            )}
                            {isRT && (
                              <span className="ml-2 text-[10px] bg-green-500/20 text-green-300 px-1.5 py-0.5 rounded font-normal">
                                RTSTRUCT
                              </span>
                            )}
                            {s.modality && !isDerived && (
                              <span className="ml-2 text-[10px] bg-zinc-700/80 text-zinc-300 px-1.5 py-0.5 rounded font-normal">
                                {s.modality}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-zinc-600 tabular-nums">
                            {s.type && <span>{s.type}</span>}
                            {s.frames != null && ` · ${s.frames} frames`}
                            {s.quality && ` · ${s.quality}`}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }}
                onSelect={selectScan}
                emptyMessage={q ? `No scans matching "${search}"` : 'No scans found'}
              />
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
  emptyMessage: string;
}

function ItemList<T>({ items, renderItem, renderAction, onSelect, emptyMessage }: ItemListProps<T>) {
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
