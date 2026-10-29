/**
 * The renderer half of the extension host (extension framework X1): renderer parts start after
 * their main part, a failure is reported back (the extension becomes inactive), and the Enabled
 * switch stops the renderer part before the main part.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionSummary } from '@shared/extensions/types';
import { EXTENSION_API_VERSION } from '@shared/extensions/manifest';
import { setExtensionEnabled, startExtensions, stopExtensions, __resetForTests } from '../rendererHost';
import { useExtensionStore } from '../../../stores/extensionStore';

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
};
const importModule = async (url: string) => {
  if (!(url in modules)) throw new Error(`Failed to fetch dynamically imported module: ${url}`);
  return modules[url];
};

beforeEach(() => {
  calls.length = 0;
  __resetForTests();
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
});
