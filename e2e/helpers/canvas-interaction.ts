/**
 * Canvas Interaction Helpers
 *
 * Provides coordinate-based mouse event helpers for interacting with
 * Cornerstone3D's WebGL canvas. All coordinates are specified as
 * relative offsets (0.0 to 1.0) of the canvas dimensions.
 */
import type { Locator, Page } from '@playwright/test';

interface RelativePoint {
  x: number; // 0.0 to 1.0
  y: number; // 0.0 to 1.0
}

interface AbsolutePoint {
  x: number;
  y: number;
}

async function toAbsolute(locator: Locator, point: RelativePoint): Promise<AbsolutePoint> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Canvas element has no bounding box');
  return {
    x: box.x + box.width * point.x,
    y: box.y + box.height * point.y,
  };
}

export class CanvasInteractor {
  constructor(
    private page: Page,
    private canvasLocator: Locator,
  ) {}

  /**
   * Draw a line from start to end (for Length, Bidirectional tools).
   * Uses interpolated mouse moves for realistic drawing.
   */
  async drawLine(start: RelativePoint, end: RelativePoint, steps = 10) {
    const startAbs = await toAbsolute(this.canvasLocator, start);
    const endAbs = await toAbsolute(this.canvasLocator, end);

    await this.page.mouse.move(startAbs.x, startAbs.y);
    await this.page.mouse.down();

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await this.page.mouse.move(
        startAbs.x + (endAbs.x - startAbs.x) * t,
        startAbs.y + (endAbs.y - startAbs.y) * t,
      );
    }

    await this.page.mouse.up();
  }

  /**
   * Draw a rectangle/ellipse from topLeft to bottomRight (for ROI tools).
   * Semantically identical to drawLine but named for clarity.
   */
  async drawRect(topLeft: RelativePoint, bottomRight: RelativePoint, steps = 10) {
    await this.drawLine(topLeft, bottomRight, steps);
  }

  /**
   * Draw an angle: two lines meeting at a vertex.
   * First draws vertex→arm1End, then vertex→arm2End.
   */
  async drawAngle(vertex: RelativePoint, arm1End: RelativePoint, arm2End: RelativePoint) {
    // First arm
    await this.drawLine(vertex, arm1End);
    // Small pause between the two arms
    await this.page.waitForTimeout(200);
    // Second arm
    await this.drawLine(vertex, arm2End);
  }

  /**
   * Paint a brush stroke through a series of points (for Brush/Eraser tools).
   * Holds mouse down and moves through all points with interpolation.
   */
  async paintStroke(points: RelativePoint[], stepsPerSegment = 3) {
    if (points.length < 2) throw new Error('paintStroke requires at least 2 points');

    const absPoints = await Promise.all(
      points.map((p) => toAbsolute(this.canvasLocator, p)),
    );

    await this.page.mouse.move(absPoints[0].x, absPoints[0].y);
    await this.page.mouse.down();

    for (let i = 1; i < absPoints.length; i++) {
      const prev = absPoints[i - 1];
      const curr = absPoints[i];
      for (let s = 1; s <= stepsPerSegment; s++) {
        const t = s / stepsPerSegment;
        await this.page.mouse.move(
          prev.x + (curr.x - prev.x) * t,
          prev.y + (curr.y - prev.y) * t,
        );
      }
    }

    await this.page.mouse.up();
  }

  /**
   * Click a point on the canvas.
   */
  async click(point: RelativePoint, options?: { button?: 'left' | 'right' | 'middle' }) {
    const abs = await toAbsolute(this.canvasLocator, point);
    await this.page.mouse.click(abs.x, abs.y, options);
  }

  /**
   * Scroll (mouse wheel) at the center of the canvas.
   */
  async scroll(deltaY: number, position?: RelativePoint) {
    const pos = position ?? { x: 0.5, y: 0.5 };
    const abs = await toAbsolute(this.canvasLocator, pos);
    await this.page.mouse.move(abs.x, abs.y);
    await this.page.mouse.wheel(0, deltaY);
  }

  /**
   * Click-drag for tools like Window/Level, Pan, Zoom.
   */
  async clickDrag(start: RelativePoint, end: RelativePoint, steps = 10) {
    await this.drawLine(start, end, steps);
  }
}
