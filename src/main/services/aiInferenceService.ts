/**
 * AI Inference Service — manages the llama-server child process lifecycle.
 *
 * Spawns llama-server (llama.cpp HTTP server) as a child process, monitors
 * its health via polling /health, and provides an OpenAI-compatible chat
 * completion interface for image analysis.
 *
 * Binary resolution order:
 *   1. Bundled binary in extraResources/llama-server/{platform}-{arch}/
 *   2. User-configured path from ai-config.json
 *   3. 'llama-server' on PATH
 *
 * All inference stays local — images never leave the device.
 */
import { spawn, ChildProcess } from 'child_process';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { app, BrowserWindow } from 'electron';
import { aiConfigStore } from './aiConfigStore';
import { IPC } from '../../shared/ipcChannels';
import type { AiServerStatus, AiModelConfig } from '../../shared/types/ai';

// ─── Constants ──────────────────────────────────────────────────

const HEALTH_POLL_INTERVAL_MS = 1500;
const HEALTH_POLL_TIMEOUT_MS = 60_000; // max wait for server to become ready
const MAX_RESTART_ATTEMPTS = 3;
const RESTART_BACKOFF_BASE_MS = 2000;
const REQUEST_TIMEOUT_MS = 600_000; // 10 minutes for slower hardware / CPU inference
const ABORT_GRACE_MS = 500;

// ─── Internal State ─────────────────────────────────────────────

let serverProcess: ChildProcess | null = null;
let currentStatus: AiServerStatus = 'stopped';
let currentError: string | undefined;
let restartCount = 0;
let healthPollTimer: ReturnType<typeof setInterval> | null = null;
let activeAbortController: AbortController | null = null;
let isShuttingDown = false;

// ─── Helpers ────────────────────────────────────────────────────

/** Push status update to renderer via main → renderer IPC. */
function pushStatus(status: AiServerStatus, error?: string): void {
  currentStatus = status;
  currentError = error;

  const update = { status, error };
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send(IPC.AI_STATUS_UPDATE, update);
    } catch {
      // Window may be destroyed
    }
  }
}

/** Resolve the llama-server binary path. */
function resolveBinaryPath(config: AiModelConfig): string | null {
  // 1. Bundled binary in extraResources
  const platformArch = `${process.platform}-${process.arch}`;
  const ext = process.platform === 'win32' ? '.exe' : '';
  const bundledName = `llama-server${ext}`;

  const bundledPaths = [
    // Production: resources/llama-server/{platform}-{arch}/llama-server
    path.join(process.resourcesPath, 'llama-server', platformArch, bundledName),
    // Dev: project root/extraResources/llama-server/{platform}-{arch}/llama-server
    path.join(app.getAppPath(), 'extraResources', 'llama-server', platformArch, bundledName),
  ];

  for (const p of bundledPaths) {
    if (fs.existsSync(p)) {
      console.log('[aiInferenceService] Found bundled binary:', p);
      return p;
    }
  }

  // 2. User-configured path
  if (config.llamaServerPath && fs.existsSync(config.llamaServerPath)) {
    console.log('[aiInferenceService] Using configured binary:', config.llamaServerPath);
    return config.llamaServerPath;
  }

  // 3. Fall back to PATH (will be resolved by child_process.spawn)
  console.log('[aiInferenceService] Falling back to llama-server on PATH');
  return 'llama-server';
}

/** Build CLI arguments for llama-server. */
function buildArgs(config: AiModelConfig): string[] {
  const args = [
    '--model', config.modelPath,
    '--host', '127.0.0.1',
    '--port', String(config.port),
    '--ctx-size', String(config.contextSize),
    '--n-gpu-layers', String(config.gpuLayers),
    '--parallel', '1',       // single analysis at a time — maximize per-request context
    '--n-predict', '1024',   // safety cap matching HTTP max_tokens
  ];

  // Flash attention requires GPU — only enable when offloading layers
  if (config.gpuLayers > 0) {
    args.push('--flash-attn', 'on');
  }

  // LLaVA-Med requires the multimodal projector
  if (config.backend === 'llava-med' && config.mmProjPath) {
    args.push('--mmproj', config.mmProjPath);
  }

  return args;
}

