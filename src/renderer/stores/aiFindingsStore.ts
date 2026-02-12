/**
 * AI Findings Store — reactive UI state for AI-powered finding extraction.
 *
 * Tracks server lifecycle, analysis progress, structured findings,
 * and panel visibility. Components subscribe to individual slices
 * via Zustand selectors for fine-grained re-rendering.
 *
 * Status push events from the main process are wired in the panel's
 * useEffect, calling setServerStatus() when AI_STATUS_UPDATE fires.
 */
import { create } from 'zustand';
import type {
  AiServerStatus,
  AiAnalysisResult,
  AiFinding,
} from '../../shared/types/ai';

// ─── Store Interface ────────────────────────────────────────────

interface AiFindingsStore {
  /** Whether the AI findings panel is visible */
  showPanel: boolean;

  /** Whether the settings section is expanded */
  showSettings: boolean;

  /** Current llama-server lifecycle status */
  serverStatus: AiServerStatus;

  /** Error message from server (if status is 'error') */
  serverError: string | undefined;

  /** Whether an analysis is currently in progress */
  isAnalyzing: boolean;

  /** Progress message shown during analysis */
  analysisProgress: string;

  /** Most recent analysis result (null if no analysis run yet) */
  currentResult: AiAnalysisResult | null;

  /** Error from most recent analysis attempt */
  analysisError: string | undefined;

  // ─── Actions ────────────────────────────────────────────────

  /** Toggle panel visibility */
  togglePanel: () => void;

  /** Toggle settings section visibility */
  toggleSettings: () => void;

  /** Update server status (called from AI_STATUS_UPDATE push event) */
  setServerStatus: (status: AiServerStatus, error?: string) => void;

  /** Set analyzing state with progress message */
  setAnalyzing: (analyzing: boolean, progress?: string) => void;

  /** Set analysis result */
  setResult: (result: AiAnalysisResult) => void;

  /** Set analysis error */
  setAnalysisError: (error: string) => void;

  /** Update a single finding's review status */
  updateFindingStatus: (
    findingId: string,
    status: AiFinding['status'],
    editedDescription?: string,
  ) => void;

  /** Reset store to initial state (e.g., when leaving viewer) */
  reset: () => void;
}

// ─── Store Creation ─────────────────────────────────────────────

export const useAiFindingsStore = create<AiFindingsStore>((set) => ({
  // Initial state
  showPanel: false,
  showSettings: false,
  serverStatus: 'stopped',
  serverError: undefined,
  isAnalyzing: false,
  analysisProgress: '',
  currentResult: null,
  analysisError: undefined,

  // Actions
  togglePanel: () => set((s) => ({ showPanel: !s.showPanel })),

  toggleSettings: () => set((s) => ({ showSettings: !s.showSettings })),

  setServerStatus: (status, error) =>
    set({ serverStatus: status, serverError: error }),

  setAnalyzing: (analyzing, progress) =>
    set({
      isAnalyzing: analyzing,
      analysisProgress: progress ?? '',
      ...(analyzing ? { analysisError: undefined } : {}),
    }),

  setResult: (result) =>
    set({
      currentResult: result,
      isAnalyzing: false,
      analysisProgress: '',
      analysisError: undefined,
    }),

  setAnalysisError: (error) =>
    set({
      isAnalyzing: false,
      analysisProgress: '',
      analysisError: error,
    }),

  updateFindingStatus: (findingId, status, editedDescription) =>
    set((s) => {
      if (!s.currentResult) return s;

      const findings = s.currentResult.findings.map((f) =>
        f.id === findingId
          ? { ...f, status, ...(editedDescription !== undefined ? { editedDescription } : {}) }
          : f,
      );

      return {
        currentResult: { ...s.currentResult, findings },
      };
    }),

  reset: () =>
    set({
      showPanel: false,
      showSettings: false,
      serverStatus: 'stopped',
      serverError: undefined,
      isAnalyzing: false,
      analysisProgress: '',
      currentResult: null,
      analysisError: undefined,
    }),
}));
