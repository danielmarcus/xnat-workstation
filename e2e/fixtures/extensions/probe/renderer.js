// The probe's renderer part: hands its own `ext` to the E2E specs (window.__extProbe) and records
// every event and every message its main part posts — so the specs drive the real extension API.
const EVENTS = ['signedIn', 'signedOut', 'sessionChanged', 'activeViewportChanged', 'activeAnnotationChanged', 'annotationsChanged'];

export function activate(ext) {
  const events = [];
  const posts = [];
  for (const name of EVENTS) ext.events.on(name, () => events.push(name));
  ext.channel.onMessage((m) => posts.push(m));
  window.__extProbe = { ext, events, posts };
}

export function deactivate() {
  delete window.__extProbe;
}
