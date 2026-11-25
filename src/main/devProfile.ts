/**
 * An unpackaged build runs as "<app name> (dev)" (index.ts), with its own user-data folder, so
 * that it runs beside an installed copy instead of handing its launch to it. Before that, a
 * development build used the installed app's folder. The first time a development build runs
 * with its own folder, the app's own data is copied over from that one, so annotation backups
 * and checkpoints waiting to be recovered, settings (the renderer's localStorage), installed
 * modules and extension data are not left behind. The old folder is not changed.
 */
import * as fs from 'fs';
import * as path from 'path';

/** What the app keeps in its user-data folder (Chromium's own caches are not worth copying). */
export const APP_DATA_ENTRIES = [
  'backups',
  'checkpoints',
  'Local Storage',
  'modules',
  'extension-data',
  'extensions.json',
] as const;

const MARKER = '.adopted-profile';

/**
 * Copy the app's data from `from` into `to`, once: a marker in `to` records that it was done
 * (or that there was nothing to adopt). Entries already in `to` are left alone. Best effort:
 * a failure is logged, never thrown, and the app starts with what was copied.
 */
export function adoptPreviousProfile(from: string, to: string): string[] {
  const marker = path.join(to, MARKER);
  if (path.resolve(from) === path.resolve(to) || fs.existsSync(marker)) return [];
  const copied: string[] = [];
  try {
    fs.mkdirSync(to, { recursive: true });
    if (fs.existsSync(from)) {
      for (const entry of APP_DATA_ENTRIES) {
        const source = path.join(from, entry);
        const target = path.join(to, entry);
        if (!fs.existsSync(source) || fs.existsSync(target)) continue;
        try {
          fs.cpSync(source, target, { recursive: true, errorOnExist: false, force: false });
          copied.push(entry);
        } catch (err) {
          console.warn(`[devProfile] Could not copy ${entry} from ${from}:`, err);
        }
      }
    }
    fs.writeFileSync(marker, JSON.stringify({ from, at: new Date().toISOString(), copied }));
  } catch (err) {
    console.warn('[devProfile] Could not adopt the previous profile:', err);
  }
  return copied;
}
