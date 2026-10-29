/**
 * The renderer half of the extension host (extension framework X1): renderer parts start after
 * their main part, a failure is reported back (the extension becomes inactive), and the Enabled
 * switch stops the renderer part before the main part.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionSummary } from '@shared/extensions/types';
import { EXTENSION_API_VERSION } from '@shared/extensions/manifest';
import { reloadExtension, setExtensionEnabled, startExtensions, stopExtensions, __resetForTests } from '../rendererHost';
import { useExtensionStore } from '../../../stores/extensionStore';
import { useExtensionUiStore, __resetExtensionUiForTests } from '../uiRegistry';
import type { RendererExtensionContext } from '@shared/extensions/api';

const active = (id: string): ExtensionSummary => ({ key: id, id, name: id, version: '1.0.0', state: 'active', rendererUrl: `xnat-extension://${id}/renderer.js` });
const calls: string[] = [];

function fakeApi(initial: ExtensionSummary[]) {
  let list = initial;
  return {
    list: vi.fn(async () => list),
    setEnabled: vi.fn(async (id: string, enabled: boolean) => {
      calls.push(`main ${enabled ? 'enable' : 'disable'} ${id}`);
      list = list.map((s) => (s.id === id ? (enabled ? active(id) : { ...s, state: 'disabled' as const, rendererUrl: undefined }) : s));
      return list;
    }),
    rendererFailed: vi.fn(async (id: string, reason: string) => {
      list = list.map((s) => (s.id === id ? { ...s, state: 'inactive' as const, reason: `Failed to start: ${reason}`, rendererUrl: undefined } : s));
      return list;
    }),
  };
}

const modules: Record<string, unknown> = {
  'xnat-extension://org.example.notes/renderer.js': {
    activate: (ext: { id: string; apiVersion: string }) => { calls.push(`renderer activate ${ext.id} ${ext.apiVersion}`); },
    deactivate: () => { calls.push('renderer deactivate org.example.notes'); },
  },
  'xnat-extension://org.example.throws/renderer.js': { activate: () => { throw new Error('boom'); } },
  'xnat-extension://org.example.empty/renderer.js': {},
  'xnat-extension://org.example.ui/renderer.js': {
    activate: (ext: RendererExtensionContext) => {
      calls.push(`ui activate ${ext.name}`);
      const Tab = () => null;
      ext.ui.sidebarTab({ title: 'Notes', component: Tab });
      ext.ui.toolbarItem({ label: '3 notes', icon: '📝' });
      ext.ui.view({ id: 'all', title: 'All notes', component: Tab });
      ext.ui.settingsPage({ component: Tab });
      ext.commands.register({ id: 'next', title: 'Next note', run: () => {}, keys: [{ key: 'n' }] });
      ext.ui.openView('all');
    },
  },
  'xnat-extension://org.example.halfway/renderer.js': {
    activate: (ext: RendererExtensionContext) => {
      ext.ui.sidebarTab({ title: 'Half', component: () => null });
      throw new Error('after registering');
    },
  },
};
const ui = () => useExtensionUiStore.getState();
const counts = () => ({ tabs: ui().sidebarTabs.length, items: ui().toolbarItems.length, views: ui().views.length, pages: ui().settingsPages.length, commands: ui().commands.length });
const NONE = { tabs: 0, items: 0, views: 0, pages: 0, commands: 0 };
const ALL = { tabs: 1, items: 1, views: 1, pages: 1, commands: 1 };
const importModule = async (url: string) => {
  if (!(url in modules)) throw new Error(`Failed to fetch dynamically imported module: ${url}`);
  return modules[url];
};

beforeEach(() => {
  calls.length = 0;
  __resetForTests();
  __resetExtensionUiForTests();
  useExtensionStore.setState({ extensions: [] });
});

describe('renderer extension host', () => {
  it('starts each active extension\'s renderer part and publishes the list', async () => {
    const api = fakeApi([active('org.example.notes'), { key: 'x', id: 'org.example.x', name: 'X', state: 'refused', reason: 'nope' }]);
    await startExtensions({ api, importModule });
    expect(calls).toEqual([`renderer activate org.example.notes ${EXTENSION_API_VERSION}`]);
    expect(useExtensionStore.getState().extensions.map((s) => s.state)).toEqual(['active', 'refused']);
  });

  it('a renderer part that throws, lacks activate() or cannot load is reported, and the extension shows inactive', async () => {
    const api = fakeApi([active('org.example.throws'), active('org.example.empty'), active('org.example.gone')]);
    await startExtensions({ api, importModule });
    expect(api.rendererFailed).toHaveBeenCalledWith('org.example.throws', 'boom');
    expect(api.rendererFailed).toHaveBeenCalledWith('org.example.empty', 'renderer.js exports no activate()');
    expect(api.rendererFailed).toHaveBeenCalledWith('org.example.gone', expect.stringMatching(/Failed to fetch/));
    expect(useExtensionStore.getState().extensions.every((s) => s.state === 'inactive')).toBe(true);
  });

  it('disabling stops the renderer part first, then the main part; enabling starts them in the other order', async () => {
    const api = fakeApi([active('org.example.notes')]);
    await startExtensions({ api, importModule });
    calls.length = 0;
    await setExtensionEnabled('org.example.notes', false);
    expect(calls).toEqual(['renderer deactivate org.example.notes', 'main disable org.example.notes']);
    expect(useExtensionStore.getState().extensions[0].state).toBe('disabled');
    calls.length = 0;
    await setExtensionEnabled('org.example.notes', true);
    expect(calls).toEqual(['main enable org.example.notes', `renderer activate org.example.notes ${EXTENSION_API_VERSION}`]);
    expect(useExtensionStore.getState().extensions[0].state).toBe('active');
  });

  it('starts once per page, however often it is called (StrictMode mounts twice)', async () => {
    const api = fakeApi([active('org.example.notes')]);
    await Promise.all([startExtensions({ api, importModule }), startExtensions({ api, importModule })]);
    expect(calls).toEqual([`renderer activate org.example.notes ${EXTENSION_API_VERSION}`]);
  });

  it('stopExtensions deactivates every running renderer part', async () => {
    const api = fakeApi([active('org.example.notes')]);
    await startExtensions({ api, importModule });
    calls.length = 0;
    stopExtensions();
    expect(calls).toEqual(['renderer deactivate org.example.notes']);
  });

  it('without the desktop API there are no extensions', async () => {
    await startExtensions({ api: undefined, importModule });
    expect(useExtensionStore.getState().extensions).toEqual([]);
  });

  it('what an extension adds to the UI is removed when it is disabled, and returns when it is enabled (X2)', async () => {
    const api = fakeApi([{ ...active('org.example.ui'), name: 'Session notes' }]);
    await startExtensions({ api, importModule });
    expect(calls).toEqual(['ui activate Session notes']);
    expect(counts()).toEqual(ALL);
    expect(ui().openView).toEqual({ extId: 'org.example.ui', id: 'all' });
    expect(ui().commands[0]).toMatchObject({ extName: 'Session notes', action: 'ext:org.example.ui:next' });

    await setExtensionEnabled('org.example.ui', false);
    expect(counts()).toEqual(NONE);
    expect(ui().openView).toBeNull();
    await setExtensionEnabled('org.example.ui', true);
    expect(counts()).toEqual(ALL);
  });

  it('a renderer part that fails after registering leaves nothing behind', async () => {
    const api = fakeApi([active('org.example.halfway')]);
    await startExtensions({ api, importModule });
    expect(counts()).toEqual(NONE);
    expect(useExtensionStore.getState().extensions[0]).toMatchObject({ state: 'inactive', reason: 'Failed to start: after registering' });
  });

  it('reloading an extension removes what it added and runs activate() again', async () => {
    const api = fakeApi([{ ...active('org.example.ui'), name: 'Session notes' }]);
    await startExtensions({ api, importModule });
    ui().toolbarItems.forEach(() => undefined);
    await reloadExtension('org.example.ui');
    expect(calls).toEqual(['ui activate Session notes', 'ui activate Session notes']);
    expect(counts()).toEqual(ALL); // not doubled
  });
});
