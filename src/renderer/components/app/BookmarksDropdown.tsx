import { useCallback, useEffect, useRef, useState } from 'react';
import type { NavigateToTarget, PinnedItem, RecentSession } from '../../lib/pinnedItems';
import { IconChevronDown, IconPin } from '../icons';

interface BookmarksDropdownProps {
  pinnedItems: PinnedItem[];
  recentSessions: RecentSession[];
  showBookmarks: boolean;
  onToggleBookmarks: () => void;
  onTogglePin: (item: PinnedItem) => void;
  onPromoteRecent: (recent: RecentSession) => void;
  onNavigate: (target: NavigateToTarget) => void;
}

export default function BookmarksDropdown({
  pinnedItems,
  recentSessions,
  showBookmarks,
  onToggleBookmarks,
  onTogglePin,
  onPromoteRecent,
  onNavigate,
}: BookmarksDropdownProps) {
  const hasBookmarks = pinnedItems.length > 0 || recentSessions.length > 0;
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showBookmarks) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        buttonRef.current?.contains(e.target as Node) ||
        dropdownRef.current?.contains(e.target as Node)
      ) return;
      onToggleBookmarks();
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onToggleBookmarks, showBookmarks]);

  const handleToggle = useCallback(() => {
    if (!hasBookmarks) return;
    if (!showBookmarks && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const dropdownWidth = 288;
      const maxLeft = window.innerWidth - dropdownWidth - 8;
      setDropdownPos({ top: rect.bottom + 4, left: Math.min(rect.left, maxLeft) });
    }
    onToggleBookmarks();
  }, [hasBookmarks, onToggleBookmarks, showBookmarks]);

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleToggle}
        className={`flex items-center gap-1 text-xs font-medium px-2 py-1.5 rounded whitespace-nowrap transition-colors ${
          !hasBookmarks
            ? 'bg-zinc-800 text-zinc-600 cursor-default'
            : showBookmarks
              ? 'bg-amber-600/20 text-amber-300'
              : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
        }`}
        title={hasBookmarks ? 'Pinned & Recent' : 'No pinned or recent items'}
      >
        <IconPin className="w-3.5 h-3.5" filled={pinnedItems.length > 0} />
        <IconChevronDown className="w-3 h-3" />
      </button>

      {showBookmarks && hasBookmarks && (
        <div
          ref={dropdownRef}
          className="fixed z-50 w-72 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl py-1 max-h-80 overflow-y-auto"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          {pinnedItems.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Pinned
              </div>
              {pinnedItems.map((item) => {
                const key =
                  item.type === 'project' ? `pin-p-${item.projectId}` :
                  item.type === 'subject' ? `pin-s-${item.subjectId}` :
                  `pin-x-${item.sessionId}`;
                const label =
                  item.type === 'project' ? item.projectName :
                  item.type === 'subject' ? `${item.subjectLabel || item.subjectId}` :
                  `${item.sessionLabel || item.sessionId}`;
                const sublabel =
                  item.type === 'project' ? null :
                  item.type === 'subject' ? item.projectName :
                  `${item.subjectLabel || item.subjectId} / ${item.projectName}`;
                const icon =
                  item.type === 'project' ? 'text-blue-400' :
                  item.type === 'subject' ? 'text-violet-400' :
                  'text-emerald-400';
                const typeLabel =
                  item.type === 'project' ? 'P' :
                  item.type === 'subject' ? 'S' : 'E';

                return (
                  <div
                    key={key}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800 cursor-pointer group"
                    onClick={() => {
                      const target: NavigateToTarget = {
                        type: item.type,
                        projectId: item.projectId,
                        projectName: item.projectName,
                        ...(item.type !== 'project' && {
                          subjectId: item.subjectId,
                          subjectLabel: item.subjectLabel,
                        }),
                        ...(item.type === 'session' && {
                          sessionId: item.sessionId,
                          sessionLabel: item.sessionLabel,
                        }),
                      };
                      onNavigate(target);
                    }}
                  >
                    <span className={`text-[10px] font-bold ${icon} shrink-0 w-4 text-center`}>
                      {typeLabel}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-zinc-200 truncate">{label}</div>
                      {sublabel && (
                        <div className="text-[10px] text-zinc-500 truncate">{sublabel}</div>
                      )}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onTogglePin(item);
                      }}
                      className="text-zinc-500 hover:text-red-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Unpin"
                    >
                      <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <line x1="4" y1="4" x2="12" y2="12" />
                        <line x1="12" y1="4" x2="4" y2="12" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </>
          )}

          {recentSessions.length > 0 && (
            <>
              {pinnedItems.length > 0 && (
                <div className="border-t border-zinc-800 my-1" />
              )}
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Recent
              </div>
              {recentSessions.map((recent) => (
                <div
                  key={`recent-${recent.sessionId}`}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800 cursor-pointer group"
                  onClick={() => {
                    onNavigate({
                      type: 'session',
                      projectId: recent.projectId,
                      projectName: recent.projectName,
                      subjectId: recent.subjectId,
                      subjectLabel: recent.subjectLabel,
                      sessionId: recent.sessionId,
                      sessionLabel: recent.sessionLabel,
                    });
                  }}
                >
                  <span className="text-[10px] font-bold text-emerald-400 shrink-0 w-4 text-center">
                    E
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-zinc-200 truncate">
                      {recent.sessionLabel || recent.sessionId}
                    </div>
                    <div className="text-[10px] text-zinc-500 truncate">
                      {recent.subjectLabel || recent.subjectId} / {recent.projectName || recent.projectId}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onPromoteRecent(recent);
                    }}
                    className="text-zinc-500 hover:text-amber-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Pin this session"
                  >
                    <IconPin className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </>
  );
}
