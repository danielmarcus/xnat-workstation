/**
 * Settings › Extensions (extension framework X1, wireframe E4 — docs/mockup/extension-wireframes.html).
 * Every extension the edition ships, in every state, with the reason when it is not active and
 * the Enabled switch. State is shown here, in place: extensions raise no toasts or banners.
 */
import { useExtensionStore } from '../../stores/extensionStore';
import { setExtensionEnabled } from '../../lib/extensions/rendererHost';
import { useExtensionUiStore } from '../../lib/extensions/uiRegistry';
import type { ExtensionState } from '@shared/extensions/types';

const CHIP: Record<ExtensionState, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-emerald-900/70 text-emerald-200' },
  inactive: { label: 'Inactive', className: 'bg-amber-900/70 text-amber-200' },
  refused: { label: 'Refused', className: 'bg-red-900/70 text-red-200' },
  disabled: { label: 'Disabled', className: 'bg-zinc-700 text-zinc-300' },
};

export default function ExtensionsSection({ onOpenPage }: { onOpenPage?: (extId: string) => void }) {
  const extensions = useExtensionStore((s) => s.extensions);
  const pages = useExtensionUiStore((s) => s.settingsPages);
  return (
    <div className="space-y-4" data-testid="extensions-settings">
      <div className="text-xs text-zinc-400">
        Extensions come with this edition of the app and are covered by its signature. They act
        as you, with your XNAT permissions.
      </div>
      <ul className="space-y-2">
        {extensions.map((x) => (
          <li key={x.key} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 space-y-1" data-testid={`extension-row-${x.key}`}>
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-xs font-medium text-zinc-200 truncate" title={x.description}>{x.name}</span>
              {(x.version || x.publisher) && (
                <span className="text-zinc-500 truncate">{[x.version, x.publisher].filter(Boolean).join(' · ')}</span>
              )}
              <span className={`px-1.5 py-0.5 rounded text-[10px] ${CHIP[x.state].className}`} data-testid="extension-state">{CHIP[x.state].label}</span>
              <span className="flex-1" />
              {x.state !== 'refused' && x.id && (
                <label className="flex items-center gap-1 text-zinc-400">
                  <input
                    type="checkbox"
                    aria-label={`Enable ${x.name}`}
                    checked={x.state !== 'disabled'}
                    onChange={(e) => { void setExtensionEnabled(x.id!, e.target.checked); }}
                  />
                  Enabled
                </label>
              )}
            </div>
            {x.reason && <div className="text-[11px] text-zinc-300" data-testid="extension-reason">{x.reason}</div>}
            {x.id && onOpenPage && pages.some((p) => p.extId === x.id) && (
              <button type="button" className="text-[11px] text-zinc-400 hover:text-zinc-200 underline underline-offset-2" onClick={() => onOpenPage(x.id!)}>
                Settings…
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
