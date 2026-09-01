/**
 * backupStatus — pure derivation of the Annotations panel's silent in-place
 * backup row (frozen mockup §4 / design §3.4: local auto-backup is never a toast
 * or banner, it is a line inside the context toolbox).
 *
 * Inputs are the live local-backup state (`segmentationStore.autoSaveStatus` +
 * `lastAutoSaveTime`) gated on the user's `backup.enabled` preference — the same
 * three states the legacy SegmentationPanel footer surfaced, so the cutover
 * loses nothing. Pure: the caller passes `now` (no clock reads here).
 */

export type BackupStatusKind = 'saving' | 'saved' | 'error';

export interface BackupStatusInput {
  /** The user's local-backup preference — off ⇒ no row at all. */
  enabled: boolean;
  status: 'idle' | 'saving' | 'saved' | 'error';
  /** Epoch ms of the last successful backup, if any. */
  lastSavedAt: number | null;
  /** Epoch ms "now", supplied by the caller (ticked once a second by the hook). */
  now: number;
}

export interface BackupStatus {
  kind: BackupStatusKind;
  text: string;
}

/** "just now" / "2s ago" / "1m ago" / "2h ago" — the mockup's suffix vocabulary. */
function relativeAge(lastSavedAt: number, now: number): string {
  const ms = Math.max(0, now - lastSavedAt); // clock skew must never read "-1s ago"
  const seconds = Math.floor(ms / 1000);
  if (seconds < 1) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

/**
 * The backup row to render, or null when it should be hidden (backup disabled, or
 * nothing has been backed up yet this session).
 */
export function formatBackupStatus(input: BackupStatusInput): BackupStatus | null {
  const { enabled, status, lastSavedAt, now } = input;
  if (!enabled || status === 'idle') return null;
  if (status === 'saving') return { kind: 'saving', text: 'Backing up…' };
  if (status === 'error') return { kind: 'error', text: 'Backup failed' };
  return {
    kind: 'saved',
    text: lastSavedAt == null ? 'Backed up' : `Backed up · ${relativeAge(lastSavedAt, now)}`,
  };
}
