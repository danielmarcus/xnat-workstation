/** Keeps useModuleCatalogStore in step with the installed modules (branch 9, M4). */
import { useModuleCatalogStore } from '../../stores/moduleCatalogStore';

export async function refreshModuleCatalog(): Promise<void> {
  const r = await window.electronAPI?.modules?.list();
  if (!r) return;
  useModuleCatalogStore.setState({
    modules: r.modules.flatMap((l) => (l.status === 'ok' && l.summary.enabled ? [l.summary] : [])),
  });
}
