/**
 * Opening a session from an xnat-workstation:// link (docs/open-from-link.md), renderer half.
 * Main validates each link and holds the latest; this takes it once the viewer is ready.
 *
 * Signed in to the link's server: the session (and scan) opens the way the XNAT browser opens
 * one. Otherwise the user is asked first when the server is not a recent connection, or when
 * the switch would sign them out of another server; then sign-in to the link's server starts,
 * and the session opens once it succeeds.
 */
import { useEffect } from 'react';
import { sameServer, type OpenLinkRequest } from '@shared/openLink';
import type { XnatSessionRef } from '@shared/extensions/api';
import { useConnectionStore } from '../stores/connectionStore';
import { useOpenLinkStore } from '../stores/openLinkStore';
import { useViewerStore } from '../stores/viewerStore';
import { showConfirmDialog } from '../stores/dialogStore';
import { showToast } from '../stores/toastStore';
import { openScan, openSession, type OpenOutcome } from '../lib/app/appNavigation';
import { isPrimaryImageScan } from '../lib/app/appHelpers';
import { isRecentServer, saveRecentConnection } from '../lib/xnat/recentConnections';
import { confirmDisconnect } from './confirmDisconnect';

export async function handleOpenLink(link: OpenLinkRequest): Promise<void> {
  const { status, connection, browserLogin } = useConnectionStore.getState();
  if (status === 'connecting') {
    console.warn('[useOpenLink] Ignored a link while signing in');
    return;
  }
  const current = status === 'connected' ? connection?.serverUrl : undefined;
  if (current && sameServer(current, link.server)) {
    await openLinkedSession(link);
    return;
  }

  const signOut = current ? `\n\nOpening it signs you out of ${current}.` : '';
  if (!isRecentServer(link.server)) {
    const open = await showConfirmDialog({
      title: `Open a session from ${link.server}?`,
      message: `You have not connected to ${link.server} before. Open the session only if you trust this server.${signOut}`,
      confirmLabel: 'Open',
    });
    if (!open) return;
  } else if (current) {
    const switchServer = await showConfirmDialog({
      title: `Switch to ${link.server}?`,
      message: `The link opens a session on ${link.server}.${signOut}`,
      confirmLabel: 'Switch',
    });
    if (!switchServer) return;
  }
  if (current && !(await confirmDisconnect())) return;

  useOpenLinkStore.getState().setPending(link);
  if (await browserLogin(link.server)) saveRecentConnection(link.server);
}

export async function openLinkedSession(link: OpenLinkRequest): Promise<void> {
  const found = await window.electronAPI.xnat.getSession(link.project, link.session);
  if (!found.ok) {
    showToast(`Session ${link.session} was not found in project ${link.project}, or you cannot access it.`, 'error', 5000);
    return;
  }
  const ref = found.session;
  let outcome: OpenOutcome;
  if (useViewerStore.getState().sessionId === ref.sessionId) {
    if (!link.scan) return;
    outcome = await openScan(ref, link.scan);
  } else {
    outcome = await openSession(ref, { scanId: await imageScanOrNothing(ref, link.scan) });
  }
  if (outcome.outcome === 'failed') {
    showToast(`Could not open the linked session: ${outcome.reason ?? 'unknown error'}`, 'error', 5000);
  }
}

async function imageScanOrNothing(ref: XnatSessionRef, scanId: string | undefined): Promise<string | undefined> {
  if (!scanId) return undefined;
  const scans = await window.electronAPI.xnat.getScans(ref.sessionId);
  if (scans.some((s) => s.id === scanId && isPrimaryImageScan(s))) return scanId;
  showToast(`Scan ${scanId} is not an image scan of ${ref.sessionLabel ?? ref.sessionId}; opening the session.`, 'warning', 5000);
  return undefined;
}

let draining = false;

/** Take links until main has none: one arriving mid-way is taken after the current one. */
async function drainOpenLinks(): Promise<void> {
  const api = window.electronAPI?.openLink;
  if (draining || !api) return;
  draining = true;
  try {
    for (let link = await api.take(); link; link = await api.take()) {
      try {
        await handleOpenLink(link);
      } catch (err) {
        console.error('[useOpenLink] Opening a link failed:', err);
      }
    }
  } finally {
    draining = false;
  }
}

export function useOpenLink(ready: boolean): void {
  const status = useConnectionStore((s) => s.status);
  const serverUrl = useConnectionStore((s) => s.connection?.serverUrl ?? null);

  useEffect(() => {
    const api = window.electronAPI?.openLink;
    if (!ready || !api) return;
    void drainOpenLinks();
    return api.onReceived(() => { void drainOpenLinks(); });
  }, [ready]);

  // A sign-in succeeded — started by a link or from the login form.
  useEffect(() => {
    const link = useOpenLinkStore.getState().pending;
    if (!ready || status !== 'connected' || !serverUrl || !link) return;
    useOpenLinkStore.getState().setPending(null);
    if (sameServer(serverUrl, link.server)) void openLinkedSession(link);
  }, [ready, status, serverUrl]);
}
