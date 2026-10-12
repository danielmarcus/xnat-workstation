/**
 * Closing an operation in the Operations section (SegWorks parity D1, amended 2026-10-12),
 * shared by every operation's hook so they all behave alike: closing with a preview pending
 * asks first, inline in the operation (expanding it if collapsed, so the question is on
 * screen); otherwise the preview, any stale-preview notice and the operation go away.
 */
import { clearStaleNotice, discardPreview } from '../lib/cornerstone/maskPreview';
import { useMaskPreviewStore } from '../stores/maskPreviewStore';
import { useOperationSheetStore } from '../stores/operationSheetStore';

/** The status line's text when the last preview was discarded because its segment changed. */
export const STALE_PREVIEW_MESSAGE = 'Preview discarded: the segment changed';

export function closeOperation(): void {
  const preview = useMaskPreviewStore.getState();
  const sheet = useOperationSheetStore.getState();
  if (preview.active && !preview.readOnly) {
    sheet.setCollapsed(false);
    sheet.setConfirmingLeave(true);
    return;
  }
  confirmCloseOperation();
}

export function confirmCloseOperation(): void {
  discardPreview();
  clearStaleNotice();
  useOperationSheetStore.getState().closeSheet();
}
