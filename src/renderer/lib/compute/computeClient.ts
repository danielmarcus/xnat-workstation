/**
 * Runs named algorithms in a Web Worker (SegWorks parity branch 4, C2), off the thread that
 * draws the viewports. One job at a time: starting a job cancels the one running. Cancel
 * terminates the worker — a solve in a tight loop cannot be interrupted any other way — and
 * the next job starts a fresh one.
 */
import type { ComputeAlgorithms, ComputeName, ComputeRequest, ComputeResponse } from './protocol';

export interface WorkerLike {
  postMessage(msg: ComputeRequest, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<ComputeResponse>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
}

export class ComputeCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'ComputeCancelled';
  }
}

export interface ComputeJob<T> {
  result: Promise<T>;
  cancel: () => void;
}

export function createComputeClient(makeWorker: () => WorkerLike) {
  let worker: WorkerLike | null = null;
  let nextId = 1;
  let current: { id: number; reject: (e: Error) => void } | null = null;
  let throttleMs = 0;

  const stop = () => {
    worker?.terminate();
    worker = null;
  };

  return {
    run<N extends ComputeName>(
      name: N,
      input: ComputeAlgorithms[N]['input'],
      opts: { onProgress?: (fraction: number) => void; transfer?: Transferable[] } = {},
    ): ComputeJob<ComputeAlgorithms[N]['output']> {
      if (current) {
        current.reject(new ComputeCancelled());
        current = null;
        stop();
      }
      const id = nextId++;
      let settle: { resolve: (v: ComputeAlgorithms[N]['output']) => void; reject: (e: Error) => void };
      const result = new Promise<ComputeAlgorithms[N]['output']>((resolve, reject) => { settle = { resolve, reject }; });
      current = { id, reject: (e) => settle.reject(e) };
      const w = worker ?? (worker = makeWorker());
      w.onmessage = (e) => {
        const msg = e.data;
        if (!current || msg.id !== current.id) return;
        if (msg.type === 'progress') opts.onProgress?.(msg.fraction);
        else if (msg.type === 'result') { current = null; settle.resolve(msg.output as ComputeAlgorithms[N]['output']); }
        else { current = null; settle.reject(new Error(msg.message)); }
      };
      w.onerror = (e) => {
        if (current?.id !== id) return;
        current = null;
        stop();
        settle.reject(new Error(e.message || 'compute worker failed'));
      };
      w.postMessage({ id, name, input, throttleMs: throttleMs || undefined }, opts.transfer ?? []);
      return {
        result,
        cancel: () => {
          if (current?.id !== id) return;
          current = null;
          stop();
          settle.reject(new ComputeCancelled());
        },
      };
    },
    /** Cancel whatever job is running (the progress bar's Cancel — whichever operation started it). */
    cancelCurrent(): void {
      if (!current) return;
      const c = current;
      current = null;
      stop();
      c.reject(new ComputeCancelled());
    },
    /** E2E seam: slow each progress step so a solve can be watched and cancelled. */
    setThrottle(ms: number): void {
      throttleMs = ms;
    },
  };
}

export const computeClient = createComputeClient(
  () => new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike,
);
