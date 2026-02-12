/**
 * AiFindingsPanel — right-side panel for AI-powered finding extraction.
 *
 * Layout:
 * ┌─ Header: "AI Findings" + close (X) ─────────────┐
 * │ ⚠ AI-Generated — Not a Clinical Diagnosis        │ ← amber bg, always visible
 * ├──────────────────────────────────────────────────┤
 * │ ● Ready  |  LLaVA-Med 7B                        │ ← server status
 * │ [  Analyze Current Slice  ]                       │ ← blue button
 * ├──────────────────────────────────────────────────┤
 * │ Finding 1: Right upper lobe nodule               │ ← severity badge, location
 * │   Location: RUL, posterior segment               │
 * │   Severity: moderate  Confidence: 82%            │
 * │   [✓ Accept] [✎ Edit] [✗ Reject]                │
 * ├──────────────────────────────────────────────────┤
 * │ ▸ Impression                                      │ ← collapsible
 * │ ▸ Limitations                                     │ ← collapsible
 * │ ▸ Settings                                        │ ← collapsible inline
 * ├──────────────────────────────────────────────────┤
 * │ Generated in 12.3s • LLaVA-Med 7B               │ ← footer
 * └──────────────────────────────────────────────────┘
 */
import { useState, useEffect, useCallback } from 'react';
import { useAiFindingsStore } from '../../stores/aiFindingsStore';
import { useViewerStore } from '../../stores/viewerStore';
import { buildAnalysisRequest } from '../../lib/aiImageCapture';
import { IconClose, IconChevronDown, IconAiSparkle } from '../icons';
import { IPC } from '../../../shared/ipcChannels';
import type {
  AiFinding,
  AiFindingSeverity,
  AiModelConfig,
  ModelFileStatus,
  ModelPreset,
} from '../../../shared/types/ai';

// ─── Constants ──────────────────────────────────────────────────

const SEVERITY_COLORS: Record<AiFindingSeverity, string> = {
  normal: 'bg-emerald-900/50 text-emerald-300 border-emerald-700',
  mild: 'bg-yellow-900/50 text-yellow-300 border-yellow-700',
  moderate: 'bg-orange-900/50 text-orange-300 border-orange-700',
  severe: 'bg-red-900/50 text-red-300 border-red-700',
};

const SEVERITY_BADGE: Record<AiFindingSeverity, string> = {
  normal: 'bg-emerald-800 text-emerald-200',
  mild: 'bg-yellow-800 text-yellow-200',
  moderate: 'bg-orange-800 text-orange-200',
  severe: 'bg-red-800 text-red-200',
};

const STATUS_DOT: Record<string, string> = {
  stopped: 'bg-zinc-500',
  starting: 'bg-yellow-400 animate-pulse',
  ready: 'bg-emerald-400',
  error: 'bg-red-400',
  'model-missing': 'bg-orange-400',
};

const STATUS_LABEL: Record<string, string> = {
  stopped: 'Stopped',
  starting: 'Starting...',
  ready: 'Ready',
  error: 'Error',
  'model-missing': 'Model Missing',
};

// ─── Props ──────────────────────────────────────────────────────

interface AiFindingsPanelProps {
  sourceImageIds: string[];
}

// ─── Sub-Components ─────────────────────────────────────────────

/** Collapsible section with chevron indicator */
function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-zinc-800">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
      >
        <IconChevronDown
          className={`w-3 h-3 transition-transform ${open ? '' : '-rotate-90'}`}
        />
        {title}
      </button>
      {open && <div className="px-3 pb-2">{children}</div>}
    </div>
  );
}

