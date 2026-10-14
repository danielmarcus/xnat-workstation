/**
 * Running a module (branch 9, M3): starts its sandboxed process, posts the input on the run's
 * message port, relays progress and log lines, and resolves with the module's result. Cancel asks
 * the module to stop (its `api.cancelled()` turns true) and, after a short grace, destroys the
 * process. The process is destroyed at the end of every run.
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
let listening = false;
function listen(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== window || e.data?.type !== 'xw-module-port' || !e.ports[0]) return;
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
  const stop = () => { if (runId) void api?.runStop(runId); };

  const result = new Promise<R>((resolve, rej) => {
    reject = (e) => { if (!settled) { settled = true; stop(); rej(e); } };
    void (async () => {
      if (!api) return reject(new Error('Modules are available in the desktop app'));
      listen(); // before starting: the port can arrive before runStart's reply
      const started = await api.runStart(id);
      if (!started.ok) return reject(new Error(started.reason));
      runId = started.runId;
      if (settled) return stop();
      port = await portFor(runId);
      port.onmessage = (e) => {
        const msg = e.data as { type: string; fraction?: number; text?: string; level?: ModuleLogLine['level']; result?: R };
        if (msg.type === 'ready') port!.postMessage({ type: 'run', input }, opts.transfer ?? []);
        else if (msg.type === 'progress') opts.onProgress?.(Math.max(0, Math.min(1, msg.fraction ?? 0)), msg.text);
        else if (msg.type === 'log') opts.onLog?.({ level: msg.level ?? 'info', text: msg.text ?? '' });
        else if (msg.type === 'failed') reject(new Error(msg.text ?? 'The module failed'));
        else if (msg.type === 'result' && !settled) { settled = true; stop(); resolve(msg.result as R); }
      };
      port.start();
    })();
  });

  return {
    result,
    cancel: () => {
      if (settled) return;
      port?.postMessage({ type: 'cancel' });
      setTimeout(() => reject(new ModuleRunCancelled()), port ? CANCEL_GRACE_MS : 0);
    },
  };
}
