/**
 * Shared AI type definitions between main and renderer processes.
 *
 * Covers model configuration, server lifecycle, image analysis requests,
 * structured finding results, and model file status for the download guide.
 */

// ─── Model & Server ──────────────────────────────────────────────

/** Supported AI model backends. LLaVA-Med is the primary (multimodal single-model).
 *  BiomedCLIP+Mistral is a future two-stage pipeline (stubbed for now). */
export type AiModelBackend = 'llava-med' | 'biomedclip-mistral';

/** llama-server child process lifecycle states. */
export type AiServerStatus =
  | 'stopped'
  | 'starting'
  | 'ready'
  | 'error'
  | 'model-missing';

/** Persisted AI configuration stored in {userData}/ai-config.json. */
export interface AiModelConfig {
  /** Active model backend */
  backend: AiModelBackend;
  /** Path to llama-server binary (empty = auto-detect bundled or PATH) */
  llamaServerPath: string;
  /** Path to the main GGUF model file */
  modelPath: string;
  /** Path to multimodal projector (LLaVA-Med only) */
  mmProjPath: string;
  /** Number of layers offloaded to GPU (0 = CPU only) */
  gpuLayers: number;
  /** Context window size in tokens */
  contextSize: number;
  /** HTTP port for llama-server */
  port: number;
  /** Selected model preset ID (empty = auto-detect) */
  selectedPresetId: string;
}

/** Status update pushed from main → renderer when server state changes. */
export interface AiServerStatusUpdate {
  status: AiServerStatus;
  error?: string;
  modelLoaded?: string;
}

// ─── Analysis Request & Result ───────────────────────────────────

/** Image + metadata sent from renderer to main for AI analysis. */
export interface AiAnalysisRequest {
  /** PNG data URL of the current viewport (data:image/png;base64,...) */
  imageDataUrl: string;
  /** DICOM modality (CT, MR, CR, DX, US, PT, NM, etc.) */
  modality: string;
  /** DICOM SeriesDescription */
  seriesDescription?: string;
  /** DICOM BodyPartExamined */
  bodyPart?: string;
  /** Current slice info (e.g., "Slice 45 of 120") */
  sliceInfo?: string;
  /** Study description */
  studyDescription?: string;
  /** Patient demographics for clinical context */
  patientAge?: string;
  patientSex?: string;
  /** Additional windowed captures (CT multi-window) */
  additionalWindows?: Array<{ name: string; dataUrl: string }>;
}

/** Severity of an individual AI finding. */
export type AiFindingSeverity = 'normal' | 'mild' | 'moderate' | 'severe';

/** Anatomical/pathological category for a finding. */
export type AiFindingCategory =
  | 'airspace'
  | 'vascular'
  | 'cardiac'
  | 'skeletal'
  | 'soft_tissue'
  | 'device'
  | 'other';

/** A single structured finding extracted by the AI model. */
export interface AiFinding {
  /** Unique ID (UUID assigned client-side) */
  id: string;
  /** Description of the finding */
  description: string;
  /** Anatomic location */
  location: string;
  /** Severity classification */
  severity: AiFindingSeverity;
  /** Model confidence (0-1) */
  confidence: number;
  /** Pathological category */
  category: AiFindingCategory;
  /** User review status */
  status: 'pending' | 'accepted' | 'rejected' | 'edited';
  /** User-edited description (when status is 'edited') */
  editedDescription?: string;
}

/** Complete result of an AI image analysis. */
export interface AiAnalysisResult {
  /** Structured findings extracted from the image */
  findings: AiFinding[];
  /** Overall clinical impression */
  impression: string;
  /** Analysis limitations noted by the model */
  limitations: string[];
  /** Which model backend produced this result */
  modelBackend: AiModelBackend;
  /** Unix timestamp of result */
  timestamp: number;
  /** Image modality that was analyzed */
  modality: string;
  /** Wall-clock inference time in milliseconds */
  processingTimeMs: number;
  /** Raw model output (for debugging parse failures) */
  rawOutput?: string;
}

// ─── Model Preset (dropdown selector) ────────────────────────────

/** A recognized model configuration shown in the Settings dropdown. */
export interface ModelPreset {
  /** Unique preset ID, e.g. 'llava-med-7b-q4km' */
  id: string;
  /** Human-readable name, e.g. 'LLaVA-Med 7B (Q4_K_M)' */
  displayName: string;
  /** Which backend this preset uses */
  backend: AiModelBackend;
  /** Expected GGUF filename in the models directory */
  modelFilename: string;
  /** Expected mmproj filename (LLaVA-Med only) */
  mmProjFilename?: string;
  /** Whether all required files are present on disk */
  isComplete: boolean;
  /** Combined download size in MB */
  totalSizeMB: number;
}

// ─── Model File Status (download guide) ──────────────────────────

/** Status of a single model file on disk. Used by the download guide UI. */
export interface ModelFileStatus {
  /** Display filename */
  filename: string;
  /** Role of this file (model, projector, clip encoder) */
  role: 'model' | 'mmproj' | 'clip-vision' | 'clip-text';
  /** Absolute path where the file should be / is located */
  path: string;
  /** Whether the file exists at the path */
  exists: boolean;
  /** File size in bytes (if exists) */
  sizeBytes?: number;
  /** Expected file size in MB (for download guide) */
  expectedSizeMB: number;
  /** HuggingFace download URL */
  downloadUrl: string;
  /** Human-readable description */
  description: string;
}
