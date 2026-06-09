/**
 * Annotation-panel icons (Rebuild Phase 3).
 *
 * Inline SVGs lifted verbatim from the frozen mockup (docs/mockup/annotations-panel.html)
 * so the rendered panel pixel-matches the approved baseline. 16×16 viewBox,
 * stroke-1.5 dark-theme convention (CLAUDE.md). Type accents: Structure = emerald,
 * Segmentation = purple, Measurement = orange (blue reserved for active/selection).
 */
import type { ContainerKind } from '@shared/types/annotation';

type IconProps = { size?: number; className?: string };

/** Structure (RTSTRUCT) — contour curve. */
export function StructureGlyph({ size = 15, className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.5} className={className}>
      <path d="M3 11c2-5 8-5 10 0" />
    </svg>
  );
}

/** Segmentation (SEG) — rounded square. */
export function SegmentationGlyph({ size = 15, className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.5} className={className}>
      <rect x="3" y="3" width="10" height="10" rx="2" />
    </svg>
  );
}

/** Measurement (SR) — diamond. */
export function MeasurementGlyph({ size = 15, className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.5} className={className}>
      <path d="M2 10 L10 2 L14 6 L6 14 Z" />
    </svg>
  );
}

export function KindGlyph({ kind, size, className }: { kind: ContainerKind } & IconProps) {
  if (kind === 'RTSTRUCT') return <StructureGlyph size={size} className={className} />;
  if (kind === 'SEG') return <SegmentationGlyph size={size} className={className} />;
  return <MeasurementGlyph size={size} className={className} />;
}

export function PlusGlyph({ size = 9, className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2.2} className={className}>
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

export function SaveGlyph({ size = 15, className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.4} className={className}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
      <path d="M5 2.5v3.5h5.5V2.5" />
      <rect x="5" y="8.5" width="6" height="5" />
    </svg>
  );
}

export function KebabGlyph({ size = 13, className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.5} className={className}>
      <circle cx="8" cy="3" r="1" /><circle cx="8" cy="8" r="1" /><circle cx="8" cy="13" r="1" />
    </svg>
  );
}

export function DeleteGlyph({ size = 13, className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.5} className={className}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function ApproveGlyph({ size = 13, filled = false, className }: IconProps & { filled?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={filled ? 1.6 : 1.5} className={className}>
      <circle cx="8" cy="8" r="6" {...(filled ? { fill: 'currentColor', fillOpacity: 0.22 } : {})} />
      <path d="M5.2 8l2 2 3.6-4" />
    </svg>
  );
}

export function ChevronGlyph({ size = 12, expanded = false, className }: IconProps & { expanded?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className={className}
      style={{ transform: expanded ? 'rotate(90deg)' : undefined, transition: 'transform 120ms' }}
    >
      <path d="M5 3l5 5-5 5" />
    </svg>
  );
}

/** Eye glyph — 3-state visibility (filled / outline / hidden). */
export function VisibilityGlyph({ mode, size = 13, className }: { mode: 'filled' | 'outline' | 'hidden' } & IconProps) {
  if (mode === 'hidden') {
    return (
      <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.3} className={className}>
        <path d="M2.5 8s2.5-4 5.5-4c1 0 1.9.25 2.7.65M13.5 8s-2.5 4-5.5 4c-1 0-1.9-.25-2.7-.65" />
        <path d="M2 2l12 12" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill={mode === 'filled' ? 'currentColor' : 'none'}
      fillOpacity={mode === 'filled' ? 0.25 : undefined}
      stroke="currentColor"
      strokeWidth={1.3}
      className={className}
    >
      <path d="M1.5 8s2.5-4 6.5-4 6.5 4 6.5 4-2.5 4-6.5 4-6.5-4-6.5-4z" />
      <circle cx="8" cy="8" r="1.8" />
    </svg>
  );
}

/** Lock glyph — unlocked (open) / session-locked (amber closed) / approved (green closed). */
export function LockGlyph({ state, size = 12, className }: { state: 'unlocked' | 'locked' | 'approved' } & IconProps) {
  const closed = state !== 'unlocked';
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.3} className={className}>
      <rect x="3.5" y="7" width="9" height="6" rx="1" />
      <path d={closed ? 'M5.5 7V5a2.5 2.5 0 015 0v2' : 'M5.5 7V5a2.5 2.5 0 015 0'} />
      {closed && <circle cx="8" cy="10" r="0.9" fill="currentColor" stroke="none" />}
    </svg>
  );
}

/** Solid dot — the "active" (pen) indicator. */
export function ActiveDotGlyph({ size = 12, className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="currentColor" stroke="none" className={className}>
      <circle cx="8" cy="8" r="3.5" />
    </svg>
  );
}
