/**
 * AI IPC Handlers — registers all AI-related IPC channels.
 *
 * Handles server lifecycle (start, stop, status), configuration management,
 * image analysis requests, model file checks, and utility actions
 * (browse file, open models directory).
 */
import { ipcMain, dialog, shell, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import { IPC } from '../../shared/ipcChannels';
import { aiConfigStore } from '../services/aiConfigStore';
import { aiInferenceService } from '../services/aiInferenceService';
import { buildPrompt, extractImageData } from '../services/promptTemplates';
import type {
  AiAnalysisRequest,
  AiAnalysisResult,
  AiFinding,
  AiFindingSeverity,
  AiFindingCategory,
  ModelFileStatus,
  ModelPreset,
} from '../../shared/types/ai';

// ─── Helpers ────────────────────────────────────────────────────

/** Generate a simple UUID v4. */
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Valid severity values. */
const VALID_SEVERITIES: AiFindingSeverity[] = ['normal', 'mild', 'moderate', 'severe'];
const VALID_CATEGORIES: AiFindingCategory[] = [
  'airspace', 'vascular', 'cardiac', 'skeletal', 'soft_tissue', 'device', 'other',
];

// ─── Keyword-based Severity & Category Inference ──────────────

/** Patterns checked top-down (most severe first). First match wins. */
const SEVERITY_PATTERNS: Array<{ severity: AiFindingSeverity; patterns: RegExp[] }> = [
  {
    severity: 'severe',
    patterns: [
      /\bsevere\b/i,
      /\bcritical\b/i,
      /\bemergent\b/i,
      /\btension\s+pneumothorax\b/i,
      /\bmassive\b/i,
      /\bcomplete\s+(collapse|occlusion|obstruction)\b/i,
      /\bdisplaced\s+fracture\b/i,
      /\blarge\s+(pleural\s+)?effusion\b/i,
      /\bpulmonary\s+embolism\b/i,
      /\baortic\s+dissection\b/i,
      /\bwidened\s+mediastinum\b/i,
    ],
  },
  {
    severity: 'moderate',
    patterns: [
      /\bmoderate\b/i,
      /\bsignificant\b/i,
      /\bextensive\b/i,
      /\blarge\b/i,
      /\bconsolidation\b/i,
      /\beffusion\b/i,
      /\bpneumothorax\b/i,
      /\bmass\b/i,
      /\bnodule\b/i,
      /\bfracture\b/i,
      /\bcardiomegaly\b/i,
      /\bedema\b/i,
      /\bopacity\b/i,
      /\bopacities\b/i,
      /\binfiltrate\b/i,
      /\batelectasis\b/i,
      /\babnormal\b/i,
    ],
  },
  {
    severity: 'mild',
    patterns: [
      /\bmild\b/i,
      /\bsmall\b/i,
      /\bminimal\b/i,
      /\bsubtle\b/i,
      /\btrace\b/i,
      /\bminor\b/i,
      /\btiny\b/i,
      /\bfaint\b/i,
      /\bslight\b/i,
      /\bdegenerative\b/i,
      /\bblunting\b/i,
    ],
  },
];

/** Keywords that indicate a normal/negative finding, checked before severity patterns. */
const NORMAL_PATTERNS: RegExp[] = [
  /\bnormal\b/i,
  /\bunremarkable\b/i,
  /\bno\s+acute\b/i,
  /\bwithin\s+normal\s+limits\b/i,
  /\bclear\s+lungs?\b/i,
  /\bno\s+(significant|notable|definite)\b/i,
  /\bno\s+(evidence|findings?)\b/i,
  /\bnegative\b/i,
  /\bstable\b/i,
  /\bintact\b/i,
  /\bpreserved\b/i,
];

/**
 * Infer severity from free-text finding description using keyword matching.
 * Normal patterns are checked first (trumps severity keywords in the same sentence,
 * e.g. "no evidence of fracture" → normal, not moderate).
 */
function inferSeverity(text: string): AiFindingSeverity {
  // Check for negation / normal patterns first
  for (const pat of NORMAL_PATTERNS) {
    if (pat.test(text)) return 'normal';
  }

  // Check severity patterns top-down (severe → moderate → mild)
  for (const { severity, patterns } of SEVERITY_PATTERNS) {
    for (const pat of patterns) {
      if (pat.test(text)) return severity;
    }
  }

  return 'normal';
}

/** Category keyword patterns. First match wins. */
const CATEGORY_PATTERNS: Array<{ category: AiFindingCategory; patterns: RegExp[] }> = [
  {
    category: 'airspace',
    patterns: [
      /\bconsolidation\b/i, /\bopacity\b/i, /\bopacities\b/i, /\binfiltrate\b/i,
      /\batelectasis\b/i, /\bpneumonia\b/i, /\bpneumothorax\b/i,
      /\blung\b/i, /\bpulmonary\b/i, /\bpleural\b/i, /\bairspace\b/i,
      /\beffusion\b/i, /\bedema\b/i,
    ],
  },
  {
    category: 'cardiac',
    patterns: [
      /\bcardiac\b/i, /\bheart\b/i, /\bcardiomegaly\b/i, /\bpericardi/i,
      /\bventricular\b/i, /\batrial\b/i, /\bvalv/i,
    ],
  },
  {
    category: 'vascular',
    patterns: [
      /\bvascular\b/i, /\baort/i, /\bartery\b/i, /\barterial\b/i,
      /\bvenous\b/i, /\bembolism\b/i, /\bthromb/i, /\baneurysm\b/i,
      /\bmediastin/i, /\bhilum\b/i, /\bhilar\b/i,
    ],
  },
  {
    category: 'skeletal',
    patterns: [
      /\bfracture\b/i, /\bbone\b/i, /\bosseous\b/i, /\bskeletal\b/i,
      /\brib\b/i, /\bspine\b/i, /\bvertebr/i, /\bdegenerative\b/i,
      /\bjoint\b/i, /\barthritis\b/i, /\bsclerotic\b/i, /\blytic\b/i,
    ],
  },
  {
    category: 'soft_tissue',
    patterns: [
      /\bsoft\s+tissue\b/i, /\bsubcutaneous\b/i, /\bmass\b/i, /\bnodule\b/i,
      /\blymph\b/i, /\bswelling\b/i, /\bthyroid\b/i,
    ],
  },
  {
    category: 'device',
    patterns: [
      /\bdevice\b/i, /\bcatheter\b/i, /\btube\b/i, /\bpacemaker\b/i,
      /\bstent\b/i, /\bwire\b/i, /\bhardware\b/i, /\bimplant\b/i,
      /\bline\b/i, /\bport\b/i, /\bICD\b/, /\bAICD\b/,
    ],
  },
];

/**
 * Infer anatomical/pathological category from free-text finding description.
 */
function inferCategory(text: string): AiFindingCategory {
  for (const { category, patterns } of CATEGORY_PATTERNS) {
    for (const pat of patterns) {
      if (pat.test(text)) return category;
    }
  }
  return 'other';
}

/**
 * Wrap a free-text model response into the expected findings structure.
 * Used as a fallback when the model doesn't produce valid JSON.
 */
function parseFreeTextResponse(raw: string): {
  findings: AiFinding[];
  impression: string;
  limitations: string[];
  rawOutput: string;
} {
  const text = raw.trim();

  // Split into sentences/paragraphs for individual findings
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 10);

  const findings: AiFinding[] = sentences.length > 0
    ? sentences.slice(0, 10).map((sentence) => ({
        id: uuid(),
        description: sentence,
        location: 'See report',
        severity: inferSeverity(sentence),
        confidence: 0.5,
        category: inferCategory(sentence),
        status: 'pending' as const,
      }))
    : [{
        id: uuid(),
        description: text.slice(0, 500) || 'Model produced unstructured output',
        location: 'See report',
        severity: inferSeverity(text),
        confidence: 0.5,
        category: inferCategory(text),
        status: 'pending' as const,
      }];

  return {
    findings,
    impression: text.slice(0, 500),
    limitations: [
      'AI-assisted preliminary read — not a clinical diagnosis',
      'Free-text response — structured parsing unavailable',
    ],
    rawOutput: raw,
  };
}

