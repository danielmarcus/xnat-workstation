/**
 * Contour geometry helpers — pure Point3 vector math.
 *
 * Extracted verbatim from segmentationService.ts (Phase 0 decomposition,
 * pure extraction — no logic change). These are dependency-free functions
 * over Cornerstone's Point3 tuple type; the service imports them back.
 */
import type { Types as CoreTypes } from '@cornerstonejs/core';

export type Point3 = CoreTypes.Point3;

export function toPoint3(value: unknown): Point3 | null {
  // Accept both regular arrays and typed-array-like inputs. Cornerstone's
  // contour-interpolation pipeline emits polyline points as Float32Array(3)
  // via gl-matrix's vec3.create(), which `Array.isArray` rejects. Anything
  // with a numeric `length >= 3` and indexable numeric entries 0/1/2 is a
  // valid Point3 source (regular arrays, Float32Array, Float64Array, etc.).
  if (value == null || typeof value !== 'object') return null;
  const view = value as ArrayLike<unknown>;
  if (typeof view.length !== 'number' || view.length < 3) return null;
  const x = Number(view[0]);
  const y = Number(view[1]);
  const z = Number(view[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return [x, y, z] as Point3;
}

export function addPoint3(a: Point3, b: Point3): Point3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]] as Point3;
}

export function subtractPoint3(a: Point3, b: Point3): Point3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] as Point3;
}

export function dotPoint3(a: Point3, b: Point3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function crossPoint3(a: Point3, b: Point3): Point3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ] as Point3;
}

export function normalizePoint3(point: Point3): Point3 | null {
  const magnitude = Math.hypot(point[0], point[1], point[2]);
  if (!Number.isFinite(magnitude) || magnitude === 0) return null;
  return [point[0] / magnitude, point[1] / magnitude, point[2] / magnitude] as Point3;
}

export function clonePolyline(polyline: unknown): Point3[] {
  if (!Array.isArray(polyline)) return [];
  return polyline
    .map((point) => toPoint3(point))
    .filter((point): point is Point3 => point !== null);
}

export function cloneHandlesWithOffset(handles: unknown, delta: Point3): Record<string, unknown> | null {
  if (!handles || typeof handles !== 'object') return null;

  const next: Record<string, unknown> = { ...(handles as Record<string, unknown>) };
  const rawPoints = (handles as { points?: unknown[] }).points;
  if (Array.isArray(rawPoints)) {
    next.points = rawPoints.map((point) => {
      const normalized = toPoint3(point);
      return normalized ? addPoint3(normalized, delta) : point;
    });
  }

  const textBox = (handles as { textBox?: Record<string, unknown> }).textBox;
  if (textBox && typeof textBox === 'object') {
    const nextTextBox: Record<string, unknown> = { ...textBox };
    const worldPosition = toPoint3(textBox.worldPosition);
    if (worldPosition) {
      nextTextBox.worldPosition = addPoint3(worldPosition, delta);
    }
    const worldBoundingBox = textBox.worldBoundingBox;
    if (worldBoundingBox && typeof worldBoundingBox === 'object') {
      const nextBoundingBox: Record<string, unknown> = { ...worldBoundingBox };
      for (const key of ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const) {
        const normalized = toPoint3((worldBoundingBox as Record<string, unknown>)[key]);
        if (normalized) {
          nextBoundingBox[key] = addPoint3(normalized, delta);
        }
      }
      nextTextBox.worldBoundingBox = nextBoundingBox;
    }
    next.textBox = nextTextBox;
  }

  return next;
}
