// The renderer part: what the extension shows. The host shows the tab and the command only while
// the gate enables the 'hello' feature; the Settings page always (that is where a licence goes).
import { useState } from 'react';
import type { RendererExtensionContext } from '@nrgxnat/workstation-extension-api';

export function activate(ext: RendererExtensionContext) {
  function HelloTab() {
    const session = ext.viewer.session();
    return <div className="p-3 text-xs text-zinc-300">Hello{session ? `, ${session.sessionLabel}` : ''}!</div>;
  }

  function SettingsPage() {
    const { Button } = ext.ui.components;
    const [message, setMessage] = useState('');
    const importLicence = async () => {
      const file = await ext.files.open({ title: 'Import licence', filters: [{ name: 'Licence', extensions: ['json'] }] });
      if (!file) return;
      try {
        await ext.channel.request({ op: 'install-licence', text: new TextDecoder().decode(file.data) });
        setMessage('Licence imported');
      } catch (err) {
        setMessage(`Not imported: ${(err as Error).message}`);
      }
    };
    return (
      <div className="space-y-2 text-xs text-zinc-300">
        <Button onClick={() => { void importLicence(); }}>Import licence…</Button>
        {message && <div>{message}</div>}
      </div>
    );
  }

  ext.ui.sidebarTab({ title: 'Hello', component: HelloTab, feature: 'hello' });
  ext.ui.settingsPage({ component: SettingsPage });
  ext.commands.register({ id: 'greet', title: 'Say hello', run: () => ext.log('hello'), keys: [{ key: 'y' }], feature: 'hello' });
}
