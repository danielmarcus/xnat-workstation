/**
 * Session notes — the renderer part (an ES module). It runs in the app's window and draws the
 * extension's UI: the sidebar tab, toolbar item and full-window view arrive in X2 of the
 * extension framework (docs/extension-framework.md). In X1 it only shows the lifecycle.
 */
let ext = null;

export function activate(context) {
  ext = context;
  ext.log(`renderer part started (API ${ext.apiVersion})`);
}

export function deactivate() {
  ext?.log('renderer part stopped');
  ext = null;
}
