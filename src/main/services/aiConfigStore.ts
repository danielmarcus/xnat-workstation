/**
 * AI Config Store — JSON file persistence for AI model configuration.
 *
 * Stores configuration in {userData}/ai-config.json with atomic writes
 * (write to temp, rename). Provides sensible defaults on first run.
 *
 * This avoids adding SQLite or any new dependency — plain JSON with
 * Node built-ins is sufficient for the small config payload.
 */
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import type { AiModelConfig } from '../../shared/types/ai';

// ─── Defaults ────────────────────────────────────────────────────

const DEFAULT_CONFIG: AiModelConfig = {
  backend: 'llava-med',
  llamaServerPath: '',
  modelPath: '',
  mmProjPath: '',
  gpuLayers: 999,  // offload all layers to GPU (Metal on macOS, CUDA on Linux/Windows)
  contextSize: 4096,
  port: 8800,
  selectedPresetId: '',
};

// ─── Internal State ──────────────────────────────────────────────

let cachedConfig: AiModelConfig | null = null;

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'ai-config.json');
}

// ─── Public API ──────────────────────────────────────────────────

export const aiConfigStore = {
  /** Load config from disk, falling back to defaults for missing fields. */
  load(): AiModelConfig {
    if (cachedConfig) return { ...cachedConfig } as AiModelConfig;

    const configPath = getConfigPath();
    try {
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<AiModelConfig>;
        cachedConfig = { ...DEFAULT_CONFIG, ...parsed };
        console.log('[aiConfigStore] Loaded config from', configPath);
      } else {
        cachedConfig = { ...DEFAULT_CONFIG };
        console.log('[aiConfigStore] No config file found, using defaults');
      }
    } catch (err) {
      console.error('[aiConfigStore] Failed to load config, using defaults:', err);
      cachedConfig = { ...DEFAULT_CONFIG };
    }

    return { ...cachedConfig } as AiModelConfig;
  },

  /** Save partial config updates. Merges with existing config and writes atomically. */
  save(partial: Partial<AiModelConfig>): void {
    const current = this.load();
    cachedConfig = { ...current, ...partial };

    const configPath = getConfigPath();
    const tmpPath = configPath + '.tmp';

    try {
      fs.writeFileSync(tmpPath, JSON.stringify(cachedConfig, null, 2), 'utf-8');
      fs.renameSync(tmpPath, configPath);
      console.log('[aiConfigStore] Config saved');
    } catch (err) {
      console.error('[aiConfigStore] Failed to save config:', err);
      // Clean up temp file if rename failed
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  },

  /** Get the default models directory path. */
  getModelsDir(): string {
    return path.join(app.getPath('userData'), 'models');
  },

  /** Reset config to defaults. */
  reset(): void {
    cachedConfig = { ...DEFAULT_CONFIG };
    this.save(cachedConfig);
    console.log('[aiConfigStore] Config reset to defaults');
  },
};
