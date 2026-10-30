// The extension's own E2E, with the SDK's testing helpers, against a built XNAT Workstation
// (XW_CORE: a checkout of the core, built with `npm run build`).
import { test, expect } from '@playwright/test';
import { execFileSync } from 'child_process';
import * as path from 'path';
import { extension, launchWorkstation, openViewer } from '@nrgxnat/workstation-extension-api/testing';

const ID = 'org.example.hello-licensed';
const core = process.env.XW_CORE!;

test('without a licence nothing shows; with one, the Hello tab and its command', async () => {
  const run = await launchWorkstation({ mainEntry: path.join(core, 'dist/main/main/index.js'), extensionsDir: 'out' });
  try {
    const hello = extension(run.page, ID);
    await hello.waitUntilRunning(); // running although unlicensed: its Settings page takes the licence
    expect(await hello.evaluate((ext) => ext.gate.current())).toEqual({ active: false, features: [], reason: 'No licence' });
    await openViewer(run.page);
    const tabs = run.page.getByRole('tablist', { name: 'Sidebar' });
    await expect(tabs).toHaveCount(0); // no tab at all: the strip only appears with one

    const licence = execFileSync('node', ['licence.mjs', 'sign', 'Standard', '2099-12-31'], { encoding: 'utf8' });
    await hello.evaluate((ext, text) => ext.channel.request({ op: 'install-licence', text }), licence);
    expect(await hello.evaluate((ext) => ext.gate.current())).toEqual({ active: true, features: ['hello'], tier: 'Standard' });
    await tabs.getByRole('tab', { name: 'Hello', exact: true }).click();
    await expect(run.page.getByText('Hello!')).toBeVisible();
  } finally {
    await run.close();
  }
});
