/**
 * Running a module (branch 9, M3): starts its sandboxed process, posts the input on the run's
 * message port, relays progress and log lines, and resolves with the module's result. The
 * process is destroyed at the end of every run.
 *
 * A run settles exactly once:
 *  - Cancel ends it AT ONCE as cancelled — a result the module returns afterwards is ignored
 *    (a synchronous module cannot even see `api.cancelled()` before it returns, and its late
 *    result used to be previewed, or committed). The module is asked to stop, and its process
 *    destroyed after a short grace.
 *  - The process ending any other way — a crash, the time limit, the app quitting, the page
 *    reloading — ends the run with the reason (the main process reports it); before, the run
 *    never settled and the operation stayed "Running…".
 */

export interface ModuleLogLine { level: 'info' | 'warn' | 'error'; text: string }

export interface ModuleRun<R> {
  result: Promise<R>;
  cancel: () => void;
}

export class ModuleRunCancelled extends Error {
  constructor() { super('cancelled'); this.name = 'ModuleRunCancelled'; }
}

const CANCEL_GRACE_MS = 2000;

// The main process sends a run's port before its runStart reply arrives, so ports are caught by
// one listener and kept by run id until asked for.
const arrived = new Map<string, MessagePort>();
const waiting = new Map<string, (p: MessagePort) => void>();
/** Runs in flight, by run id: how to end each when its process is reported gone. */
const ended = new Map<string, (reason: string) => void>();
let listening = false;
function listen(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== window) return;
    if (e.data?.type === 'xw-module-ended') {
      ended.get(String(e.data.runId))?.(String(e.data.reason ?? 'stopped'));
      return;
    }
    if (e.data?.type !== 'xw-module-port' || !e.ports[0]) return;
    const id = String(e.data.runId);
    const w = waiting.get(id);
    if (w) { waiting.delete(id); w(e.ports[0]); } else arrived.set(id, e.ports[0]);
  });
}
function portFor(runId: string): Promise<MessagePort> {
  const p = arrived.get(runId);
  if (p) { arrived.delete(runId); return Promise.resolve(p); }
  return new Promise((resolve) => waiting.set(runId, resolve));
}

export function runModule<R = Record<string, unknown>>(
  id: string,
  input: Record<string, unknown>,
  opts: { transfer?: Transferable[]; onProgress?: (fraction: number, text?: string) => void; onLog?: (line: ModuleLogLine) => void } = {},
): ModuleRun<R> {
  const api = window.electronAPI?.modules;
  let runId: string | null = null;
  let port: MessagePort | null = null;
  let settled = false;
  let reject: (e: Error) => void = () => {};
  let rejectCancelled: () => void = () => {};
  const stop = () => { if (runId) void api?.runStop(runId); };

  const done = () => { if (runId) ended.delete(runId); };
  const result = new Promise<R>((resolve, rej) => {
    rejectCancelled = () => rej(new ModuleRunCancelled());
    reject = (e) => { if (!settled) { settled = true; done(); stop(); rej(e); } };
    void (async () => {
      if (!api) return reject(new Error('Modules are available in the desktop app'));
      listen(); // before starting: the port can arrive before runStart's reply
      const started = await api.runStart(id);
      if (!started.ok) return reject(new Error(started.reason));
      runId = started.runId;
      if (settled) return stop();
      ended.set(runId, (reason) => reject(new Error(`The module stopped: ${reason}`)));
      port = await portFor(runId);
      if (settled) return;
      port.onmessage = (e) => {
        if (settled) return; // a cancelled or ended run hears nothing more
        const msg = e.data as { type: string; fraction?: number; text?: string; level?: ModuleLogLine['level']; result?: R };
        if (msg.type === 'ready') port!.postMessage({ type: 'run', input }, opts.transfer ?? []);
        else if (msg.type === 'progress') opts.onProgress?.(Math.max(0, Math.min(1, msg.fraction ?? 0)), msg.text);
        else if (msg.type === 'log') opts.onLog?.({ level: msg.level ?? 'info', text: msg.text ?? '' });
        else if (msg.type === 'failed') reject(new Error(msg.text ?? 'The module failed'));
        else if (msg.type === 'result' && !settled) { settled = true; done(); stop(); resolve(msg.result as R); }
      };
      port.start();
    })().catch((e: unknown) => reject(e instanceof Error ? e : new Error(String(e))));
  });

  return {
    result,
    cancel: () => {
      if (settled) return;
      // Settle now — nothing the module returns from here on counts — then ask it to stop and
      // give it a moment before its process is destroyed.
      settled = true;
      done();
      port?.postMessage({ type: 'cancel' });
      rejectCancelled();
      const id = runId;
      setTimeout(() => { if (id) void api?.runStop(id); }, port ? CANCEL_GRACE_MS : 0);
    },
  };
}
