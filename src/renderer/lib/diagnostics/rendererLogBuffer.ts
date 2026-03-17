import type { DiagnosticsLogEntry, DiagnosticsLogLevel, DiagnosticsLogStream } from '@shared/types/diagnostics';
import { deidentifyText } from '@shared/diagnostics/deidentify';

const MAX_LOG_ENTRIES = 500;
const logs: DiagnosticsLogEntry[] = [];
const INSTALL_MARKER = '__xnatRendererLogCaptureInstalled__';

function streamForLevel(level: DiagnosticsLogLevel): DiagnosticsLogStream {
  return level === 'warn' || level === 'error' ? 'stderr' : 'stdout';
}

function stringifyArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack || arg.message;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function pushLog(level: DiagnosticsLogLevel, args: unknown[]): void {
  const message = deidentifyText(args.map((arg) => stringifyArg(arg)).join(' ')).trim();
  if (!message) return;
  logs.push({
    timestamp: new Date().toISOString(),
    source: 'renderer',
    level,
    stream: streamForLevel(level),
    message,
  });
  if (logs.length > MAX_LOG_ENTRIES) {
    logs.splice(0, logs.length - MAX_LOG_ENTRIES);
  }
}

export function installRendererLogCapture(): void {
  if (typeof window === 'undefined') return;
  if ((window as any)[INSTALL_MARKER]) return;
  (window as any)[INSTALL_MARKER] = true;

  const original = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  console.log = (...args: unknown[]) => {
    pushLog('log', args);
    original.log(...args);
  };
  console.info = (...args: unknown[]) => {
    pushLog('info', args);
    original.info(...args);
  };
  console.warn = (...args: unknown[]) => {
    pushLog('warn', args);
    original.warn(...args);
  };
  console.error = (...args: unknown[]) => {
    pushLog('error', args);
    original.error(...args);
  };

  window.addEventListener('error', (event) => {
    pushLog('error', [
      '[window.error]',
      event.message,
      event.filename,
      `line=${event.lineno}`,
      `col=${event.colno}`,
    ]);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error ? event.reason.stack || event.reason.message : String(event.reason);
    pushLog('error', ['[unhandledrejection]', reason]);
  });
}

export function getRendererLogEntries(limit = 200): DiagnosticsLogEntry[] {
  return logs.slice(-Math.max(1, limit));
}