/** Single finding card */
function FindingCard({
  finding,
  onUpdateStatus,
}: {
  finding: AiFinding;
  onUpdateStatus: (
    id: string,
    status: AiFinding['status'],
    editedDescription?: string,
  ) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(finding.editedDescription ?? finding.description);

  const handleSaveEdit = useCallback(() => {
    onUpdateStatus(finding.id, 'edited', editText);
    setEditing(false);
  }, [finding.id, editText, onUpdateStatus]);

  const confidencePct = Math.round(finding.confidence * 100);

  return (
    <div
      className={`rounded-lg border p-2.5 mb-2 ${SEVERITY_COLORS[finding.severity]} ${
        finding.status === 'rejected' ? 'opacity-40' : ''
      }`}
    >
      {/* Description */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex-1 min-w-0">
          {editing ? (
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="w-full bg-zinc-900 text-zinc-200 text-xs rounded px-2 py-1 border border-zinc-600 resize-none"
              rows={2}
              autoFocus
            />
          ) : (
            <p className="text-xs leading-relaxed">
              {finding.status === 'edited' && finding.editedDescription
                ? finding.editedDescription
                : finding.description}
            </p>
          )}
        </div>
        <span
          className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${SEVERITY_BADGE[finding.severity]}`}
        >
          {finding.severity}
        </span>
      </div>

      {/* Location + metadata */}
      <div className="flex items-center gap-2 text-[10px] text-zinc-400 mb-2">
        <span>{finding.location}</span>
        <span>•</span>
        <span>{finding.category}</span>
        <span>•</span>
        <span>{confidencePct}%</span>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1.5">
        {editing ? (
          <>
            <button
              onClick={handleSaveEdit}
              className="text-[10px] px-2 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors"
            >
              Save
            </button>
            <button
              onClick={() => setEditing(false)}
              className="text-[10px] px-2 py-0.5 rounded bg-zinc-700 text-zinc-300 hover:bg-zinc-600 transition-colors"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => onUpdateStatus(finding.id, 'accepted')}
              className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                finding.status === 'accepted'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-zinc-700/50 text-zinc-400 hover:bg-zinc-600 hover:text-zinc-200'
              }`}
            >
              {'\u2713'} Accept
            </button>
            <button
              onClick={() => setEditing(true)}
              className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                finding.status === 'edited'
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-700/50 text-zinc-400 hover:bg-zinc-600 hover:text-zinc-200'
              }`}
            >
              {'\u270E'} Edit
            </button>
            <button
              onClick={() => onUpdateStatus(finding.id, 'rejected')}
              className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                finding.status === 'rejected'
                  ? 'bg-red-600 text-white'
                  : 'bg-zinc-700/50 text-zinc-400 hover:bg-zinc-600 hover:text-zinc-200'
              }`}
            >
              {'\u2717'} Reject
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Model Setup Guide (Prominent) ──────────────────────────────

/** Prominent model setup guide shown when models are missing */
function ModelSetupGuide({
  modelStatus,
  onRefresh,
}: {
  modelStatus: ModelFileStatus[];
  onRefresh: () => void;
}) {
  const missingFiles = modelStatus.filter((f) => !f.exists);

  if (missingFiles.length === 0) return null;

  return (
    <div className="mx-2 mt-2 rounded-lg border border-orange-700/50 bg-orange-950/30 overflow-hidden">
      {/* Banner */}
      <div className="px-3 py-2 bg-orange-900/40 border-b border-orange-700/50">
        <h3 className="text-[11px] font-bold text-orange-300">Model Setup Required</h3>
        <p className="text-[10px] text-orange-400/80 mt-0.5">
          Download the AI model files to enable analysis
        </p>
      </div>

      <div className="px-3 py-2.5 space-y-3">
        {/* Step 1: Download */}
        <div>
          <p className="text-[10px] font-semibold text-zinc-300 mb-1.5">
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-600 text-white text-[9px] font-bold mr-1.5">1</span>
            Download model files
          </p>
          <div className="space-y-1.5 ml-5">
            {missingFiles.map((file) => (
              <a
                key={file.role}
                href={file.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between bg-blue-600 hover:bg-blue-500 text-white rounded px-3 py-1.5 transition-colors group"
              >
                <span className="text-[10px] font-medium truncate mr-2">{file.filename}</span>
                <span className="text-[9px] shrink-0 opacity-80 group-hover:opacity-100">
                  {file.expectedSizeMB.toLocaleString()} MB
                </span>
              </a>
            ))}
          </div>
        </div>

        {/* Step 2: Save to directory */}
        <div>
          <p className="text-[10px] font-semibold text-zinc-300 mb-1.5">
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-600 text-white text-[9px] font-bold mr-1.5">2</span>
            Save to models directory
          </p>
          <div className="ml-5">
            <button
              onClick={() => window.electronAPI.ai.openModelsDir()}
              className="text-[10px] px-3 py-1.5 bg-zinc-700 text-zinc-200 rounded hover:bg-zinc-600 transition-colors font-medium"
            >
              Open Models Folder
            </button>
            <p className="text-[9px] text-zinc-500 mt-1">
              Move downloaded .gguf files into this folder
            </p>
          </div>
        </div>

        {/* Step 3: Refresh */}
        <div>
          <p className="text-[10px] font-semibold text-zinc-300 mb-1.5">
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-600 text-white text-[9px] font-bold mr-1.5">3</span>
            Verify setup
          </p>
          <div className="ml-5">
            <button
              onClick={onRefresh}
              className="text-[10px] px-3 py-1.5 bg-zinc-700 text-zinc-200 rounded hover:bg-zinc-600 transition-colors font-medium"
            >
              Refresh Status
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Settings Section ───────────────────────────────────────────

const CUSTOM_PRESET_ID = '__custom__';

function SettingsSection() {
  const [config, setConfig] = useState<AiModelConfig | null>(null);
  const [presets, setPresets] = useState<ModelPreset[]>([]);
  const [modelStatus, setModelStatus] = useState<ModelFileStatus[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showDownloadGuide, setShowDownloadGuide] = useState(false);

  // Load config + presets on mount
  useEffect(() => {
    window.electronAPI.ai.getConfig().then(setConfig);
    window.electronAPI.ai.scanModels().then(setPresets);
    window.electronAPI.ai.checkModels().then(setModelStatus);
  }, []);

  const updateConfig = useCallback(
    async (partial: Partial<AiModelConfig>) => {
      await window.electronAPI.ai.setConfig(partial);
      const updated = await window.electronAPI.ai.getConfig();
      setConfig(updated);
    },
    [],
  );

  const refreshPresets = useCallback(async () => {
    const updated = await window.electronAPI.ai.scanModels();
    setPresets(updated);
    const status = await window.electronAPI.ai.checkModels();
    setModelStatus(status);
  }, []);

  const browseFile = useCallback(
    async (field: 'modelPath' | 'mmProjPath' | 'llamaServerPath', title: string) => {
      const result = await window.electronAPI.ai.browseFile(title);
      if (result.ok && result.path) {
        await updateConfig({ [field]: result.path });
        await refreshPresets();
      }
    },
    [updateConfig, refreshPresets],
  );

  const handlePresetChange = useCallback(
    async (presetId: string) => {
      if (presetId === CUSTOM_PRESET_ID) {
        await updateConfig({ selectedPresetId: CUSTOM_PRESET_ID });
        setShowAdvanced(true);
        return;
      }

      const preset = presets.find((p) => p.id === presetId);
      if (!preset) return;

      // Auto-resolve paths from models dir
      await updateConfig({
        selectedPresetId: presetId,
        backend: preset.backend,
        // Clear explicit paths so auto-resolve from models dir kicks in
        modelPath: '',
        mmProjPath: '',
      });
    },
    [presets, updateConfig],
  );

  if (!config) return null;

  // Determine which preset is selected
  const selectedId = config.selectedPresetId || (presets.length > 0 ? presets[0].id : '');
  const selectedPreset = presets.find((p) => p.id === selectedId);
  const isCustom = selectedId === CUSTOM_PRESET_ID;

  return (
    <div className="space-y-3">
      {/* Model Preset Dropdown */}
      <div>
        <label className="text-[10px] text-zinc-500 uppercase tracking-wide">Model</label>
        <select
          value={selectedId}
          onChange={(e) => handlePresetChange(e.target.value)}
          className="w-full mt-0.5 bg-zinc-900 text-zinc-300 text-[11px] rounded px-2 py-1.5 border border-zinc-700 cursor-pointer appearance-none"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 8px center',
            paddingRight: '28px',
          }}
        >
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.isComplete ? '\u2713' : '\u26A0'} {preset.displayName}
            </option>
          ))}
          <option value={CUSTOM_PRESET_ID}>Custom (manual paths)</option>
        </select>

        {/* Status indicator below dropdown */}
        {!isCustom && selectedPreset && (
          <p className={`text-[10px] mt-1 ${selectedPreset.isComplete ? 'text-emerald-400' : 'text-orange-400'}`}>
            {selectedPreset.isComplete
              ? '\u2713 Model files found'
              : '\u26A0 Missing files \u2014 see download guide below'}
          </p>
        )}
      </div>

      {/* GPU Layers */}
      <div>
        <div className="flex items-center justify-between mb-0.5">
          <label className="text-[10px] text-zinc-500 uppercase tracking-wide">GPU Layers</label>
          <span className="text-[11px] text-zinc-400 tabular-nums">{config.gpuLayers}</span>
        </div>
        <input
          type="range"
          min={0}
          max={99}
          value={config.gpuLayers}
          onChange={(e) => updateConfig({ gpuLayers: parseInt(e.target.value, 10) })}
          className="w-full h-1 accent-blue-500 cursor-pointer"
        />
        <div className="flex justify-between text-[9px] text-zinc-600 mt-0.5">
          <span>CPU only</span>
          <span>Full GPU</span>
        </div>
      </div>

      {/* Context Size */}
      <div>
        <div className="flex items-center justify-between mb-0.5">
          <label className="text-[10px] text-zinc-500 uppercase tracking-wide">Context Size</label>
          <span className="text-[11px] text-zinc-400 tabular-nums">{config.contextSize}</span>
        </div>
        <input
          type="range"
          min={2048}
          max={8192}
          step={512}
          value={config.contextSize}
          onChange={(e) => updateConfig({ contextSize: parseInt(e.target.value, 10) })}
          className="w-full h-1 accent-blue-500 cursor-pointer"
        />
      </div>

      {/* Port */}
      <div>
        <div className="flex items-center justify-between mb-0.5">
          <label className="text-[10px] text-zinc-500 uppercase tracking-wide">Port</label>
          <span className="text-[11px] text-zinc-400 tabular-nums">{config.port}</span>
        </div>
        <input
          type="number"
          min={1024}
          max={65535}
          value={config.port}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (v >= 1024 && v <= 65535) updateConfig({ port: v });
          }}
          className="w-full bg-zinc-900 text-zinc-300 text-[11px] rounded px-2 py-1 border border-zinc-700"
        />
      </div>

      {/* Advanced (collapsible) — Browse fields for power users */}
      <div className="border-t border-zinc-800 pt-2">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center gap-1.5 text-[10px] font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <IconChevronDown
            className={`w-3 h-3 transition-transform ${showAdvanced ? '' : '-rotate-90'}`}
          />
          Advanced
        </button>

        {showAdvanced && (
          <div className="mt-2 space-y-2.5">
            {/* Model Path */}
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wide">Model Path</label>
              <div className="flex items-center gap-1 mt-0.5">
                <input
                  type="text"
                  value={config.modelPath}
                  readOnly
                  className="flex-1 min-w-0 bg-zinc-900 text-zinc-300 text-[11px] rounded px-2 py-1 border border-zinc-700 truncate"
                  placeholder={isCustom ? 'Not configured' : 'Auto-detect from models dir'}
                />
                <button
                  onClick={() => browseFile('modelPath', 'Select GGUF model file')}
                  className="shrink-0 text-[10px] px-2 py-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600 transition-colors"
                >
                  Browse
                </button>
              </div>
            </div>

            {/* mmproj Path */}
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wide">mmproj Path</label>
              <div className="flex items-center gap-1 mt-0.5">
                <input
                  type="text"
                  value={config.mmProjPath}
                  readOnly
                  className="flex-1 min-w-0 bg-zinc-900 text-zinc-300 text-[11px] rounded px-2 py-1 border border-zinc-700 truncate"
                  placeholder={isCustom ? 'Not configured' : 'Auto-detect from models dir'}
                />
                <button
                  onClick={() => browseFile('mmProjPath', 'Select mmproj projector file')}
                  className="shrink-0 text-[10px] px-2 py-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600 transition-colors"
                >
                  Browse
                </button>
              </div>
            </div>

            {/* llama-server Path */}
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wide">
                llama-server binary <span className="text-zinc-600">(bundled)</span>
              </label>
              <div className="flex items-center gap-1 mt-0.5">
                <input
                  type="text"
                  value={config.llamaServerPath}
                  readOnly
                  className="flex-1 min-w-0 bg-zinc-900 text-zinc-300 text-[11px] rounded px-2 py-1 border border-zinc-700 truncate"
                  placeholder="Auto-detect (bundled or PATH)"
                />
                <button
                  onClick={() => browseFile('llamaServerPath', 'Select llama-server binary')}
                  className="shrink-0 text-[10px] px-2 py-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600 transition-colors"
                >
                  Browse
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Open models directory */}
      <button
        onClick={() => window.electronAPI.ai.openModelsDir()}
        className="w-full text-[10px] px-2 py-1.5 bg-zinc-800 text-zinc-400 rounded hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
      >
        Open Models Directory
      </button>

      {/* Download Guide (compact, for when models are already configured) */}
      <div className="border-t border-zinc-800 pt-2">
        <button
          onClick={() => {
            setShowDownloadGuide(!showDownloadGuide);
            if (!showDownloadGuide) refreshPresets();
          }}
          className="w-full flex items-center gap-1.5 text-[10px] font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <IconChevronDown
            className={`w-3 h-3 transition-transform ${showDownloadGuide ? '' : '-rotate-90'}`}
          />
          Download Guide
        </button>

        {showDownloadGuide && (
          <div className="mt-2 space-y-2">
            {modelStatus.map((file) => (
              <div key={file.role} className="bg-zinc-900 rounded p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-medium text-zinc-300">{file.filename}</span>
                  {file.exists ? (
                    <span className="text-[9px] text-emerald-400">Found</span>
                  ) : (
                    <span className="text-[9px] text-red-400">Missing</span>
                  )}
                </div>
                <p className="text-[9px] text-zinc-500 mb-1">{file.description}</p>
                <p className="text-[9px] text-zinc-500 mb-1">
                  Size: ~{file.expectedSizeMB.toLocaleString()} MB
                  {file.sizeBytes && ` (${(file.sizeBytes / 1024 / 1024).toFixed(0)} MB on disk)`}
                </p>
                {!file.exists && (
                  <a
                    href={file.downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block bg-blue-600 hover:bg-blue-500 text-white text-[10px] px-3 py-1 rounded font-medium transition-colors mt-1"
                  >
                    Download ({file.expectedSizeMB.toLocaleString()} MB)
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Panel Component ───────────────────────────────────────

export default function AiFindingsPanel({ sourceImageIds }: AiFindingsPanelProps) {
  const togglePanel = useAiFindingsStore((s) => s.togglePanel);
  const serverStatus = useAiFindingsStore((s) => s.serverStatus);
  const serverError = useAiFindingsStore((s) => s.serverError);
  const isAnalyzing = useAiFindingsStore((s) => s.isAnalyzing);
  const analysisProgress = useAiFindingsStore((s) => s.analysisProgress);
  const currentResult = useAiFindingsStore((s) => s.currentResult);
  const analysisError = useAiFindingsStore((s) => s.analysisError);
  const setServerStatus = useAiFindingsStore((s) => s.setServerStatus);
  const setAnalyzing = useAiFindingsStore((s) => s.setAnalyzing);
  const setResult = useAiFindingsStore((s) => s.setResult);
  const setAnalysisError = useAiFindingsStore((s) => s.setAnalysisError);
  const updateFindingStatus = useAiFindingsStore((s) => s.updateFindingStatus);

  const activeViewportId = useViewerStore((s) => s.activeViewportId);

  // Track model file status for the prominent setup guide
  const [modelStatus, setModelStatus] = useState<ModelFileStatus[]>([]);

  const refreshModelStatus = useCallback(async () => {
    const status = await window.electronAPI.ai.checkModels();
    setModelStatus(status);
  }, []);

  // Wire up status push events from main process
  useEffect(() => {
    const handler = (update: { status: string; error?: string }) => {
      setServerStatus(
        update.status as Parameters<typeof setServerStatus>[0],
        update.error,
      );
      // Refresh model status when server reports model-missing
      if (update.status === 'model-missing') {
        refreshModelStatus();
      }
    };
    window.electronAPI.on(IPC.AI_STATUS_UPDATE, handler as (...args: unknown[]) => void);

    // Fetch initial status + model status
    window.electronAPI.ai.getStatus().then((s) => {
      setServerStatus(s.status as Parameters<typeof setServerStatus>[0], s.error);
    });
    refreshModelStatus();
  }, [setServerStatus, refreshModelStatus]);

  // ─── Server Control ─────────────────────────────────────────
  const handleStartServer = useCallback(async () => {
    const result = await window.electronAPI.ai.startServer();
    if (!result.ok && result.error) {
      setServerStatus('error', result.error);
    }
  }, [setServerStatus]);

  const handleStopServer = useCallback(async () => {
    await window.electronAPI.ai.stopServer();
  }, []);

  // ─── Analysis ─────────────────────────────────────────────
  const handleAnalyze = useCallback(async () => {
    if (isAnalyzing) return;

    setAnalyzing(true, 'Capturing image...');

    // Build request from viewport
    const request = buildAnalysisRequest(activeViewportId);
    if (!request) {
      setAnalysisError('Failed to capture viewport image');
      return;
    }

    setAnalyzing(true, 'Running AI analysis...');

    const result = await window.electronAPI.ai.analyzeImage(request);
    if (result.ok && result.result) {
      setResult(result.result);
    } else {
      setAnalysisError(result.error ?? 'Analysis failed');
    }
  }, [isAnalyzing, activeViewportId, setAnalyzing, setResult, setAnalysisError]);

  const handleCancel = useCallback(async () => {
    await window.electronAPI.ai.cancelAnalysis();
    setAnalyzing(false);
  }, [setAnalyzing]);

  // ─── Render ─────────────────────────────────────────────────
  const hasImages = sourceImageIds.length > 0;
  const canAnalyze = serverStatus === 'ready' && !isAnalyzing && hasImages;

  return (
    <div className="w-80 shrink-0 border-l border-zinc-800 bg-zinc-950 flex flex-col overflow-hidden">
      {/* ─── Header ───────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
        <div className="flex items-center gap-1.5">
          <IconAiSparkle className="w-4 h-4 text-blue-400" />
          <h2 className="text-sm font-semibold text-zinc-200">AI Findings</h2>
        </div>
        <button
          onClick={togglePanel}
          title="Close AI panel"
          className="p-0.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <IconClose className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ─── Disclaimer ───────────────────────────────── */}
      <div className="mx-2 mt-2 px-2.5 py-2 bg-amber-900/30 border border-amber-700/50 rounded-lg">
        <p className="text-[10px] text-amber-300 leading-relaxed font-medium">
          AI-Generated — Not a Clinical Diagnosis. All findings must be reviewed by a qualified radiologist.
        </p>
      </div>

      {/* ─── Scrollable Content ───────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {/* Server Status + Controls */}
        <div className="px-3 py-2.5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${STATUS_DOT[serverStatus] ?? 'bg-zinc-500'}`}
              />
              <span className="text-xs text-zinc-300">{STATUS_LABEL[serverStatus] ?? serverStatus}</span>
            </div>
            {(serverStatus === 'stopped' || serverStatus === 'error' || serverStatus === 'model-missing') && (
              <button
                onClick={handleStartServer}
                className="text-[10px] px-2 py-0.5 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600 transition-colors"
              >
                Start
              </button>
            )}
            {(serverStatus === 'ready' || serverStatus === 'starting') && (
              <button
                onClick={handleStopServer}
                className="text-[10px] px-2 py-0.5 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600 transition-colors"
              >
                Stop
              </button>
            )}
          </div>

          {/* Server Error */}
          {serverError && (
            <p className="text-[10px] text-red-400 mb-2 leading-relaxed">{serverError}</p>
          )}
        </div>

        {/* Prominent Model Setup Guide — shown when models are missing */}
        {(serverStatus === 'model-missing' || serverStatus === 'stopped') && modelStatus.length > 0 && (
          <ModelSetupGuide modelStatus={modelStatus} onRefresh={refreshModelStatus} />
        )}

        <div className="px-3 py-2.5 pt-0">
          {/* Analyze Button */}
          <button
            onClick={isAnalyzing ? handleCancel : handleAnalyze}
            disabled={!isAnalyzing && !canAnalyze}
            className={`w-full py-2 rounded-lg text-xs font-semibold transition-colors ${
              isAnalyzing
                ? 'bg-red-600 text-white hover:bg-red-500'
                : canAnalyze
                  ? 'bg-blue-600 text-white hover:bg-blue-500'
                  : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
            }`}
          >
            {isAnalyzing ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                  <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                {analysisProgress || 'Analyzing...'}
              </span>
            ) : (
              'Analyze Current Slice'
            )}
          </button>

          {/* Analysis Error */}
          {analysisError && !isAnalyzing && (
            <p className="text-[10px] text-red-400 mt-2 leading-relaxed">{analysisError}</p>
          )}
        </div>

        {/* ─── Findings ─────────────────────────────────── */}
        {currentResult && currentResult.findings.length > 0 && (
          <div className="px-3 pb-2">
            <h3 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">
              Findings ({currentResult.findings.length})
            </h3>
            {currentResult.findings.map((finding) => (
              <FindingCard
                key={finding.id}
                finding={finding}
                onUpdateStatus={updateFindingStatus}
              />
            ))}
          </div>
        )}

        {/* No findings message */}
        {currentResult && currentResult.findings.length === 0 && (
          <div className="px-3 py-4 text-center">
            <p className="text-xs text-zinc-500">No findings identified</p>
          </div>
        )}

        {/* ─── Impression ────────────────────────────────── */}
        {currentResult && currentResult.impression && (
          <CollapsibleSection title="Impression" defaultOpen>
            <p className="text-xs text-zinc-300 leading-relaxed">{currentResult.impression}</p>
          </CollapsibleSection>
        )}

        {/* ─── Limitations ───────────────────────────────── */}
        {currentResult && currentResult.limitations.length > 0 && (
          <CollapsibleSection title="Limitations">
            <ul className="space-y-1">
              {currentResult.limitations.map((lim, i) => (
                <li key={i} className="text-[10px] text-zinc-500 leading-relaxed">
                  • {lim}
                </li>
              ))}
            </ul>
          </CollapsibleSection>
        )}

        {/* ─── Raw Output (debug, shown only on parse issues) ─── */}
        {currentResult?.rawOutput && (
          <CollapsibleSection title="Debug: Raw Output">
            <pre className="text-[9px] text-zinc-500 bg-zinc-900 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-40">
              {currentResult.rawOutput}
            </pre>
          </CollapsibleSection>
        )}

        {/* ─── Settings ──────────────────────────────────── */}
        <CollapsibleSection title="Settings">
          <SettingsSection />
        </CollapsibleSection>
      </div>

      {/* ─── Footer ──────────────────────────────────── */}
      {currentResult && (
        <div className="px-3 py-1.5 border-t border-zinc-800 text-[9px] text-zinc-600">
          Generated in {(currentResult.processingTimeMs / 1000).toFixed(1)}s
          {' • '}
          {currentResult.modelBackend === 'llava-med' ? 'LLaVA-Med' : 'BiomedCLIP+Mistral'}
          {' • '}
          {currentResult.modality}
        </div>
      )}
    </div>
  );
}
