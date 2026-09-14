/**
 * CollapsibleGroup — a group of toolbar items that folds into a single dropdown
 * trigger when the toolbar is too narrow.
 *
 * BOTH the inline items and the trigger are always rendered; which one is visible is
 * decided by CSS from `data-collapsed-groups` on the toolbar root (see globals.css).
 * This used to be conditional rendering, but then the collapsed level's content did not
 * exist in the DOM and its width could not be measured — which forced the collapse
 * thresholds to be hardcoded. Keeping both in the tree lets useToolbarCollapse measure
 * every level synchronously, so the thresholds derive themselves.
 *
 * Collapsed content is hidden with `display: none`, so it leaves the accessibility tree
 * and the tab order rather than being merely invisible.
 */
import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { IconChevronDown } from '../icons';

interface CollapsibleGroupProps {
  /** Group id — must match the ids in GROUP_COLLAPSE_LEVELS / the CSS selectors. */
  groupId: string;
  /** Whether this group is currently collapsed. Drives BEHAVIOUR (does the trigger open
   *  a dropdown, is a stale dropdown closed); visibility itself is CSS's job. */
  collapsed: boolean;
  /** Representative icon shown on the dropdown trigger */
  triggerIcon: ReactNode;
  /** Tooltip for the dropdown trigger */
  triggerTitle: string;
  children: ReactNode;
}

export default function CollapsibleGroup({
  groupId,
  collapsed,
  triggerIcon,
  triggerTitle,
  children,
}: CollapsibleGroupProps) {
  const [open, setOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close when un-collapsed (e.g. window widened)
  useEffect(() => {
    if (!collapsed) setOpen(false);
  }, [collapsed]);

  // Click-outside handler
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        buttonRef.current?.contains(e.target as Node) ||
        dropdownRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleToggle = useCallback(() => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const dropdownWidth = 240;
      const maxLeft = window.innerWidth - dropdownWidth - 8;
      setDropdownPos({ top: rect.bottom + 4, left: Math.min(rect.left, maxLeft) });
    }
    setOpen((v) => !v);
  }, [open]);

  return (
    <>
      {/* Inline items — hidden by CSS when this group is collapsed. */}
      <span data-group-inline={groupId} className="flex items-center gap-1">
        {children}
      </span>

      <button
        ref={buttonRef}
        data-group-trigger={groupId}
        onClick={handleToggle}
        title={triggerTitle}
        className={`flex items-center gap-0.5 px-2 py-1.5 rounded transition-colors shrink-0 ${
          open ? 'bg-blue-600 text-white' : 'text-zinc-300 hover:bg-zinc-800'
        }`}
      >
        {triggerIcon}
        <IconChevronDown className="w-2.5 h-2.5" />
      </button>

      {collapsed && open && (
        <div
          ref={dropdownRef}
          className="fixed z-50 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-1.5 min-w-[180px]"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          <div className="flex flex-col gap-0.5">
            {children}
          </div>
        </div>
      )}
    </>
  );
}