/**
 * Parse and validate the JSON response from the model.
 * Handles common LLM output quirks: markdown fences, extra text, etc.
 * Falls back to free-text extraction if no valid JSON is found.
 */
function parseModelResponse(raw: string): {
  findings: AiFinding[];
  impression: string;
  limitations: string[];
  rawOutput: string;
} {
  console.log(`[aiHandlers] Raw model response (${raw.length} chars): ${raw.slice(0, 300)}...`);

  let jsonStr = raw.trim();

  // Strip markdown code fences
  jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

  // Find the first { and last } to extract JSON object
  const firstBrace = jsonStr.indexOf('{');
  const lastBrace = jsonStr.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    console.log('[aiHandlers] No JSON braces found in response, using free-text extraction');
    return parseFreeTextResponse(raw);
  }

  jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    console.log(`[aiHandlers] JSON parse failed: ${(err as Error).message}, using free-text extraction`);
    return parseFreeTextResponse(raw);
  }

  // Validate and normalize findings
  const rawFindings = Array.isArray(parsed.findings) ? parsed.findings : [];

  // If parsed JSON has no findings array, treat as free-text
  if (rawFindings.length === 0 && !parsed.impression) {
    console.log('[aiHandlers] Parsed JSON has no findings or impression, using free-text extraction');
    return parseFreeTextResponse(raw);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const findings: AiFinding[] = rawFindings.map((f: any) => {
    const desc = String(f.description || 'Unspecified finding');
    return {
      id: uuid(),
      description: desc,
      location: String(f.location || 'Unspecified'),
      severity: VALID_SEVERITIES.includes(f.severity) ? f.severity : inferSeverity(desc),
      confidence: Math.max(0, Math.min(1, Number(f.confidence) || 0.5)),
      category: VALID_CATEGORIES.includes(f.category) ? f.category : inferCategory(desc),
      status: 'pending' as const,
    };
  });

  const impression = String(parsed.impression || 'No impression provided');
  const limitations = Array.isArray(parsed.limitations)
    ? parsed.limitations.map(String)
    : ['AI-assisted preliminary read — not a clinical diagnosis'];

  console.log(`[aiHandlers] Parsed ${findings.length} findings from JSON response`);
  return { findings, impression, limitations, rawOutput: raw };
}

