/**
 * Navigation for code outside the browser (extension framework X3 — docs/extension-framework.md):
 * open a session exactly as the XNAT browser does, and learn how it ended; reveal a project,
 * subject or session in the browser. App registers the handler — the browser's own path — so
 * nothing here duplicates the hanging protocol, annotation auto-load or the unsaved-changes
 * prompt.
 */
import type { XnatSessionRef } from '@shared/extensions/api';

export type OpenOutcome = { outcome: 'opened' | 'cancelled' | 'failed'; reason?: string };
export interface RevealTarget { projectId: string; subjectId?: string; sessionId?: string; subjectLabel?: string; sessionLabel?: string }

interface NavigationHandler {
  openSession(session: XnatSessionRef, options: { scanId?: string }): Promise<OpenOutcome>;
  /** Open one scan of a session, as clicking it in the browser does. */
  openScan(session: XnatSessionRef, scanId: string, options: { derivedOnly?: boolean }): Promise<OpenOutcome>;
  revealInBrowser(target: RevealTarget): void;
}

let handler: NavigationHandler | null = null;

/** App's: returns the function that removes it. */
export function setNavigationHandler(h: NavigationHandler): () => void {
  handler = h;
  return () => { if (handler === h) handler = null; };
}

export async function openSession(session: XnatSessionRef, options: { scanId?: string } = {}): Promise<OpenOutcome> {
  if (!handler) return { outcome: 'failed', reason: 'The viewer is not ready' };
  try {
    return await handler.openSession(session, options);
  } catch (err) {
    return { outcome: 'failed', reason: err instanceof Error ? err.message : String(err) };
  }
}

export async function openScan(session: XnatSessionRef, scanId: string, options: { derivedOnly?: boolean } = {}): Promise<OpenOutcome> {
  if (!handler) return { outcome: 'failed', reason: 'The viewer is not ready' };
  try {
    return await handler.openScan(session, scanId, options);
  } catch (err) {
    return { outcome: 'failed', reason: err instanceof Error ? err.message : String(err) };
  }
}

export function revealInBrowser(target: RevealTarget): void {
  handler?.revealInBrowser(target);
}
