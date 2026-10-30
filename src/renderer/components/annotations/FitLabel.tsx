/**
 * A label that abbreviates only when it must: it shows `label`, and `short` when the full text
 * would be cut off by the space it has (truncating `short` in turn if even that does not fit).
 * The abbreviation is a narrow-panel affordance, never the name — callers keep the full label as
 * the control's accessible name and tooltip.
 *
 * The full label is measured in an invisible copy, so it is re-checked as the panel widens while
 * the short form is showing. The label takes the width its container offers (block / flex-1),
 * which is what it is measured against.
 */
import { useLayoutEffect, useRef, useState } from 'react';

export function FitLabel({ label, short, className = '' }: { label: string; short?: string; className?: string }) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const fullRef = useRef<HTMLSpanElement>(null);
  const [abbreviate, setAbbreviate] = useState(false);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const full = fullRef.current;
    if (!short || !box || !full) return;
    const measure = () => setAbbreviate(full.offsetWidth > box.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [label, short]);

  return (
    <span ref={boxRef} className={`relative min-w-0 truncate ${className}`}>
      {short && (
        <span ref={fullRef} aria-hidden className="invisible absolute left-0 top-0 whitespace-nowrap">
          {label}
        </span>
      )}
      {short && abbreviate ? short : label}
    </span>
  );
}