// ─── Expected Model Files ───────────────────────────────────────

const LLAVA_MED_FILES = [
  {
    filename: 'llava-med-v1.5-mistral-7b.Q4_K_M.gguf',
    role: 'model' as const,
    expectedSizeMB: 4370,
    downloadUrl: 'https://huggingface.co/mradermacher/llava-med-v1.5-mistral-7b-GGUF/resolve/main/llava-med-v1.5-mistral-7b.Q4_K_M.gguf',
    description: 'LLaVA-Med 7B language model (Q4_K_M quantization)',
  },
  {
    filename: 'mmproj-model-f16.gguf',
    role: 'mmproj' as const,
    expectedSizeMB: 624,
    downloadUrl: 'https://huggingface.co/mradermacher/llava-med-v1.5-mistral-7b-GGUF/resolve/main/mmproj-model-f16.gguf',
    description: 'Multimodal projector for vision-language alignment',
  },
];

// ─── Known Model Presets (for dropdown selector) ────────────────

const KNOWN_PRESETS: Array<Omit<ModelPreset, 'isComplete'>> = [
  {
    id: 'llava-med-7b-q4km',
    displayName: 'LLaVA-Med 7B (Q4_K_M)',
    backend: 'llava-med',
    modelFilename: 'llava-med-v1.5-mistral-7b.Q4_K_M.gguf',
    mmProjFilename: 'mmproj-model-f16.gguf',
    totalSizeMB: 4994,
  },
];

// ─── Handler Registration ───────────────────────────────────────

