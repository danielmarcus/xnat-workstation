/**
 * Session notes — the main part (CommonJS). It runs in the app's main process and does the
 * privileged work: XNAT REST and storage arrive in later slices of the extension framework
 * (docs/extension-framework.md). In X1 it only shows the lifecycle.
 */
let ext = null;

module.exports = {
  activate(context) {
    ext = context;
    ext.log(`main part started (API ${ext.apiVersion})`);
  },
  deactivate() {
    ext?.log('main part stopped');
    ext = null;
  },
};
