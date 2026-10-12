/** The compute worker protocol and client (branch 4, C2). */
import { describe, expect, it, vi } from 'vitest';
import { handleComputeRequest, type ComputeRequest, type ComputeResponse } from '../protocol';
import { ComputeCancelled, createComputeClient, type WorkerLike } from '../computeClient';
import { randomWalker } from '../../segmentation/semiauto/randomWalker';

const W = 32;
const image = Float32Array.from({ length: W * W }, (_, i) => (Math.hypot((i % W) - 16, Math.floor(i / W) - 16) <= 8 ? 900 : 100));
const fg = Uint8Array.from({ length: W * W }, (_, i) => (Math.hypot((i % W) - 16, Math.floor(i / W) - 16) <= 1 ? 1 : 0));
const bg = Uint8Array.from({ length: W * W }, (_, i) => ((i % W) === 0 || (i % W) === W - 1 ? 1 : 0));
const input = { width: W, height: W, image, fg, bg, beta: 90 };

describe('handleComputeRequest', () => {
  it('runs Random Walker: progress, then the same result as a direct call, with its buffers transferred', () => {
    const posted: Array<{ msg: ComputeResponse; transfer?: Transferable[] }> = [];
    handleComputeRequest({ id: 7, name: 'randomWalker', input }, (msg, transfer) => posted.push({ msg, transfer }));
    const progress = posted.filter((p) => p.msg.type === 'progress');
    expect(progress.length).toBeGreaterThan(0);
    const fractions = progress.map((p) => (p.msg as { fraction: number }).fraction);
    expect(fractions.every((f) => f >= 0 && f < 1)).toBe(true);
    const last = posted[posted.length - 1];
    expect(last.msg.type).toBe('result');
    expect(last.msg.id).toBe(7);
    const out = (last.msg as { output: { mask: Uint8Array } }).output;
    expect(Array.from(out.mask)).toEqual(Array.from(randomWalker(input).mask));
    expect(last.transfer).toContain(out.mask.buffer);
  });

  it('an unknown algorithm is an error, not a hang', () => {
    const posted: ComputeResponse[] = [];
    handleComputeRequest({ id: 1, name: 'nope' as 'randomWalker', input }, (m) => posted.push(m));
    expect(posted).toEqual([{ id: 1, type: 'error', message: 'unknown algorithm: nope' }]);
  });
});

/** A worker that answers in-process, a tick later, as a real one would. */
function fakeWorkers() {
  const made: Array<WorkerLike & { terminated: boolean; requests: ComputeRequest[] }> = [];
  const make = () => {
    const w = {
      terminated: false,
      requests: [] as ComputeRequest[],
      onmessage: null as WorkerLike['onmessage'],
      onerror: null as WorkerLike['onerror'],
      postMessage(req: ComputeRequest) {
        w.requests.push(req);
        setTimeout(() => {
          if (w.terminated) return;
          handleComputeRequest(req, (msg) => w.onmessage?.({ data: msg } as MessageEvent<ComputeResponse>));
        }, 0);
      },
      terminate() { w.terminated = true; },
    };
    made.push(w);
    return w;
  };
  return { made, make };
}

describe('computeClient', () => {
  it('resolves with the result and forwards progress', async () => {
    const { make } = fakeWorkers();
    const client = createComputeClient(make);
    const onProgress = vi.fn();
    const out = await client.run('randomWalker', input, { onProgress }).result;
    expect(out.mask.some((v) => v)).toBe(true);
    expect(onProgress).toHaveBeenCalled();
  });

  it('cancel rejects with ComputeCancelled and terminates the worker; the next job gets a new one', async () => {
    const { made, make } = fakeWorkers();
    const client = createComputeClient(make);
    const job = client.run('randomWalker', input);
    job.cancel();
    await expect(job.result).rejects.toBeInstanceOf(ComputeCancelled);
    expect(made[0].terminated).toBe(true);
    await client.run('randomWalker', input).result;
    expect(made).toHaveLength(2);
  });

  it('starting a job cancels the one running', async () => {
    const { make } = fakeWorkers();
    const client = createComputeClient(make);
    const first = client.run('randomWalker', input);
    const second = client.run('randomWalker', input);
    await expect(first.result).rejects.toBeInstanceOf(ComputeCancelled);
    await expect(second.result).resolves.toBeTruthy();
  });

  it('jobs reuse one worker while none is cancelled', async () => {
    const { made, make } = fakeWorkers();
    const client = createComputeClient(make);
    await client.run('randomWalker', input).result;
    await client.run('randomWalker', input).result;
    expect(made).toHaveLength(1);
  });

  it('a worker crash rejects the job', async () => {
    const client = createComputeClient(() => {
      const w: WorkerLike = {
        onmessage: null, onerror: null, terminate() {},
        postMessage() { setTimeout(() => w.onerror?.({ message: 'boom' } as ErrorEvent), 0); },
      };
      return w;
    });
    await expect(client.run('randomWalker', input).result).rejects.toThrow('boom');
  });

  it('passes the throttle seam to the worker', async () => {
    const { made, make } = fakeWorkers();
    const client = createComputeClient(make);
    client.setThrottle(25);
    const job = client.run('randomWalker', input);
    job.cancel();
    await expect(job.result).rejects.toBeInstanceOf(ComputeCancelled);
    expect(made[0].requests[0].throttleMs).toBe(25);
  });
});
