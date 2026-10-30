// An extension whose sidebar tab throws when drawn, and whose command asks for a key the app
// already uses (W, window/level): the slot shows the error in place; the key stays the app's.
export function activate(ext) {
  ext.ui.sidebarTab({ title: 'Faulty', component: () => { throw new Error('tab boom'); } });
  ext.commands.register({ id: 'grab-w', title: 'Grab W', run: () => {}, keys: [{ key: 'w' }] });
  ext.log('faulty started');
}
