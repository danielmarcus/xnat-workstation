/**
 * The activation gate in the renderer (extension framework X6, design point 10): what an
 * extension registered is shown only while its gate allows it — a locked feature is absent (no
 * slot, command, key or ⌘K entry), not disabled — and it changes live, without the extension
 * re-registering. Its Settings page stays while it is gated (that is where a licence goes).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createExtensionUiApi, executeExtensionCommand, setExtensionGate, useExtensionUiStore, visible, __resetExtensionUiForTests } from '../uiRegistry';
import { hotkeyService } from '../../hotkeys/hotkeyService';

const ID = 'org.example.notes';
const C = () => null;

beforeEach(() => {
  __resetExtensionUiForTests();
  hotkeyService.setHotkeyMap({});
  hotkeyService.install();
});

function registerAll() {
  const { ui, commands } = createExtensionUiApi(ID, 'Session notes');
  ui.sidebarTab({ title: 'Notes', component: C, feature: 'notes' });
  ui.toolbarItem({ label: '3 notes', feature: 'count' });
  ui.view({ id: 'all', title: 'All notes', component: C, feature: 'all-notes' });
  ui.settingsPage({ component: C });
  const next = vi.fn();
  commands.register({ id: 'next', title: 'Next note', run: next, keys: [{ key: 'n' }], feature: 'notes' });
  const open = vi.fn();
  commands.register({ id: 'all', title: 'Open All notes', run: open, feature: 'all-notes' });
  return { ui, next, open };
}

const shown = () => {
  const s = useExtensionUiStore.getState();
  return {
    tabs: visible(s, s.sidebarTabs).length,
    items: visible(s, s.toolbarItems).length,
    views: visible(s, s.views).length,
    pages: visible(s, s.settingsPages).length,
    commands: visible(s, s.commands).map((c) => c.id),
  };
};
const press = (key: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

describe('the gate in the renderer', () => {
  it('no gate yet (no main part): everything shows', () => {
    registerAll();
    expect(shown()).toEqual({ tabs: 1, items: 1, views: 1, pages: 1, commands: ['next', 'all'] });
  });

  it('gated (inactive): nothing shows but its Settings page; its keys are unbound and its commands do not run', () => {
    const { next, open } = registerAll();
    setExtensionGate(ID, { active: false, features: [], reason: 'No licence' });
    expect(shown()).toEqual({ tabs: 0, items: 0, views: 0, pages: 1, commands: [] });
    press('n');
    expect(next).not.toHaveBeenCalled();
    executeExtensionCommand(ID, 'all');
    expect(open).not.toHaveBeenCalled();
    expect(hotkeyService.extensionActions()).toEqual([]);
  });

  it('a tier: only its features show; a locked view cannot be opened', () => {
    const { ui, next } = registerAll();
    setExtensionGate(ID, { active: true, features: ['notes'], tier: 'Basic' });
    expect(shown()).toEqual({ tabs: 1, items: 0, views: 0, pages: 1, commands: ['next'] });
    press('n');
    expect(next).toHaveBeenCalledTimes(1);
    ui.openView('all');
    expect(useExtensionUiStore.getState().openView).toBeNull();
  });

  it('changes apply live: a higher tier mounts the rest; losing the licence closes an open view and unbinds keys', () => {
    const { ui, next } = registerAll();
    setExtensionGate(ID, { active: true, features: ['notes'], tier: 'Basic' });
    setExtensionGate(ID, { active: true, features: ['notes', 'count', 'all-notes'], tier: 'Pro' });
    expect(shown()).toEqual({ tabs: 1, items: 1, views: 1, pages: 1, commands: ['next', 'all'] });
    ui.openView('all');
    expect(useExtensionUiStore.getState().openView).toEqual({ extId: ID, id: 'all' });
    setExtensionGate(ID, { active: false, features: [], reason: 'Licence expired 2027-01-31' });
    expect(useExtensionUiStore.getState().openView).toBeNull();
    press('n');
    expect(next).not.toHaveBeenCalled();
  });

  it('a contribution naming a feature the gate does not enable stays hidden, whatever the tier', () => {
    const { ui } = createExtensionUiApi(ID, 'Session notes');
    ui.toolbarItem({ label: 'x', feature: 'undeclared' });
    setExtensionGate(ID, { active: true, features: ['notes'] });
    expect(shown().items).toBe(0);
  });
});
