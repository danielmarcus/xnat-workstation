/**
 * The compute worker's protocol (SegWorks parity branch 4, C2): the main thread asks for a
 * named algorithm on transferred buffers; the worker answers with progress messages, then a
 * result or an error. Cancelling is the client's business (it terminates the worker), so
 * the protocol has no cancel message — a solve in a tight loop could not read one anyway.
 *
 * `handleComputeRequest` is the worker's whole body, kept here so it runs in unit tests.
 */
import { randomWalker, type RandomWalkerInput, type RandomWalkerResult } from '../segmentation/semiauto/randomWalker';

export interface ComputeAlgorithms {
  randomWalker: { input: Omit<RandomWalkerInput, 'onProgress'>; output: RandomWalkerResult };
}
export type ComputeName = keyof ComputeAlgorithms;

export interface ComputeRequest<N extends ComputeName = ComputeName> {
  id: number;
  name: N;
  input: ComputeAlgorithms[N]['input'];
  /** Test seam: busy-wait this long at each progress report, so a solve is slow enough to cancel. */
  throttleMs?: number;
}

export type ComputeResponse =
  | { id: number; type: 'progress'; fraction: number }
  | { id: number; type: 'result'; output: unknown }
  | { id: number; type: 'error'; message: string };

type Post = (msg: ComputeResponse, transfer?: Transferable[]) => void;

const ALGORITHMS: { [N in ComputeName]: (input: ComputeAlgorithms[N]['input'], progress: (f: number) => void) => { output: ComputeAlgorithms[N]['output']; transfer: Transferable[] } } = {
  randomWalker: (input, progress) => {
    const output = randomWalker({ ...input, onProgress: progress });
    return { output, transfer: [output.probability.buffer, output.mask.buffer] };
  },
};

export function handleComputeRequest(req: ComputeRequest, post: Post): void {
  const run = ALGORITHMS[req.name] as ((input: unknown, progress: (f: number) => void) => { output: unknown; transfer: Transferable[] }) | undefined;
  if (!run) {
    post({ id: req.id, type: 'error', message: `unknown algorithm: ${String(req.name)}` });
    return;
  }
  const throttle = req.throttleMs ?? 0;
  try {
    const { output, transfer } = run(req.input, (fraction) => {
      post({ id: req.id, type: 'progress', fraction });
      if (throttle > 0) {
        const until = Date.now() + throttle;
        while (Date.now() < until) { /* deliberately blocking: this is the worker thread */ }
      }
    });
    post({ id: req.id, type: 'result', output }, transfer);
  } catch (e) {
    post({ id: req.id, type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}