export function registerAiHandlers(): void {
  console.log('[ipc] AI handlers registered');

  // ─── Get Config ───────────────────────────────────────────
  ipcMain.handle(IPC.AI_GET_CONFIG, () => {
    return aiConfigStore.load();
  });

  // ─── Set Config ───────────────────────────────────────────
  ipcMain.handle(
    IPC.AI_SET_CONFIG,
    async (_event, partial: Record<string, unknown>) => {
      try {
        aiConfigStore.save(partial);
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[aiHandlers] setConfig error:', msg);
        return { ok: false, error: msg };
      }
    },
  );

  // ─── Start Server ─────────────────────────────────────────
  ipcMain.handle(IPC.AI_START_SERVER, async () => {
    try {
      await aiInferenceService.start();
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[aiHandlers] startServer error:', msg);
      return { ok: false, error: msg };
    }
  });

  // ─── Stop Server ──────────────────────────────────────────
  ipcMain.handle(IPC.AI_STOP_SERVER, async () => {
    try {
      await aiInferenceService.stop();
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[aiHandlers] stopServer error:', msg);
      return { ok: false, error: msg };
    }
  });

  // ─── Get Status ───────────────────────────────────────────
  ipcMain.handle(IPC.AI_GET_STATUS, () => {
    return aiInferenceService.getStatus();
  });

  // ─── Analyze Image ────────────────────────────────────────
  ipcMain.handle(
    IPC.AI_ANALYZE_IMAGE,
    async (_event, request: AiAnalysisRequest) => {
      const startTime = Date.now();

      try {
        // Build prompt with Mistral [INST] template and extract image data
        const prompt = buildPrompt(request);
        const imageData = extractImageData(request);

        console.log(`[aiHandlers] Prompt: ${prompt.slice(0, 200)}...`);
        console.log(`[aiHandlers] Image data: ${imageData.length} image(s), first ${Math.round(imageData[0]?.data.length / 1024)}KB base64`);

        // Send to llama-server /completion endpoint
        const rawResponse = await aiInferenceService.completion(prompt, imageData);

        // Parse structured response
        const { findings, impression, limitations, rawOutput } = parseModelResponse(rawResponse);

        const config = aiConfigStore.load();

        const result: AiAnalysisResult = {
          findings,
          impression,
          limitations,
          modelBackend: config.backend,
          timestamp: Date.now(),
          modality: request.modality,
          processingTimeMs: Date.now() - startTime,
          rawOutput: findings.length === 0 ? rawOutput : undefined, // Include raw on parse issues
        };

        console.log(
          `[aiHandlers] Analysis complete: ${findings.length} findings in ${result.processingTimeMs}ms`,
        );

        return { ok: true, result };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[aiHandlers] analyzeImage error:', msg);
        return {
          ok: false,
          error: msg,
          result: {
            findings: [],
            impression: '',
            limitations: ['Analysis failed: ' + msg],
            modelBackend: aiConfigStore.load().backend,
            timestamp: Date.now(),
            modality: request.modality,
            processingTimeMs: Date.now() - startTime,
            rawOutput: msg,
          } satisfies AiAnalysisResult,
        };
      }
    },
  );

  // ─── Cancel Analysis ──────────────────────────────────────
  ipcMain.handle(IPC.AI_CANCEL_ANALYSIS, () => {
    aiInferenceService.cancel();
    return { ok: true };
  });

  // ─── Check Models ─────────────────────────────────────────
  ipcMain.handle(IPC.AI_CHECK_MODELS, () => {
    const config = aiConfigStore.load();
    const modelsDir = aiConfigStore.getModelsDir();

    const statuses: ModelFileStatus[] = LLAVA_MED_FILES.map((file) => {
      // Check configured path first, then default models dir
      let filePath: string;
      if (file.role === 'model' && config.modelPath) {
        filePath = config.modelPath;
      } else if (file.role === 'mmproj' && config.mmProjPath) {
        filePath = config.mmProjPath;
      } else {
        filePath = path.join(modelsDir, file.filename);
      }

      let exists = false;
      let sizeBytes: number | undefined;
      try {
        const stat = fs.statSync(filePath);
        exists = stat.isFile();
        sizeBytes = stat.size;
      } catch {
        exists = false;
      }

      return {
        filename: file.filename,
        role: file.role,
        path: filePath,
        exists,
        sizeBytes,
        expectedSizeMB: file.expectedSizeMB,
        downloadUrl: file.downloadUrl,
        description: file.description,
      };
    });

    return statuses;
  });

  // ─── Open Models Directory ────────────────────────────────
  ipcMain.handle(IPC.AI_OPEN_MODELS_DIR, async () => {
    try {
      const modelsDir = aiConfigStore.getModelsDir();
      // Create the directory if it doesn't exist
      if (!fs.existsSync(modelsDir)) {
        fs.mkdirSync(modelsDir, { recursive: true });
      }
      await shell.openPath(modelsDir);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  });

  // ─── Browse File ──────────────────────────────────────────
  ipcMain.handle(
    IPC.AI_BROWSE_FILE,
    async (
      _event,
      title: string,
      filters?: Array<{ name: string; extensions: string[] }>,
    ) => {
      try {
        const win = BrowserWindow.getFocusedWindow();
        if (!win) return { ok: false, error: 'No focused window' };

        const result = await dialog.showOpenDialog(win, {
          title,
          properties: ['openFile'],
          filters: filters ?? [
            { name: 'GGUF Model Files', extensions: ['gguf'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        });

        if (result.canceled || !result.filePaths[0]) {
          return { ok: false };
        }

        return { ok: true, path: result.filePaths[0] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },
  );

  // ─── Scan Models (preset dropdown) ───────────────────────────
  ipcMain.handle(IPC.AI_SCAN_MODELS, () => {
    const modelsDir = aiConfigStore.getModelsDir();

    const presets: ModelPreset[] = KNOWN_PRESETS.map((preset) => {
      const modelExists = fs.existsSync(path.join(modelsDir, preset.modelFilename));
      const mmProjExists = preset.mmProjFilename
        ? fs.existsSync(path.join(modelsDir, preset.mmProjFilename))
        : true;

      return {
        ...preset,
        isComplete: modelExists && mmProjExists,
      };
    });

    return presets;
  });
}
