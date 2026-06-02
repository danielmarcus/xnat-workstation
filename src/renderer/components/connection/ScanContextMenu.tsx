/**
 * ScanContextMenu — right-click menu on a scan row.
 * Spec §7.7.
 *
 * Items:
 *   - Open in active panel
 *   - Open in panel_0 / panel_1 / panel_2 / panel_3 (each shows
 *     "(replaces)" when that panel currently holds a scan)
 *   - ─
 *   - Open in MPR (active panel)
 *   - Pin to favorites
 *   - Copy session URL
 *
 * Pure presentation: caller passes in the scan id, the open
 * panelIds, the active panel id, the panel→scan map (so we can
 * show the "(replaces)" suffix), and one handler per action.
 *
 * Position is fixed at `(x, y)` from the caller (typically
 * `e.clientX/Y` from the contextmenu event). Closes via Esc /
 * outside pointerdown.
 */
import { useEffect } from 'react';

export interface ScanContextMenuProps {
  open: boolean;
  /** Pixel coordinates of the cursor — used to position the menu. */
  x: number;
  y: number;
  /** Ordered list of panel ids (e.g. ["panel_0", "panel_1"]). */
  panelIds: ReadonlyArray<string>;
  /** Active panel id; used to drive the first item. */
  activePanelId: string;
  /** `panelId → scanId | null` so we can show "(replaces)" for loaded panels. */
  panelScanMap: Readonly<Record<string, string | null>>;
  onClose: () => void;
  onOpenInActive: () => void;
  onOpenInPanel: (panelId: string) => void;
  onOpenInMpr: () => void;
  onPin: () => void;
  onCopyUrl: () => void;
}

export default function ScanContextMenu(props: ScanContextMenuProps) {
  const {
    open, x, y, panelIds, activePanelId, panelScanMap,
    onClose, onOpenInActive, onOpenInPanel, onOpenInMpr, onPin, onCopyUrl,
  } = props;

  // Close on Esc or any outside pointerdown.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    const onPointer = () => onClose();
    window.addEventListener('keydown', onKey);
    // Use pointerdown on document so a click anywhere closes the menu.
    document.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <ul
      data-testid="scan-context-menu"
      role="menu"
      style={{ top: y, left: x }}
      className="fixed z-50 bg-zinc-900 border border-zinc-700 rounded shadow-xl py-0.5 min-w-[200px] text-xs"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuItem
        testid="scan-ctx-open-active"
        label="Open in active panel"
        onClick={() => { onClose(); onOpenInActive(); }}
      />
      <li role="separator" className="border-t border-zinc-800 my-0.5" />
      {panelIds.map((pid) => {
        const replaces = !!panelScanMap[pid];
        return (
          <MenuItem
            key={pid}
            testid={`scan-ctx-open-${pid}`}
            label={`Open in ${pid}${replaces ? ' (replaces)' : ''}`}
            disabled={pid === activePanelId}
            onClick={() => { onClose(); onOpenInPanel(pid); }}
          />
        );
      })}
      <li role="separator" className="border-t border-zinc-800 my-0.5" />
      <MenuItem
        testid="scan-ctx-open-mpr"
        label="Open in MPR (active panel)"
        onClick={() => { onClose(); onOpenInMpr(); }}
      />
      <MenuItem
        testid="scan-ctx-pin"
        label="Pin to favorites"
        onClick={() => { onClose(); onPin(); }}
      />
      <MenuItem
        testid="scan-ctx-copy-url"
        label="Copy session URL"
        onClick={() => { onClose(); onCopyUrl(); }}
      />
    </ul>
  );
}

function MenuItem({
  testid,
  label,
  disabled,
  onClick,
}: {
  testid: string;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <li role="none">
      <button
        type="button"
        role="menuitem"
        data-testid={testid}
        onClick={onClick}
        disabled={disabled}
        className="block w-full text-left text-zinc-200 hover:bg-zinc-800 px-2 py-1 truncate disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {label}
      </button>
    </li>
  );
}
