/**
 * Hold-to-probe (SegWorks parity R3, #25): while the probe key is held, the intensity under
 * the pointer on this viewport — without changing tools. Tracks the last pointer position
 * so the readout is right even when the key is pressed with the mouse still.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { getIntensityAtWorld, getWorldPointFromClientPoint, type IntensitySample } from '../lib/cornerstone/unifiedCrosshair';
import { useProbeStore } from '../stores/probeStore';
import { useViewerStore } from '../stores/viewerStore';

export interface HoverProbe {
  sample: IntensitySample;
  /** Pointer position relative to the host element. */
  x: number;
  y: number;
}

export function useHoverProbe(panelId: string, hostRef: RefObject<HTMLElement | null>): HoverProbe | null {
  const holding = useProbeStore((s) => s.holding);
  const imageIndex = useViewerStore((s) => s.viewports[panelId]?.imageIndex);
  const last = useRef<{ clientX: number; clientY: number } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    // The readout layer ignores the pointer (it must not block drawing); listen on the
    // viewport element it covers instead.
    const host = hostRef.current?.parentElement;
    if (!host) return;
    const onMove = (e: PointerEvent) => {
      last.current = { clientX: e.clientX, clientY: e.clientY };
      if (useProbeStore.getState().holding) setTick((t) => t + 1);
    };
    const onLeave = () => {
      last.current = null;
      if (useProbeStore.getState().holding) setTick((t) => t + 1);
    };
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    return () => {
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
    };
  }, [hostRef]);

  void tick;
  void imageIndex;
  const host = hostRef.current;
  if (!holding || !last.current || !host) return null;
  const world = getWorldPointFromClientPoint(panelId, last.current.clientX, last.current.clientY);
  const sample = world ? getIntensityAtWorld(panelId, world) : null;
  if (!sample) return null;
  const r = host.getBoundingClientRect();
  return { sample, x: last.current.clientX - r.left, y: last.current.clientY - r.top };
}