/** HTTP GET /health check against the local llama-server. */
function checkHealth(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      `http://127.0.0.1:${port}/health`,
      { timeout: 3000 },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          try {
            const json = JSON.parse(data) as { status?: string };
            resolve(json.status === 'ok');
          } catch {
            // Some versions return plain text
            resolve(res.statusCode === 200);
          }
        });
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/** Wait for server to become healthy, polling at intervals. */
function waitForHealthy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const poll = async (): Promise<void> => {
      if (currentStatus === 'stopped' || isShuttingDown) {
        resolve(false);
        return;
      }

      const healthy = await checkHealth(port);
      if (healthy) {
        resolve(true);
        return;
      }

      if (Date.now() - startTime > HEALTH_POLL_TIMEOUT_MS) {
        resolve(false);
        return;
      }

      setTimeout(poll, HEALTH_POLL_INTERVAL_MS);
    };

    poll();
  });
}

/** Start periodic health monitoring once server is ready. */
function startHealthMonitor(port: number): void {
  stopHealthMonitor();
  healthPollTimer = setInterval(async () => {
    if (currentStatus !== 'ready') return;

    const healthy = await checkHealth(port);
    if (!healthy && currentStatus === 'ready' && !isShuttingDown) {
      console.warn('[aiInferenceService] Health check failed, server may have crashed');
      handleServerCrash();
    }
  }, HEALTH_POLL_INTERVAL_MS * 4); // Less frequent once running
}

function stopHealthMonitor(): void {
  if (healthPollTimer) {
    clearInterval(healthPollTimer);
    healthPollTimer = null;
  }
}

/** Handle unexpected server exit. */
function handleServerCrash(): void {
  stopHealthMonitor();
  serverProcess = null;

  if (isShuttingDown) {
    pushStatus('stopped');
    return;
  }

  if (restartCount < MAX_RESTART_ATTEMPTS) {
    restartCount++;
    const delay = RESTART_BACKOFF_BASE_MS * Math.pow(2, restartCount - 1);
    console.log(`[aiInferenceService] Auto-restart attempt ${restartCount}/${MAX_RESTART_ATTEMPTS} in ${delay}ms`);
    pushStatus('starting', `Restarting (attempt ${restartCount}/${MAX_RESTART_ATTEMPTS})...`);
    setTimeout(() => {
      aiInferenceService.start().catch((err) => {
        console.error('[aiInferenceService] Auto-restart failed:', err);
      });
    }, delay);
  } else {
    pushStatus('error', 'Server crashed repeatedly. Please check model files and restart manually.');
  }
}

// ─── HTTP Request Helper ────────────────────────────────────────

/** Image entry for llama-server /completion endpoint. */
interface ImageDataEntry {
  data: string;  // raw base64 (no data:image prefix)
  id: number;    // matches [img-N] placeholder in prompt
}

/** Response shape from llama-server /completion endpoint. */
interface CompletionResponse {
  content: string;
  stop: boolean;
  model?: string;
  tokens_predicted?: number;
  tokens_evaluated?: number;
}

/**
 * Send a completion request to the local llama-server using the /completion endpoint.
 *
 * Unlike /v1/chat/completions, the /completion endpoint gives us full control
 * over the prompt format. This is critical for LLaVA-Med because the chat
 * completions endpoint doesn't apply the Mistral [INST] template correctly
 * for multimodal content (logs show "Chat format: Content-only").
 *
 * The prompt must include [img-N] placeholders that match the image_data ids.
 */
