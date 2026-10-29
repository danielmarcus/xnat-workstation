/**
 * The React side of the extension host (docs/extension-framework.md, design point 4), installed
 * once before extensions start: the app's React where extension bundles find it (the SDK's
 * `react` and `jsx-runtime` modules read it), and the components extensions draw with.
 */
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { EXTENSION_HOST_GLOBAL } from '@shared/extensions/api';
import { setExtensionComponents } from '../../lib/extensions/uiRegistry';
import { ExtensionButton, ExtensionDialog } from './ExtensionComponents';

export function installExtensionHost(): void {
  (globalThis as Record<string, unknown>)[EXTENSION_HOST_GLOBAL] = { React, jsxRuntime };
  setExtensionComponents({ Button: ExtensionButton, Dialog: ExtensionDialog });
}
