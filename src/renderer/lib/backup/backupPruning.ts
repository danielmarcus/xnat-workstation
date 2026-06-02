/**
 * Backup prune + sync-folder detection — pure helpers.
 * Spec §12.2 / §12.4.
 *
 * No filesystem or Electron API access — the caller invokes the
 * actual `deleteSegmentation` call once `partitionEntriesForPrune`
 * tells it which entries are stale.
 */
import type {
  BackupManifest,
  BackupManifestEntry,
  BackupSessionSummary,
} from '@shared/types/backup';

export interface PrunePartition {
  /** Entries that should remain in the manifest. */
  keep: BackupManifestEntry[];
  /** Entries older than `pruneAfterDays` — caller deletes the files
   *  + drops them from the manifest. */
  prune: BackupManifestEntry[];
}

/**
 * Split a manifest's entries into keep / prune based on age. An
 * unparseable / non-finite timestamp is treated as "keep" (better to
 * leave a confusing backup than silently lose data — recovery will
 * surface the parse error).
 *
 * `now` is injected so callers + tests can pin the clock.
 */
export function partitionEntriesForPrune(
  entries: ReadonlyArray<BackupManifestEntry>,
  pruneAfterDays: number,
  now: number,
): PrunePartition {
  const cutoff = now - pruneAfterDays * 24 * 60 * 60 * 1000;
  const keep: BackupManifestEntry[] = [];
  const prune: BackupManifestEntry[] = [];
  for (const entry of entries) {
    const ts = Date.parse(entry.timestamp);
    if (!Number.isFinite(ts)) {
      keep.push(entry);
      continue;
    }
    if (ts < cutoff) prune.push(entry);
    else keep.push(entry);
  }
  return { keep, prune };
}

/**
 * Split a list of session summaries by age — sessions whose
 * `lastUpdated` is older than the cutoff become candidates for
 * whole-session deletion. Unparseable timestamps → keep.
 */
export function partitionSessionsForPrune(
  sessions: ReadonlyArray<BackupSessionSummary>,
  pruneAfterDays: number,
  now: number,
): { keep: BackupSessionSummary[]; prune: BackupSessionSummary[] } {
  const cutoff = now - pruneAfterDays * 24 * 60 * 60 * 1000;
  const keep: BackupSessionSummary[] = [];
  const prune: BackupSessionSummary[] = [];
  for (const s of sessions) {
    const ts = Date.parse(s.lastUpdated);
    if (!Number.isFinite(ts)) {
      keep.push(s);
      continue;
    }
    if (ts < cutoff) prune.push(s);
    else keep.push(s);
  }
  return { keep, prune };
}

/**
 * Return a new manifest with `prune` entries removed and
 * `lastUpdated` advanced to `now`. Pure — does not write.
 */
export function manifestAfterPrune(
  manifest: BackupManifest,
  prune: ReadonlyArray<BackupManifestEntry>,
  now: number,
): BackupManifest {
  if (prune.length === 0) return manifest;
  const pruneSet = new Set(prune.map((e) => e.filename));
  return {
    ...manifest,
    entries: manifest.entries.filter((e) => !pruneSet.has(e.filename)),
    lastUpdated: new Date(now).toISOString(),
  };
}

// ─── Sync-folder detection (spec §12.4) ────────────────────────────

/**
 * Known cloud-sync provider name. Drives the inline warning copy in
 * Settings → Backup.
 */
export type SyncFolderProvider = 'OneDrive' | 'iCloud Drive' | 'Dropbox' | 'Google Drive' | 'Box';

interface ProviderPattern {
  provider: SyncFolderProvider;
  patterns: RegExp[];
}

/**
 * Path patterns checked case-insensitively against the chosen
 * backup directory. We match liberally — false positives are
 * harmless (a non-sync folder gets a polite warning), false
 * negatives (a real sync folder going unflagged) are not.
 */
const PROVIDER_PATTERNS: ProviderPattern[] = [
  {
    provider: 'OneDrive',
    patterns: [
      /[\\/]OneDrive(?:[\s\-][^\\/]*)?(?:[\\/]|$)/i,
      /[\\/]OneDrive\b/i,
    ],
  },
  {
    provider: 'iCloud Drive',
    patterns: [
      /[\\/]Library[\\/]Mobile Documents[\\/]com~apple~CloudDocs(?:[\\/]|$)/i,
      /[\\/]iCloud Drive(?:[\\/]|$)/i,
    ],
  },
  {
    provider: 'Dropbox',
    patterns: [
      /[\\/]Dropbox(?:[\\/]|$)/i,
      /[\\/]Dropbox[\s\-][^\\/]*(?:[\\/]|$)/i,
    ],
  },
  {
    provider: 'Google Drive',
    patterns: [
      /[\\/]Google Drive(?:[\\/]|$)/i,
      /[\\/]GoogleDrive(?:[\\/]|$)/i,
      /[\\/]CloudStorage[\\/]GoogleDrive[^\\/]*(?:[\\/]|$)/i,
    ],
  },
  {
    provider: 'Box',
    patterns: [
      /[\\/]Box(?:[\\/][^\\/]*)*?[\\/]Box(?:[\\/]|$)/i,
      /[\\/]Box Sync(?:[\\/]|$)/i,
    ],
  },
];

/**
 * Detect whether the given absolute path is inside a known cloud-sync
 * root. Returns the matched provider or `null`.
 *
 * Accepts both POSIX (`/Users/foo/OneDrive/Backups`) and Windows
 * (`C:\Users\foo\OneDrive\Backups`) paths.
 */
export function detectSyncFolder(absolutePath: string): SyncFolderProvider | null {
  if (!absolutePath) return null;
  // Normalise the path separator so the regexes only have to look for
  // forward slash. Backslashes survive too — patterns use `[\\/]`.
  const normalised = absolutePath;
  for (const { provider, patterns } of PROVIDER_PATTERNS) {
    if (patterns.some((re) => re.test(normalised))) return provider;
  }
  return null;
}

/** Localised warning copy for the Settings inline banner. */
export function syncFolderWarningMessage(provider: SyncFolderProvider): string {
  return `Backup directory is inside ${provider}. Sync churn may cause backup failures.`;
}
