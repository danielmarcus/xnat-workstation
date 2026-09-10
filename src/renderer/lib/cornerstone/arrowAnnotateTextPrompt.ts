/**
 * Arrow-annotation label prompt.
 *
 * ArrowAnnotateTool asks for a label when an arrow is completed. Cornerstone's default
 * callback calls window.prompt(), which Electron blocks — and the tool DELETES the
 * annotation when the callback yields no label, so the stock path is unusable here.
 * This is the DOM-overlay replacement.
 *
 * It lives in its own module (rather than inside toolService) because both the legacy
 * tool group and the unified one need it: the unified group added ArrowAnnotateTool
 * with no configuration, so completing an arrow there showed no prompt at all and the
 * label could never be entered (found 2026-09 — e2e spec 79).
 */
export function arrowAnnotateTextCallback(
  doneChangingTextCallback: (label: string) => void,
): void {
  // Create overlay + input
  const overlay = document.createElement('div');
  overlay.dataset.testid = 'arrow-label-prompt';
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5)';

  const container = document.createElement('div');
  container.style.cssText =
    'background:#18181b;border:1px solid #3f3f46;border-radius:8px;padding:16px;min-width:280px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5)';

  const label = document.createElement('div');
  label.textContent = 'Enter annotation label:';
  label.style.cssText = 'color:#d4d4d8;font-size:13px;margin-bottom:8px';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Annotation';
  input.style.cssText =
    'width:100%;padding:6px 10px;background:#27272a;border:1px solid #3f3f46;border-radius:4px;color:#fafafa;font-size:13px;outline:none;box-sizing:border-box';

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;margin-top:12px;justify-content:flex-end';

  const btnCancel = document.createElement('button');
  btnCancel.textContent = 'Cancel';
  btnCancel.style.cssText =
    'padding:4px 14px;border-radius:4px;font-size:12px;background:#3f3f46;color:#d4d4d8;border:none;cursor:pointer';

  const btnOk = document.createElement('button');
  btnOk.textContent = 'OK';
  btnOk.style.cssText =
    'padding:4px 14px;border-radius:4px;font-size:12px;background:#2563eb;color:white;border:none;cursor:pointer';

  container.appendChild(label);
  container.appendChild(input);
  btnRow.appendChild(btnCancel);
  btnRow.appendChild(btnOk);
  container.appendChild(btnRow);
  overlay.appendChild(container);
  document.body.appendChild(overlay);

  function finish(value: string) {
    document.body.removeChild(overlay);
    doneChangingTextCallback(value);
  }

  btnOk.addEventListener('click', () => finish(input.value || 'Arrow'));
  btnCancel.addEventListener('click', () => finish(''));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(input.value || 'Arrow');
    if (e.key === 'Escape') finish('');
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) finish('');
  });

  // Focus input after a tick (DOM needs to settle)
  requestAnimationFrame(() => input.focus());
}
