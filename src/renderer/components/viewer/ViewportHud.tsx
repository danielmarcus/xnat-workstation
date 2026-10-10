/**
 * Transient viewport readout (SegWorks parity R2). Bottom-centre of the ACTIVE viewport,
 * above the scale bar, for ~1.2 s after a hotkey changes the tool, mode, brush size,
 * mask visibility or Hide PHI.
 */
import { useEffect, useState } from 'react';
import { useHudStore } from '../../stores/hudStore';
import { useViewerStore } from '../../stores/viewerStore';

const VISIBLE_MS = 1200;

export default function ViewportHud({ panelId }: { panelId: string }) {
  const text = useHudStore((s) => s.text);
  const seq = useHudStore((s) => s.seq);
  const active = useViewerStore((s) => s.activeViewportId === panelId);
  const [shownSeq, setShownSeq] = useState(-1);

  useEffect(() => {
    if (!text) return;
    setShownSeq(seq);
    const t = setTimeout(() => setShownSeq((cur) => (cur === seq ? -1 : cur)), VISIBLE_MS);
    return () => clearTimeout(t);
  }, [text, seq]);

  if (!active || !text || shownSeq !== seq) return null;
  return (
    <div
      data-testid="viewport-hud"
      className="absolute bottom-16 left-1/2 -translate-x-1/2 z-30 pointer-events-none whitespace-nowrap rounded border border-zinc-700 bg-zinc-900/90 px-2 py-0.5 text-[11px] text-zinc-100"
    >
      {text}
    </div>
  );
}
