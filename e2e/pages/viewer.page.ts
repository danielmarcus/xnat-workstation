/**
 * ViewerPage Page Object
 *
 * Wraps selectors and actions for the main viewer, toolbar, and viewport.
 */
import type { Page, Locator } from '@playwright/test';
import { CanvasInteractor } from '../helpers/canvas-interaction';

export class ViewerPage {
  public canvas: CanvasInteractor;

  constructor(
    private page: Page,
    private panelId = 'panel_0',
  ) {
    this.canvas = new CanvasInteractor(page, this.viewportCanvas);
  }

  // ─── Viewport Locators ─────────────────────────────────────────

  get viewport() {
    return this.page.locator(`[data-testid="cornerstone-viewport:${this.panelId}"]`);
  }

  get viewportCanvas() {
    return this.page.locator(`[data-testid="cornerstone-viewport-canvas:${this.panelId}"] canvas`);
  }

  get viewportStatus() {
    return this.page.locator(`[data-testid="cornerstone-viewport-status:${this.panelId}"]`);
  }

  get viewportError() {
    return this.page.locator(`[data-testid="cornerstone-viewport-error:${this.panelId}"]`);
  }

  get viewportOverlay() {
    return this.page.locator(`[data-testid="viewport-overlay:${this.panelId}"]`);
  }

  // ─── Toolbar Locators ──────────────────────────────────────────

  get toolbar() {
    return this.page.locator('[data-testid="toolbar"]');
  }

  get segmentationPanel() {
    return this.page.locator('[data-testid="segmentation-panel"]');
  }

  // ─── Toolbar Actions ───────────────────────────────────────────

  /** Select a tool by its title attribute */
  async selectTool(title: string) {
    await this.toolbar.locator(`button[title="${title}"]`).click();
  }

  async selectWindowLevel() {
    await this.selectTool('Window/Level (left-click drag)');
  }

  async selectPan() {
    await this.selectTool('Pan (left-click drag)');
  }

  async selectZoom() {
    await this.selectTool('Zoom (left-click drag)');
  }

  async resetViewport() {
    await this.selectTool('Reset viewport');
  }

  async openSegmentationPanel(timeout = 10_000) {
    if (await this.segmentationPanel.isVisible().catch(() => false)) {
      return;
    }

    const annotationToolsTrigger = this.toolbar.locator('button[title="Annotation tools"]');
    if (await annotationToolsTrigger.isVisible().catch(() => false)) {
      await annotationToolsTrigger.click();
    }

    const segmentationToggle = this.page.locator(
      'button[title="Show segmentation panel"], button[title="Hide segmentation panel"]',
    ).first();

    await segmentationToggle.waitFor({ state: 'visible', timeout });
    await segmentationToggle.click();
    await this.segmentationPanel.waitFor({ state: 'visible', timeout });
  }

  // ─── Wait Helpers ──────────────────────────────────────────────

  /** Wait for image to finish loading in the viewport */
  async waitForImageLoaded(timeout = 60_000) {
    // Wait for the status text (loading indicator) to disappear
    await this.viewportStatus.waitFor({ state: 'hidden', timeout });
    // Verify canvas is visible (may take time for DICOM data to render)
    await this.viewportCanvas.waitFor({ state: 'visible', timeout: 30_000 });
  }

  /** Get the image index text from the viewport overlay (e.g., "Im: 50/200") */
  async getImageIndexText(): Promise<string> {
    const bottomLeft = this.page.locator(
      `[data-testid="viewport-overlay-corner:bottomLeft:${this.panelId}"]`,
    );
    return bottomLeft.innerText();
  }

  /** Get the W/L text from the overlay (bottom-left corner contains W/L values) */
  async getWindowLevelText(): Promise<string> {
    const bottomLeft = this.page.locator(
      `[data-testid="viewport-overlay-corner:bottomLeft:${this.panelId}"]`,
    );
    return bottomLeft.innerText();
  }
}
