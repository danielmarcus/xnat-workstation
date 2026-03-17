import type { DiagnosticsLogEntry, DiagnosticsLogLevel, DiagnosticsLogStream } from '../../shared/types/diagnostics';
import { deidentifyText } from '../../shared/diagnostics/deidentify';

const MAX_LOG_ENTRIES = 600;
const stdoutLogs: DiagnosticsLogEntry[] = [];
const stderrLogs: DiagnosticsLogEntry[] = [];

let captureInstalled = false;
let stdoutBuffer = '';
let stderrBuffer = '';

function levelForStream(stream: DiagnosticsLogStream): DiagnosticsLogLevel {
  return stream === 'stderr' ? 'error' : 'info';
}

function targetForStream(stream: DiagnosticsLogStream): DiagnosticsLogEntry[] {
  return stream === 'stderr' ? stderrLogs : stdoutLogs;
}

function pushLog(stream: DiagnosticsLogStream, message: string): void {
  const sanitized = deidentifyText(message.trim());
  if (!sanitized) return;

  const target = targetForStream(stream);
  target.push({
    timestamp: new Date().toISOString(),
    source: 'main',
    stream,
    level: levelForStream(stream),
    message: sanitized,
  });
  if (target.length > MAX_LOG_ENTRIES) {
    target.splice(0, target.length - MAX_LOG_ENTRIES);
  }
}

function consumeChunk(stream: DiagnosticsLogStream, chunk: unknown): void {
  const text =
    typeof chunk === 'string'
      ? chunk
      : Buffer.isBuffer(chunk)
        ? chunk.toString('utf8')
        : String(chunk ?? '');
  if (!text) return;

  if (stream === 'stdout') {
    stdoutBuffer += text;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) pushLog('stdout', line);
    return;
  }

  stderrBuffer += text;
  const lines = stderrBuffer.split(/\r?\n/);
  stderrBuffer = lines.pop() ?? '';
  for (const line of lines) pushLog('stderr', line);
}

export function installMainLogCapture(): void {
  if (captureInstalled) return;
  captureInstalled = true;

  const stdout = process.stdout as NodeJS.WriteStream & {
    write: (chunk: unknown, encoding?: unknown, cb?: unknown) => boolean;
  };
  const stderr = process.stderr as NodeJS.WriteStream & {
    write: (chunk: unknown, encoding?: unknown, cb?: unknown) => boolean;
  };

  if (stdout?.write) {
    const originalWrite = stdout.write.bind(stdout);
    stdout.write = ((chunk: unknown, encoding?: unknown, cb?: unknown) => {
      consumeChunk('stdout', chunk);
      return originalWrite(chunk, encoding as any, cb as any);
    }) as typeof stdout.write;
  }

  if (stderr?.write) {
    const originalWrite = stderr.write.bind(stderr);
    stderr.write = ((chunk: unknown, encoding?: unknown, cb?: unknown) => {
      consumeChunk('stderr', chunk);
      return originalWrite(chunk, encoding as any, cb as any);
    }) as typeof stderr.write;
  }

  process.on('uncaughtException', (err) => {
    pushLog('stderr', `[uncaughtException] ${err?.stack || String(err)}`);
  });
  process.on('unhandledRejection', (reason) => {
    pushLog('stderr', `[unhandledRejection] ${reason instanceof Error ? reason.stack || reason.message : String(reason)}`);
  });
}

export function getMainLogSnapshot(limitPerStream = 200): {
  stdout: DiagnosticsLogEntry[];
  stderr: DiagnosticsLogEntry[];
} {
  if (stdoutBuffer.trim()) {
    pushLog('stdout', stdoutBuffer);
    stdoutBuffer = '';
  }
  if (stderrBuffer.trim()) {
    pushLog('stderr', stderrBuffer);
    stderrBuffer = '';
  }
  const stdout = stdoutLogs.slice(-Math.max(1, limitPerStream));
  const stderr = stderrLogs.slice(-Math.max(1, limitPerStream));
  return { stdout, stderr };
}
