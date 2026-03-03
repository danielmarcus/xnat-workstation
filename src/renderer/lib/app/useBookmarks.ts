import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addPinnedItem,
  isPinned as isPinnedCheck,
  loadPinnedItems,
  loadRecentSessions,
  removePinnedItem,
  type NavigateToTarget,
  type PinnedItem,
  type RecentSession,
} from '../pinnedItems';

export function useBookmarks(
  serverUrl: string | undefined,
  showBrowser: boolean,
  setShowBrowser: (show: boolean) => void,
) {
  const [pinnedItems, setPinnedItems] = useState<PinnedItem[]>([]);
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([]);
  const [navigateTo, setNavigateTo] = useState<NavigateToTarget | null>(null);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const bookmarksRef = useRef<HTMLDivElement>(null);

  const refreshBookmarks = useCallback(() => {
    if (serverUrl) {
      setPinnedItems(loadPinnedItems(serverUrl));
      setRecentSessions(loadRecentSessions(serverUrl));
      return;
    }
    setPinnedItems([]);
    setRecentSessions([]);
  }, [serverUrl]);

  useEffect(() => {
    refreshBookmarks();
  }, [refreshBookmarks]);

  useEffect(() => {
    if (!showBookmarks) return;
    function handleClick(e: MouseEvent) {
      if (bookmarksRef.current && !bookmarksRef.current.contains(e.target as Node)) {
        setShowBookmarks(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showBookmarks]);

  const handleTogglePin = useCallback(
    (item: PinnedItem) => {
      if (!serverUrl) return;
      const id =
        item.type === 'project' ? item.projectId :
        item.type === 'subject' ? item.subjectId :
        item.sessionId;
      if (isPinnedCheck(pinnedItems, item.type, id)) {
        removePinnedItem(item.type, id, serverUrl);
      } else {
        addPinnedItem(item);
      }
      refreshBookmarks();
    },
    [pinnedItems, refreshBookmarks, serverUrl],
  );

  const handleBookmarkNavigate = useCallback(
    (target: NavigateToTarget) => {
      setNavigateTo(target);
      setShowBookmarks(false);
      if (!showBrowser) setShowBrowser(true);
    },
    [setShowBrowser, showBrowser],
  );

  const handlePromoteRecent = useCallback((recent: RecentSession) => {
    addPinnedItem({
      type: 'session',
      serverUrl: recent.serverUrl,
      projectId: recent.projectId,
      projectName: recent.projectName,
      subjectId: recent.subjectId,
      subjectLabel: recent.subjectLabel,
      sessionId: recent.sessionId,
      sessionLabel: recent.sessionLabel,
      timestamp: Date.now(),
    });
    refreshBookmarks();
  }, [refreshBookmarks]);

  return {
    pinnedItems,
    recentSessions,
    navigateTo,
    setNavigateTo,
    showBookmarks,
    setShowBookmarks,
    bookmarksRef,
    refreshBookmarks,
    handleTogglePin,
    handleBookmarkNavigate,
    handlePromoteRecent,
  };
}
