/**
 * ExportDropdown — toolbar dropdown providing export actions:
 *   1. Save as Image (PNG/JPEG) — file save dialog (captures viewport + overlay)
 *   2. Copy to Clipboard — system clipboard as image
 *   3. Save All Slices — export every slice as PNG to a folder
 *   4. Save DICOM — raw DICOM file for the current slice
 *   5. Export Annotations — CSV report of all measurements
 *
 * Dropdown uses fixed positioning to escape toolbar overflow clipping,
 * same pattern as AnnotationToolDropdown.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { wadouri } from '@cornerstonejs/dicom-image-loader';
import { useViewerStore } from '../../stores/viewerStore';
import { useAnnotationStore } from '../../stores/annotationStore';
import { viewportService } from '../../lib/cornerstone/viewportService';
import { IconExportFile } from '../icons';

// ─── Toast Feedback ─────────────────────────────────────────────

type ToastState = { message: string; type: 'success' | 'error' } | null;

function Toast({ toast }: { toast: NonNullable<ToastState> }) {
  return (
    <div
      className={`fixed top-4 right-4 z-[100] px-4 py-2 rounded-lg shadow-lg text-sm font-medium transition-opacity ${
        toast.type === 'success'
          ? 'bg-green-800 text-green-100'
          : 'bg-red-800 text-red-100'
      }`}
    >
      {toast.message}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────

function arrayBufferToBase64(buffer: ArrayBufferLike): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// ─── Export Action Definitions ──────────────────────────────────

interface ExportAction {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  separator?: boolean; // Render a divider before this action
}

const EXPORT_ACTIONS: ExportAction[] = [
  {
    id: 'save-image',
    label: 'Save as Image',
    description: 'PNG or JPEG with annotations',
    icon: (
      <svg className="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="2" width="12" height="12" rx="1.5" />
        <circle cx="5.5" cy="5.5" r="1.5" />
        <polyline points="2,12 5,9 7,11 10,7 14,12" />
      </svg>
    ),
  },
  {
    id: 'copy-clipboard',
    label: 'Copy to Clipboard',
    description: 'Paste into any app',
    icon: (
      <svg className="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="4" y="4" width="10" height="10" rx="1.5" />
        <path d="M4 12 H3 A1.5 1.5 0 0 1 1.5 10.5 V3 A1.5 1.5 0 0 1 3 1.5 H10.5 A1.5 1.5 0 0 1 12 3 V4" />
      </svg>
    ),
  },
  {
    id: 'save-all-slices',
    label: 'Save All Slices',
    description: 'Export every slice as PNG',
    separator: true,
    icon: (
      <svg className="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="1" y="3" width="10" height="10" rx="1" />
        <rect x="3" y="1.5" width="10" height="10" rx="1" opacity="0.5" />
        <path d="M6 11 V7" />
        <polyline points="4,9 6,11 8,9" />
      </svg>
    ),
  },
  {
    id: 'save-dicom',
    label: 'Save DICOM File',
    description: 'Raw .dcm for current slice',
    icon: (
      <svg className="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M8 2 V10" />
        <polyline points="5,8 8,11 11,8" />
        <path d="M3 13 H13" />
      </svg>
    ),
  },
  {
    id: 'export-annotations',
    label: 'Export Annotations',
    description: 'CSV report of measurements',
    separator: true,
    icon: (
      <svg className="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="1" width="12" height="14" rx="1.5" />
        <line x1="5" y1="5" x2="11" y2="5" />
        <line x1="5" y1="8" x2="11" y2="8" />
        <line x1="5" y1="11" x2="9" y2="11" />
      </svg>
    ),
  },
];

// ─── Component ──────────────────────────────────────────────────

export default function ExportDropdown() {
  const [open, setOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [toast, setToast] = useState<ToastState>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const activeViewportId = useViewerStore((s) => s.activeViewportId);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        buttonRef.current?.contains(e.target as Node) ||
        dropdownRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleToggle = useCallback(() => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const dropdownWidth = 220;
      const maxLeft = window.innerWidth - dropdownWidth - 8;
      setDropdownPos({ top: rect.bottom + 4, left: Math.min(rect.left, maxLeft) });
    }
    setOpen((v) => !v);
  }, [open]);

  // ─── Export Handlers ────────────────────────────────────────

  const captureCanvas = useCallback((): string | null => {
    const viewport = viewportService.getViewport(activeViewportId);
    if (!viewport) return null;
    try {
      const canvas = viewport.getCanvas();
      return canvas.toDataURL('image/png');
    } catch (err) {
      console.error('[ExportDropdown] Canvas capture failed:', err);
      return null;
    }
  }, [activeViewportId]);

  const getActivePanelBounds = useCallback(() => {
    const panelEl = document.querySelector(`[data-panel-id="${activeViewportId}"]`) as HTMLElement | null;
    if (!panelEl) return null;
    const rect = panelEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: Math.floor(rect.left),
      y: Math.floor(rect.top),
      width: Math.floor(rect.width),
      height: Math.floor(rect.height),
    };
  }, [activeViewportId]);

  const handleSaveImage = useCallback(async () => {
    setBusy(true);
    setOpen(false);
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const bounds = getActivePanelBounds();

      const result = bounds
        ? await window.electronAPI.export.saveViewportCapture(
            bounds,
            `viewport-${timestamp}.png`,
          )
        : await (async () => {
            // Fallback: canvas-only capture (should rarely be needed)
            const dataUrl = captureCanvas();
            if (!dataUrl) {
              return { ok: false, error: 'No image to export' };
            }
            return window.electronAPI.export.saveScreenshot(
              dataUrl,
              `viewport-${timestamp}.png`,
            );
          })();
      if (result.ok) {
        setToast({ message: 'Image saved successfully', type: 'success' });
      } else if (result.error) {
        setToast({ message: `Save failed: ${result.error}`, type: 'error' });
      }
      // If !ok and no error, user cancelled — no toast
    } catch (err) {
      setToast({ message: 'Save failed', type: 'error' });
      console.error('[ExportDropdown] saveImage error:', err);
    } finally {
      setBusy(false);
    }
  }, [captureCanvas, getActivePanelBounds]);

  const handleCopyClipboard = useCallback(async () => {
    setBusy(true);
    setOpen(false);
    try {
      const dataUrl = captureCanvas();
      if (!dataUrl) {
        setToast({ message: 'No image to copy', type: 'error' });
        return;
      }
      const result = await window.electronAPI.export.copyToClipboard(dataUrl);
      if (result.ok) {
        setToast({ message: 'Copied to clipboard', type: 'success' });
      } else {
        setToast({ message: result.error ?? 'Copy failed', type: 'error' });
      }
    } catch (err) {
      setToast({ message: 'Copy failed', type: 'error' });
      console.error('[ExportDropdown] copyClipboard error:', err);
    } finally {
      setBusy(false);
    }
  }, [captureCanvas]);

  const handleSaveAllSlices = useCallback(async () => {
    setBusy(true);
    setOpen(false);
    try {
      const viewport = viewportService.getViewport(activeViewportId);
      if (!viewport) {
        setToast({ message: 'No active viewport', type: 'error' });
        return;
      }

      const imageIds = viewport.getImageIds();
      if (!imageIds || imageIds.length === 0) {
        setToast({ message: 'No images to export', type: 'error' });
        return;
      }

      const originalIndex = viewport.getCurrentImageIdIndex();
      const slices: Array<{ dataUrl: string; filename: string }> = [];
      const padLen = String(imageIds.length).length;

      setProgress(`Capturing 0/${imageIds.length}...`);

      // Capture each slice by scrolling to it
      for (let i = 0; i < imageIds.length; i++) {
        await viewport.setImageIdIndex(i);
        viewport.render();

        // Small delay to allow render to complete
        await new Promise((r) => setTimeout(r, 50));

        const canvas = viewport.getCanvas();
        const dataUrl = canvas.toDataURL('image/png');
        const num = String(i + 1).padStart(padLen, '0');
        slices.push({ dataUrl, filename: `slice-${num}.png` });

        if (i % 10 === 0 || i === imageIds.length - 1) {
          setProgress(`Capturing ${i + 1}/${imageIds.length}...`);
        }
      }

      // Restore original position
      await viewport.setImageIdIndex(originalIndex);
      viewport.render();

      setProgress('Saving files...');

      const result = await window.electronAPI.export.saveAllSlices(slices);
      if (result.ok) {
        setToast({ message: `Saved ${result.count} slices`, type: 'success' });
      } else if (result.error) {
        setToast({ message: `Save failed: ${result.error}`, type: 'error' });
      }
    } catch (err) {
      setToast({ message: 'Export failed', type: 'error' });
      console.error('[ExportDropdown] saveAllSlices error:', err);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [activeViewportId]);

  const handleSaveDicom = useCallback(async () => {
    setBusy(true);
    setOpen(false);
    try {
      const viewport = viewportService.getViewport(activeViewportId);
      if (!viewport) {
        setToast({ message: 'No active viewport', type: 'error' });
        return;
      }

      const imageId = viewport.getCurrentImageId();
      if (!imageId) {
        setToast({ message: 'No image loaded', type: 'error' });
        return;
      }

      // Get raw DICOM bytes from the dataSet cache
      const uri = imageId.replace('wadouri:', '');
      const dataSet = wadouri.dataSetCacheManager.get(uri);

      if (!dataSet?.byteArray) {
        setToast({ message: 'DICOM data not available', type: 'error' });
        return;
      }

      const base64 = arrayBufferToBase64(dataSet.byteArray.buffer);
      const result = await window.electronAPI.export.saveDicom(base64);

      if (result.ok) {
        setToast({ message: 'DICOM file saved', type: 'success' });
      } else if (result.error) {
        setToast({ message: `Save failed: ${result.error}`, type: 'error' });
      }
    } catch (err) {
      setToast({ message: 'Save failed', type: 'error' });
      console.error('[ExportDropdown] saveDicom error:', err);
    } finally {
      setBusy(false);
    }
  }, [activeViewportId]);

  const handleExportAnnotations = useCallback(async () => {
    setBusy(true);
    setOpen(false);
    try {
      const annotations = useAnnotationStore.getState().annotations;
      if (annotations.length === 0) {
        setToast({ message: 'No annotations to export', type: 'error' });
        return;
      }

      // Build CSV content
      const lines: string[] = [
        'Tool,Measurement,Label',
        ...annotations.map((a) => {
          const measurement = a.displayText.replace(/,/g, ';');
          const label = a.label.replace(/,/g, ';');
          return `${a.displayName},${measurement},${label}`;
        }),
      ];
      const csv = lines.join('\n');

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const result = await window.electronAPI.export.saveReport(
        csv,
        `annotations-${timestamp}.csv`,
      );

      if (result.ok) {
        setToast({ message: `Exported ${annotations.length} annotations`, type: 'success' });
      } else if (result.error) {
        setToast({ message: `Export failed: ${result.error}`, type: 'error' });
      }
    } catch (err) {
      setToast({ message: 'Export failed', type: 'error' });
      console.error('[ExportDropdown] exportAnnotations error:', err);
    } finally {
      setBusy(false);
    }
  }, []);

  const handleAction = useCallback(
    (actionId: string) => {
      switch (actionId) {
        case 'save-image':
          handleSaveImage();
          break;
        case 'copy-clipboard':
          handleCopyClipboard();
          break;
        case 'save-all-slices':
          handleSaveAllSlices();
          break;
        case 'save-dicom':
          handleSaveDicom();
          break;
        case 'export-annotations':
          handleExportAnnotations();
          break;
      }
    },
    [handleSaveImage, handleCopyClipboard, handleSaveAllSlices, handleSaveDicom, handleExportAnnotations],
  );

  return (
    <>
      {/* Trigger button — icon-only */}
      <button
        ref={buttonRef}
        onClick={handleToggle}
        disabled={busy}
        className={`flex items-center justify-center p-1.5 rounded transition-colors ${
          open
            ? 'bg-blue-600 text-white'
            : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
        } ${busy ? 'opacity-50 cursor-wait' : ''}`}
        title={progress ?? 'Export'}
      >
        <IconExportFile className="w-3.5 h-3.5" />
      </button>

      {/* Dropdown panel — fixed position to escape toolbar overflow clipping */}
      {open && (
        <div
          ref={dropdownRef}
          className="fixed z-50 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-1.5 min-w-[220px]"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          {EXPORT_ACTIONS.map((action) => (
            <div key={action.id}>
              {action.separator && (
                <div className="h-px bg-zinc-700 my-1" />
              )}
              <button
                onClick={() => handleAction(action.id)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded text-left transition-colors text-zinc-300 hover:bg-zinc-700 hover:text-white"
              >
                {action.icon}
                <div>
                  <div className="text-xs font-medium">{action.label}</div>
                  <div className="text-[10px] text-zinc-500">{action.description}</div>
                </div>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Toast notification */}
      {toast && <Toast toast={toast} />}
    </>
  );
}
