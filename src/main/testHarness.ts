/**
 * Whether the app runs under a test harness: E2E_TESTING=1, honoured only in development
 * builds and in an edition built as a test edition (`testHarness: true` in its record, which
 * sits inside the app archive). A packaged edition is otherwise the licensee's to launch, and
 * an environment variable must not switch on the stand-in keychain or `ext.testing` there —
 * extensions may swap their services, licence checks among them, for fakes under it.
 */
import { app } from 'electron';
import { currentEdition } from './ipc/moduleHandlers';

/** Passed to the main window's preload, which cannot ask the main process synchronously. */
export { TEST_HARNESS_ARG } from '../shared/testHarness';

export function testHarness(): boolean {
  return process.env.E2E_TESTING === '1' && (!app.isPackaged || currentEdition()?.testHarness === true);
}