function completionRequest(
  port: number,
  prompt: string,
  imageData: ImageDataEntry[],
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const requestBody: Record<string, any> = {
      prompt,
      temperature: 0.2,
      n_predict: 1024,
      repeat_penalty: 1.1,
      repeat_last_n: 128,
      stop: ['</s>', '[INST]'],  // Stop at end-of-sequence or next instruction
    };

    // Attach images if present
    if (imageData.length > 0) {
      requestBody.image_data = imageData;
    }

    const body = JSON.stringify(requestBody);

    console.log(`[aiInferenceService] POST /completion — prompt ${prompt.length} chars, ${imageData.length} image(s), body ${body.length} bytes`);

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/completion',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`llama-server returned HTTP ${res.statusCode}: ${data.slice(0, 500)}`));
            return;
          }
          try {
            const json = JSON.parse(data) as CompletionResponse;
            const content = json.content;
            if (!content) {
              reject(new Error('Empty response from llama-server'));
              return;
            }
            console.log(
              `[aiInferenceService] Response: ${content.length} chars, ` +
              `predicted=${json.tokens_predicted}, evaluated=${json.tokens_evaluated}, ` +
              `starts: ${content.slice(0, 200).replace(/\n/g, ' ')}...`,
            );
            resolve(content);
          } catch (err) {
            reject(new Error(`Failed to parse llama-server response: ${data.slice(0, 500)}`));
          }
        });
      },
    );

    req.on('error', (err) => {
      reject(new Error(`llama-server request failed: ${err.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`llama-server request timed out (${REQUEST_TIMEOUT_MS / 1000}s)`));
    });

    // Abort support
    if (signal) {
      const onAbort = (): void => {
        req.destroy();
        reject(new Error('Analysis cancelled'));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    req.write(body);
    req.end();
  });
}

// ─── Public API ─────────────────────────────────────────────────

export const aiInferenceService = {
  /** Start the llama-server child process. */
  async start(): Promise<void> {
    if (serverProcess) {
      console.log('[aiInferenceService] Server already running');
      return;
    }

    const config = aiConfigStore.load();

    // Auto-resolve model paths from models dir if not explicitly configured
    const modelsDir = aiConfigStore.getModelsDir();
    if (!config.modelPath) {
      const defaultModel = path.join(modelsDir, 'llava-med-v1.5-mistral-7b.Q4_K_M.gguf');
      if (fs.existsSync(defaultModel)) {
        config.modelPath = defaultModel;
        console.log('[aiInferenceService] Auto-resolved model path:', defaultModel);
      }
    }
    if (!config.mmProjPath) {
      const defaultMmproj = path.join(modelsDir, 'mmproj-model-f16.gguf');
      if (fs.existsSync(defaultMmproj)) {
        config.mmProjPath = defaultMmproj;
        console.log('[aiInferenceService] Auto-resolved mmproj path:', defaultMmproj);
      }
    }

    // Validate model files exist
    if (!config.modelPath || !fs.existsSync(config.modelPath)) {
      pushStatus('model-missing', 'Model file not found. Please configure the model path in settings.');
      return;
    }

    if (config.backend === 'llava-med' && config.mmProjPath && !fs.existsSync(config.mmProjPath)) {
      pushStatus('model-missing', 'Multimodal projector file not found. Please configure the mmproj path in settings.');
      return;
    }

    const binaryPath = resolveBinaryPath(config);
    if (!binaryPath) {
      pushStatus('error', 'llama-server binary not found. Please install llama.cpp or configure the path.');
      return;
    }

    const args = buildArgs(config);
    console.log('[aiInferenceService] Starting:', binaryPath, args.join(' '));
    pushStatus('starting');

    try {
      serverProcess = spawn(binaryPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      // Log stdout/stderr
      serverProcess.stdout?.on('data', (data: Buffer) => {
        const line = data.toString().trim();
        if (line) console.log('[llama-server]', line);
      });

      const stderrLines: string[] = [];
      serverProcess.stderr?.on('data', (data: Buffer) => {
        const line = data.toString().trim();
        if (line) {
          console.log('[llama-server:err]', line);
          stderrLines.push(line);
          if (stderrLines.length > 20) stderrLines.shift(); // keep last 20
        }
      });

      serverProcess.on('error', (err) => {
        console.error('[aiInferenceService] Failed to spawn llama-server:', err.message);
        serverProcess = null;

        if (err.message.includes('ENOENT')) {
          pushStatus('error', 'llama-server binary not found. Please install llama.cpp or configure the path in settings.');
        } else if (err.message.includes('EACCES')) {
          pushStatus('error', 'llama-server binary is not executable. Check file permissions.');
        } else {
          pushStatus('error', `Failed to start server: ${err.message}`);
        }
      });

      serverProcess.on('exit', (code, signal) => {
        console.log(`[aiInferenceService] llama-server exited (code=${code}, signal=${signal})`);
        const wasRunning = currentStatus === 'ready';
        serverProcess = null;

        if (isShuttingDown || currentStatus === 'stopped') {
          pushStatus('stopped');
          return;
        }

        if (wasRunning) {
          handleServerCrash();
        } else if (signal) {
          // Process was killed by a signal during startup
          const hint = signal === 'SIGKILL' ? ' (out of memory — try reducing context size or using GPU offloading)'
                     : signal === 'SIGSEGV' ? ' (segmentation fault — check model file integrity)'
                     : '';
          const stderrTail = stderrLines.slice(-5).join('\n');
          const detail = stderrTail ? `\n${stderrTail}` : '';
          pushStatus('error', `Server killed by ${signal}${hint}${detail}`);
        } else if (code !== null && code !== 0) {
          // Failed during startup with an exit code
          const stderrTail = stderrLines.slice(-5).join('\n');
          const stderrAll = stderrLines.join('\n');
          const detail = stderrTail ? `\n${stderrTail}` : '';

          // Check stderr for actual port conflict evidence (not just exit code)
          const portConflict = /address already in use|EADDRINUSE|bind failed/i.test(stderrAll);
          if (portConflict) {
            pushStatus('error', `Port ${config.port} is already in use. Change the port in settings.`);
          } else {
            pushStatus('error', `Server exited with code ${code}.${detail}`);
          }
        }
      });

      // Wait for health endpoint
      const healthy = await waitForHealthy(config.port);
      if (healthy) {
        restartCount = 0; // Reset on successful start
        pushStatus('ready');
        startHealthMonitor(config.port);
        console.log('[aiInferenceService] Server ready on port', config.port);
      } else if (currentStatus !== 'error' && currentStatus !== 'stopped') {
        pushStatus('error', 'Server failed to become ready within 60 seconds. Check model files and logs.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[aiInferenceService] start() error:', msg);
      pushStatus('error', msg);
    }
  },

  /** Stop the llama-server child process. */
  async stop(): Promise<void> {
    isShuttingDown = true;
    stopHealthMonitor();

    // Cancel any in-flight analysis
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }

    if (serverProcess) {
      console.log('[aiInferenceService] Stopping server...');
      const proc = serverProcess;
      serverProcess = null;

      // Try graceful SIGTERM first
      proc.kill('SIGTERM');

      // Force kill after grace period
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          try {
            proc.kill('SIGKILL');
          } catch {
            // Already dead
          }
          resolve();
        }, ABORT_GRACE_MS);

        proc.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }

    pushStatus('stopped');
    restartCount = 0;
    isShuttingDown = false;
    console.log('[aiInferenceService] Server stopped');
  },

  /** Get current server status. */
  getStatus(): { status: AiServerStatus; error?: string } {
    return { status: currentStatus, error: currentError };
  },

  /**
   * Send a completion request to the running server.
   * Uses the /completion endpoint with a pre-formatted prompt and image data.
   */
  async completion(
    prompt: string,
    imageData: ImageDataEntry[],
  ): Promise<string> {
    if (currentStatus !== 'ready') {
      throw new Error('Server is not ready. Current status: ' + currentStatus);
    }

    const config = aiConfigStore.load();
    activeAbortController = new AbortController();

    try {
      const result = await completionRequest(
        config.port,
        prompt,
        imageData,
        activeAbortController.signal,
      );
      return result;
    } finally {
      activeAbortController = null;
    }
  },

  /** Cancel an in-flight analysis request. */
  cancel(): void {
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
      console.log('[aiInferenceService] Analysis cancelled');
    }
  },

  /** Check if the server process is running. */
  isRunning(): boolean {
    return serverProcess !== null && currentStatus === 'ready';
  },
};
