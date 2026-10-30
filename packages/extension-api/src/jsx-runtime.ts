/** `react/jsx-runtime` for an extension's renderer bundle: the app's own (see ./react.ts). */
import type * as JsxRuntime from 'react/jsx-runtime';
import { EXTENSION_HOST_GLOBAL } from '../../../src/shared/extensions/api';

const host = (globalThis as Record<string, unknown>)[EXTENSION_HOST_GLOBAL] as { jsxRuntime: typeof JsxRuntime } | undefined;
if (!host) throw new Error('This extension runs only inside XNAT Workstation (its React was not found).');

export const { Fragment, jsx, jsxs } = host.jsxRuntime;
