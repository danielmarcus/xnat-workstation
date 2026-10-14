/**
 * Settings › Modules (branch 9, M2): installed and bundled modules, installing one, trusted
 * publishers, Allow community modules. Status is shown in place — never a toast.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ModuleInspection, ModuleListing, ModuleSettings, ModuleSummary } from '@shared/modules/types';

type Pending = Extract<ModuleInspection, { ok: true }>;

const api = () => window.electronAPI?.modules;

export function describeTier(s: Pick<ModuleSummary, 'tier' | 'signature'>): string {
  if (s.tier === 'bundled') return 'Built into this edition';
  if (s.tier === 'verified') return `Signed by a trusted publisher${s.signature.signer ? ` (${s.signature.signer})` : ''}`;
  return s.signature.status === 'valid'
    ? `Signed by key ${s.signature.keyId}${s.signature.signer ? ` (${s.signature.signer})` : ''}, which you have not trusted`
    : 'Not signed';
}

export function describeAccess(s: Pick<ModuleSummary, 'reads' | 'writes'>): { reads: string; writes: string } {
  const r = s.reads;
  const reads = [
    r.image ? 'the image' : null,
    r.members === 'all' ? 'every segment of the segmentation' : r.members === 'active' ? 'the active segment' : null,
    r.seeds ? 'your seeds' : null,
    r.roi ? 'the ROI limit' : null,
  ].filter(Boolean).join(', ') || 'nothing';
  const w = s.writes;
  const target = w.target === 'new' ? `a new segment${w.newMember ? ` “${w.newMember.name}”` : ''}` : 'the active segment';
  const writes = `${w.mode === 'replace' ? 'replaces' : 'adds to'} ${target}${w.claims ? ', and may take pixels of segments it touches' : ''}`;
  return { reads, writes };
}

export function useModulesSettings() {
  const [modules, setModules] = useState<ModuleListing[]>([]);
  const [settings, setSettings] = useState<ModuleSettings | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await api()?.list();
    if (r) { setModules(r.modules); setSettings(r.settings); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  /** Install what was picked: at once if Verified, after confirmation if Community. */
  const consider = useCallback(async (inspection: ModuleInspection | undefined) => {
    if (!inspection) return;
    if (!inspection.ok) { if (!inspection.canceled) setStatus(`Not installed: ${inspection.reason}`); return; }
    if (inspection.summary.tier === 'community') {
      if (!inspection.allowCommunity) { setStatus('Not installed: community modules are turned off below'); return; }
      setStatus(null);
      setPending(inspection);
      return;
    }
    const r = await api()?.install(inspection.token, false);
    setStatus(r?.ok ? `Installed ${inspection.summary.name} ${inspection.summary.version}` : `Not installed: ${r?.reason ?? 'unknown error'}`);
    await refresh();
  }, [refresh]);

  return {
    available: !!api(),
    modules,
    settings,
    pending,
    status,
    pick: async () => consider(await api()?.pick()),
    drop: async (file: File) => consider(await api()?.inspectDropped(file)),
    confirmPending: async () => {
      if (!pending) return;
      const r = await api()?.install(pending.token, true);
      setPending(null);
      setStatus(r?.ok ? `Installed ${pending.summary.name} ${pending.summary.version} (community)` : `Not installed: ${r?.reason ?? 'unknown error'}`);
      await refresh();
    },
    cancelPending: () => { setPending(null); setStatus(null); },
    remove: async (id: string, name: string) => {
      const r = await api()?.remove(id);
      setStatus(r?.ok ? `Removed ${name}` : `Not removed: ${r?.reason ?? 'unknown error'}`);
      await refresh();
    },
    // Switches update at once (they are controlled); the refresh then confirms what was stored.
    setEnabled: async (id: string, enabled: boolean) => {
      setModules((ms) => ms.map((l) => (l.status === 'ok' && l.summary.id === id ? { ...l, summary: { ...l.summary, enabled } } : l)));
      await api()?.setEnabled(id, enabled);
      await refresh();
    },
    setAllowCommunity: async (allow: boolean) => {
      setSettings((s) => (s ? { ...s, allowCommunity: allow } : s));
      await api()?.setAllowCommunity(allow);
      await refresh();
    },
    trustPublisher: async () => {
      const r = await api()?.trustKeyPick();
      if (r && !r.canceled) setStatus(r.ok ? `Trusted ${r.key?.name ?? 'the publisher'} (key ${r.key?.keyId})` : `Not trusted: ${r.reason}`);
      await refresh();
    },
    untrust: async (keyId: string) => { await api()?.untrustKey(keyId); await refresh(); },
  };
}

export type ModulesSettingsModel = ReturnType<typeof useModulesSettings>;
