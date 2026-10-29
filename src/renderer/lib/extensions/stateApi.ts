/**
 * App state for extensions (extension framework X3, R5–R6 — docs/extension-framework.md):
 * `ext.viewer` (the session on screen, the active viewport, opening a session the browser's way),
 * `ext.annotations` (read-only: the containers as the panel lists them, the active one) and
 * `ext.events`. Events fire after the change, once per change; listeners are removed when the
 * extension stops, and one that throws is logged without stopping the others.
 */
import type { AnnotationInfo, ExtensionAnnotations, ExtensionEventName, ExtensionEvents, ExtensionViewer, OpenSession } from '@shared/extensions/api';
import type { Container } from '@shared/types/annotation';
import { useViewerStore } from '../../stores/viewerStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { useAnnotationSelectionStore } from '../../stores/annotationSelectionStore';
import { CONTAINER_SOURCES, currentContainers } from '../annotations/currentContainers';
import { openSession, revealInBrowser } from '../app/appNavigation';
import { trackForExtension } from './uiRegistry';

function session(): OpenSession | null {
  const c = useViewerStore.getState().xnatContext;
  return c ? { projectId: c.projectId, subjectId: c.subjectId, sessionId: c.sessionId, sessionLabel: c.sessionLabel } : null;
}

const info = (c: Container): AnnotationInfo => ({
  id: c.id,
  kind: c.kind,
  label: c.label,
  dirty: !!c.dirty,
  xnatScanId: c.source.scanId,
  members: c.members.map((m) => ({ id: m.id, label: m.label })),
});

const list = () => currentContainers().map(info);

/** For each event: the value that changing makes it fire, and the stores it lives in. */
const WATCH: Record<ExtensionEventName, { read: () => unknown; stores: ReadonlyArray<{ subscribe: (l: () => void) => () => void }> }> = {
  signedIn: { read: () => useConnectionStore.getState().status === 'connected', stores: [useConnectionStore] },
  signedOut: { read: () => useConnectionStore.getState().status === 'connected', stores: [useConnectionStore] },
  sessionChanged: { read: () => session()?.sessionId ?? null, stores: [useViewerStore] },
  activeViewportChanged: { read: () => useViewerStore.getState().activeViewportId, stores: [useViewerStore] },
  activeAnnotationChanged: {
    read: () => { const a = useAnnotationSelectionStore.getState().activeMember; return a ? `${a.containerId}\u0000${a.memberId}` : null; },
    stores: [useAnnotationSelectionStore],
  },
  annotationsChanged: { read: () => JSON.stringify(list()), stores: CONTAINER_SOURCES },
};

export function createStateApi(extId: string): { viewer: ExtensionViewer; annotations: ExtensionAnnotations; events: ExtensionEvents } {
  const viewer: ExtensionViewer = {
    session,
    activeViewport: () => ({ id: useViewerStore.getState().activeViewportId }),
    openSession: (ref, options) => openSession(ref, options ?? {}),
    revealInBrowser,
  };
  const annotations: ExtensionAnnotations = {
    list,
    active() {
      const a = useAnnotationSelectionStore.getState().activeMember;
      const c = a && currentContainers().find((x) => x.id === a.containerId);
      return a && c ? { annotation: info(c), memberId: a.memberId } : null;
    },
  };
  const events: ExtensionEvents = {
    on(name, listener) {
      const w = WATCH[name];
      if (!w) throw new Error(`No such event: ${String(name)}`);
      let last = w.read();
      const check = () => {
        const now = w.read();
        if (Object.is(now, last)) return;
        last = now;
        // signedIn / signedOut share one value: each fires only for its own direction.
        if ((name === 'signedIn' && !now) || (name === 'signedOut' && now)) return;
        try {
          listener();
        } catch (err) {
          console.warn(`[extensions] ${extId}: a ${name} listener failed:`, err);
        }
      };
      const unsubscribes = w.stores.map((s) => s.subscribe(check));
      return trackForExtension(extId, () => { for (const u of unsubscribes) u(); });
    },
  };
  return { viewer, annotations, events };
}
