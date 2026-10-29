/**
 * App state for extensions (extension framework X3, R5–R6 — docs/extension-framework.md):
 * `ext.viewer` (the session on screen, the active viewport, opening a session the browser's way),
 * `ext.annotations` (the containers as the panel lists them, and — X4 — the panel's own actions
 * on them) and `ext.events`. Events fire after the change, once per change; listeners are removed when the
 * extension stops, and one that throws is logged without stopping the others.
 */
import type { AnnotationInfo, ExtensionAnnotations, ExtensionEventName, ExtensionEvents, ExtensionViewer, OpenSession } from '@shared/extensions/api';
import type { Container, ContainerKind } from '@shared/types/annotation';
import { useViewerStore } from '../../stores/viewerStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { useAnnotationSelectionStore } from '../../stores/annotationSelectionStore';
import { useExtensionStore } from '../../stores/extensionStore';
import { CONTAINER_SOURCES, currentContainers } from '../annotations/currentContainers';
import { openScan, openSession, revealInBrowser } from '../app/appNavigation';
import { trackForExtension } from './uiRegistry';

function session(): OpenSession | null {
  const c = useViewerStore.getState().xnatContext;
  return c ? { projectId: c.projectId, subjectId: c.subjectId, sessionId: c.sessionId, sessionLabel: c.sessionLabel } : null;
}

/**
 * The Annotations panel's actions (hooks/annotationActions), installed from the component layer:
 * services may not import hooks, and the panel's rules must not be re-implemented here.
 */
export interface AnnotationActionsPort {
  activateMember(containerId: string, memberId: string, kindHint?: ContainerKind): void;
  createContainer(kind: ContainerKind, viewportId: string, sourceImageIds: string[]): Promise<string>;
  addMember(containerId: string, label?: string): Promise<number | null>;
  renameContainer(containerId: string, name: string): boolean;
  renameMember(containerId: string, memberId: string, name: string): boolean;
  setMemberColor(containerId: string, memberId: string, color: [number, number, number, number]): boolean;
  saveContainer(containerId: string): Promise<{ outcome: 'saved' | 'conflict' | 'failed'; reason?: string; versionToken?: string }>;
  isApproved(containerId: string): boolean;
  versionToken(containerId: string): string | undefined;
}
let actions: AnnotationActionsPort | null = null;
export function setAnnotationActions(a: AnnotationActionsPort): void {
  actions = a;
}
const panel = (): AnnotationActionsPort => {
  if (!actions) throw new Error('The annotation actions are not installed');
  return actions;
};

const info = (c: Container): AnnotationInfo => ({
  id: c.id,
  kind: c.kind,
  label: c.label,
  dirty: !!c.dirty,
  xnatScanId: c.source.scanId,
  approved: actions?.isApproved(c.id) ?? false,
  versionToken: actions?.versionToken(c.id),
  members: c.members.map((m) => ({ id: m.id, label: m.label })),
});

const find = (id: string) => currentContainers().find((c) => c.id === id);

const list = () => currentContainers().map(info);

/** An extension's gate, as a value that changes when the gate does (X6). */
function gateKey(extId: string): string {
  const s = useExtensionStore.getState().extensions.find((x) => x.id === extId);
  return JSON.stringify(s ? [s.state, s.reason, s.tier, (s.features ?? []).filter((f) => f.enabled).map((f) => f.id)] : null);
}

type Watch = { read: () => unknown; stores: ReadonlyArray<{ subscribe: (l: () => void) => () => void }> };

/** For each event: the value that changing makes it fire, and the stores it lives in. */
const WATCH: Record<Exclude<ExtensionEventName, 'gateChanged'>, Watch> = {
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
      const c = a && find(a.containerId);
      return a && c ? { annotation: info(c), memberId: a.memberId } : null;
    },
    select(containerId, memberId) {
      const c = find(containerId);
      if (!c) throw new Error(`No annotation ${containerId}`);
      const member = memberId ?? c.members[0]?.id ?? (c.kind === 'SR' ? c.id : undefined);
      if (memberId !== undefined && !c.members.some((m) => m.id === memberId)) throw new Error(`${c.label} has no member ${memberId}`);
      panel().activateMember(containerId, member ?? '', c.kind);
    },
    async create(template) {
      const a = panel();
      const viewer = useViewerStore.getState();
      const viewportId = viewer.activeViewportId;
      const images = viewer.panelImageIdsMap[viewportId] ?? [];
      if (images.length === 0) throw new Error('No images in the active viewport to annotate');
      if (template.kind === 'SR' && template.members?.length) throw new Error('Measurements are drawn, not created: a Measurement template has no members');
      const id = await a.createContainer(template.kind, viewportId, images);
      if (template.label) a.renameContainer(id, template.label);
      // The create made the first member (Segment 1 / ROI 1): the template names it; the rest are added.
      for (const [i, m] of (template.members ?? []).entries()) {
        const memberId = i === 0 ? '1' : String(await a.addMember(id, m.label));
        if (i === 0) a.renameMember(id, memberId, m.label);
        if (m.color) a.setMemberColor(id, memberId, [m.color[0], m.color[1], m.color[2], 255]);
      }
      a.activateMember(id, template.kind === 'SR' ? id : '1', template.kind);
      // The projection follows Cornerstone's events: wait (briefly) for it to list the new one.
      for (let i = 0; i < 40 && !find(id); i++) await new Promise((r) => setTimeout(r, 50));
      const c = find(id);
      return c ? info(c) : { id, kind: template.kind, label: template.label ?? '', dirty: false, approved: false, members: [] };
    },
    save: (containerId) => panel().saveContainer(containerId),
    openScan: (ref, scanId) => openScan(ref, scanId, { derivedOnly: true }),
  };
  const events: ExtensionEvents = {
    on(name, listener) {
      const w: Watch | undefined = name === 'gateChanged'
        ? { read: () => gateKey(extId), stores: [useExtensionStore] }
        : WATCH[name as keyof typeof WATCH];
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
