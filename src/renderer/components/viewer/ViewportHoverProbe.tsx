/**
 * Hold-Q intensity readout beside the cursor (SegWorks parity R3). Presentational; the
 * sampling is in useHoverProbe. Modality value (HU on CT) and the voxel index.
 */
import { useRef } from 'react';
import { useHoverProbe } from '../../hooks/useHoverProbe';

const HU_MODALITIES = new Set(['CT']);

export default function ViewportHoverProbe({ panelId }: { panelId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const probe = useHoverProbe(panelId, ref);
  const s = probe?.sample;
  const value = s ? (Number.isInteger(s.value) ? String(s.value) : s.value.toFixed(1)) : '';
  const label = s?.modality && HU_MODALITIES.has(s.modality.toUpperCase()) ? 'HU' : 'Value';
  return (
    <div ref={ref} className="absolute inset-0 pointer-events-none z-20" data-testid={`hover-probe-host:${panelId}`}>
      {probe && (
        <div
          data-testid="hover-probe"
          className="absolute whitespace-nowrap rounded border border-zinc-700 bg-zinc-900/90 px-1.5 py-0.5 text-[10px] text-zinc-100 tabular-nums"
          style={{ left: probe.x + 14, top: probe.y - 22 }}
        >
          {label} {value}
          {s?.index && <span className="text-zinc-400"> · ({s.index.join(', ')})</span>}
        </div>
      )}
    </div>
  );
}
