/**
 * CollapsibleGroup — wraps a group of toolbar items that can collapse into a
 * single dropdown trigger when the toolbar is too narrow.
 *
 * When not collapsed, renders children inline (no wrapper element).
 * When collapsed, renders a button with the group's representative icon that
 * opens a vertical dropdown menu containing all group items.
 */
import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { IconChevronDown } from '../icons';

interface CollapsibleGroupProps {
  /** Whether this group is currently collapsed into a dropdown */
  collapsed: boolean;
  /** Representative icon shown on the dropdown trigger */
  triggerIcon: ReactNode;
  /** Tooltip for the dropdown trigger */
  triggerTitle: string;
  children: ReactNode;
}

export default function CollapsibleGroup({
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

  if (!collapsed) return <>{children}</>;

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleToggle}
        title={triggerTitle}
        className={`flex items-center gap-0.5 p-1.5 rounded transition-colors ${
          open
            ? 'bg-blue-600 text-white'
            : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
        }`}
      >
        {triggerIcon}
        <IconChevronDown className="w-2.5 h-2.5" />
      </button>

      {open && (
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
