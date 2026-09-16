/**
 * Mount point for the leave-with-unsaved-work prompt (proposal §4.2). Renders whenever
 * leaveGuard has a pending decision; the store owns the save-and-retry loop, so this is
 * a pure projection of it.
 */
import { LeaveUnsavedDialog } from '../annotations/dialogs';
import { useLeavePromptStore } from '../../stores/leavePromptStore';

export default function LeavePromptHost() {
  const request = useLeavePromptStore((s) => s.request);
  const busy = useLeavePromptStore((s) => s.busy);
  const error = useLeavePromptStore((s) => s.error);
  const choose = useLeavePromptStore((s) => s.choose);

  if (!request) return null;
  return (
    <LeaveUnsavedDialog
      entries={request.entries}
      leavingLabel={request.leavingLabel}
      busy={busy}
      error={error ?? undefined}
      onSave={() => choose('save')}
      onDiscard={() => choose('discard')}
      onCancel={() => choose('cancel')}
    />
  );
}
