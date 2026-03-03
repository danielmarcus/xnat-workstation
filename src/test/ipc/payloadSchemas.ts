export interface ViewportBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isViewportBounds(value: unknown): value is ViewportBounds {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ViewportBounds>;
  return Number.isFinite(candidate.x)
    && Number.isFinite(candidate.y)
    && Number.isFinite(candidate.width)
    && Number.isFinite(candidate.height);
}
