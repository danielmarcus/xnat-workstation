/**
 * Settings › Modules (SegWorks parity branch 9, M2 — docs/segworks-parity.md §12). Presentational.
 * Installing, enabling and removing modules, the publishers you trust, and whether community
 * (unsigned or untrusted) modules may be installed. Confirmations are inline; status in place.
 */
import { useState } from 'react';
import { describeAccess, describeTier, useModulesSettings } from '../../hooks/useModulesSettings';
import type { ModuleTier } from '@shared/modules/types';

const BADGE: Record<ModuleTier, { label: string; className: string }> = {
  bundled: { label: 'Bundled', className: 'bg-zinc-700 text-zinc-200' },
  verified: { label: 'Verified', className: 'bg-emerald-900/70 text-emerald-200' },
  community: { label: 'Community', className: 'bg-amber-900/70 text-amber-200' },
};

const BTN = 'px-2 py-1 rounded text-[11px] bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-40';

export default function ModulesSection() {
  const m = useModulesSettings();
  const [dragging, setDragging] = useState(false);
  if (!m.available) return <p className="text-xs text-zinc-500">Modules are available in the desktop app.</p>;
  const access = m.pending ? describeAccess(m.pending.summary) : null;
  return (
    <div
      className={`space-y-4 rounded-lg ${dragging ? 'outline outline-2 outline-blue-500/60' : ''}`}
      data-testid="modules-settings"
      // stopPropagation: the app's own drop zone (DICOM files) sits behind the dialog.
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragging(false);
        const f = e.dataTransfer.files[0];
        if (f) void m.drop(f);
      }}
    >
      <div className="text-xs text-zinc-400">
        Modules add operations to the Operations section. They run in a sandbox: they see only the
        image and segments they declare, and cannot reach the network or your files.
      </div>

      <div className="flex items-center gap-2">
        <button type="button" className={BTN} onClick={() => { void m.pick(); }}>Install module…</button>
        <span className="text-[11px] text-zinc-500">or drop a .xwmodule file here</span>
      </div>

      {m.pending && access && (
        <div className="rounded-lg border border-amber-700/60 bg-amber-950/30 p-3 space-y-2" data-testid="module-confirm">
          <div className="text-xs text-amber-200 font-medium">
            Install {m.pending.summary.name} {m.pending.summary.version}? It is a community module.
          </div>
          <dl className="text-[11px] text-zinc-300 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            <dt className="text-zinc-500">Publisher</dt><dd>{m.pending.summary.publisher}</dd>
            <dt className="text-zinc-500">Signature</dt><dd>{describeTier(m.pending.summary)}</dd>
            <dt className="text-zinc-500">Reads</dt><dd>{access.reads}</dd>
            <dt className="text-zinc-500">Writes</dt><dd>{access.writes}</dd>
            {m.pending.installed && (<><dt className="text-zinc-500">Replaces</dt><dd>version {m.pending.installed}</dd></>)}
          </dl>
          <div className="text-[11px] text-zinc-400">Install it only if you trust where it came from.</div>
          <div className="flex gap-2">
            <button type="button" className="px-2 py-1 rounded text-[11px] bg-amber-700 text-white hover:bg-amber-600" onClick={() => { void m.confirmPending(); }}>Install</button>
            <button type="button" className={BTN} onClick={m.cancelPending}>Cancel</button>
          </div>
        </div>
      )}

      {m.status && <p className="text-[11px] text-zinc-300" role="status" data-testid="modules-status">{m.status}</p>}

      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 space-y-2">
        <h3 className="text-xs font-medium text-zinc-300">Installed modules</h3>
        {m.modules.length === 0 ? (
          <p className="text-[11px] text-zinc-500">None yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {m.modules.map((l) => l.status === 'ok' ? (
              <li key={l.summary.id} className="flex items-center gap-2 text-[11px]" data-testid={`module-row-${l.summary.id}`}>
                <span className={`px-1.5 py-0.5 rounded text-[10px] ${BADGE[l.summary.tier].className}`} title={describeTier(l.summary)}>{BADGE[l.summary.tier].label}</span>
                <span className="flex-1 min-w-0 truncate text-zinc-200" title={l.summary.description}>
                  {l.summary.name} <span className="text-zinc-500">{l.summary.version} · {l.summary.publisher}</span>
                </span>
                <label className="flex items-center gap-1 text-zinc-400">
                  <input type="checkbox" aria-label={`Enable ${l.summary.name}`} checked={l.summary.enabled} onChange={(e) => { void m.setEnabled(l.summary.id, e.target.checked); }} />
                  Enabled
                </label>
                {!l.summary.bundled && (
                  <button type="button" className={BTN} aria-label={`Remove ${l.summary.name}`} onClick={() => { void m.remove(l.summary.id, l.summary.name); }}>Remove</button>
                )}
              </li>
            ) : (
              <li key={l.id} className="flex items-center gap-2 text-[11px]" data-testid={`module-row-${l.id}`}>
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-900/70 text-red-200">Refused</span>
                <span className="flex-1 min-w-0 text-red-300">{l.name ?? l.id}: {l.reason}</span>
                {!l.bundled && <button type="button" className={BTN} onClick={() => { void m.remove(l.id, l.name ?? l.id); }}>Remove</button>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium text-zinc-300">Trusted publishers</h3>
          <button type="button" className={BTN} onClick={() => { void m.trustPublisher(); }}>Add trusted publisher…</button>
        </div>
        <p className="text-[11px] text-zinc-500">A module signed by a trusted publisher installs as Verified, without a warning. Add a publisher from the key file (public.json) they give you.</p>
        {(m.settings?.trustedKeys ?? []).length > 0 && (
          <ul className="space-y-1">
            {m.settings!.trustedKeys.map((k) => (
              <li key={k.keyId} className="flex items-center gap-2 text-[11px]" data-testid={`trusted-key-${k.keyId}`}>
                <span className="flex-1 text-zinc-300">{k.name} <span className="text-zinc-500">· key {k.keyId}</span></span>
                <button type="button" className={BTN} onClick={() => { void m.untrust(k.keyId); }}>Remove</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <label className="flex items-center gap-2 text-xs text-zinc-300">
        <input type="checkbox" aria-label="Allow community modules" checked={m.settings?.allowCommunity ?? true} onChange={(e) => { void m.setAllowCommunity(e.target.checked); }} />
        Allow community modules (unsigned, or signed by a publisher you have not trusted)
      </label>
    </div>
  );
}
