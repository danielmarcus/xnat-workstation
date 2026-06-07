/**
 * Harness Smoke (launch-only, no network)
 *
 * Proves that the built Electron app launches headless in this environment and
 * that the renderer process mounts React. This is the Phase-0 "can we run E2E
 * here at all?" gate — it must NOT depend on a live XNAT server.
 *
 * It also probes WebGL2 availability in the renderer, because Cornerstone3D v4
 * requires a WebGL2 context to render image viewports. If WebGL2 is unavailable
 * in headless Electron, the walking-skeleton (real viewport render) will need
 * GPU/software-GL launch flags — better to learn that here than later.
 */
import { test, expect } from '../fixtures/electron-app';

test.describe('Harness smoke (launch-only)', () => {
  test('electron launches and the renderer mounts', async ({ page }) => {
    // The `page` fixture already waited for domcontentloaded. Assert the React
    // root mounted and the initial (disconnected) UI — the login form — rendered.
    await expect(page.locator('[data-testid="login-form"]')).toBeVisible({ timeout: 30_000 });
  });

  test('renderer has a working WebGL2 context (Cornerstone3D dependency)', async ({ page }) => {
    const gl = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('webgl2');
      if (!ctx) return { ok: false, renderer: null as string | null };
      const dbg = ctx.getExtension('WEBGL_debug_renderer_info');
      const renderer = dbg ? (ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string) : 'unknown';
      return { ok: true, renderer };
    });
    // Diagnostic — surfaces the GL backend (hardware vs swiftshader) in the report.
    console.log(`[smoke] WebGL2 available=${gl.ok} renderer=${gl.renderer}`);
    expect(gl.ok, 'WebGL2 context must be creatable for Cornerstone3D rendering').toBe(true);
  });
});
