/**
 * HelpModal — Quick Start Guide modal.
 *
 * Mirrors the SettingsModal layout: left sidebar with grouped tabs,
 * right scrollable content pane. Content is defined in helpGuideContent.tsx.
 */
import { useState, useEffect } from 'react';
import { IconClose } from '../icons';
import { GUIDE_SECTIONS, GUIDE_GROUPS } from './helpGuideContent';

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
}

export default function HelpModal({ open, onClose }: HelpModalProps) {
  const [activeSection, setActiveSection] = useState(GUIDE_SECTIONS[0].id);

  // Dismiss on Escape
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const current = GUIDE_SECTIONS.find((s) => s.id === activeSection) ?? GUIDE_SECTIONS[0];

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close guide"
        className="absolute inset-0 bg-zinc-950/70"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-4xl h-[min(80vh,560px)] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden flex">
        {/* Sidebar */}
        <div className="w-44 border-r border-zinc-800 bg-zinc-950/50 flex flex-col overflow-hidden">
          <div className="px-3 py-2.5 text-[11px] uppercase tracking-wide text-zinc-500 shrink-0">
            Quick Start Guide
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
            {GUIDE_GROUPS.map((group) => {
              const sections = GUIDE_SECTIONS.filter((s) => s.group === group);
              if (sections.length === 0) return null;
              return (
                <div key={group}>
                  <div className="px-1 pt-1.5 pb-1 text-[10px] uppercase tracking-wider text-zinc-600 font-medium">
                    {group}
                  </div>
                  <div className="space-y-0.5">
                    {sections.map((section) => (
                      <button
                        key={section.id}
                        type="button"
                        onClick={() => setActiveSection(section.id)}
                        className={`w-full text-left px-2.5 py-1.5 rounded text-xs transition-colors ${
                          activeSection === section.id
                            ? 'bg-blue-600/20 text-blue-300'
                            : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                        }`}
                      >
                        {section.title}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Content area */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Header */}
          <div className="h-11 shrink-0 border-b border-zinc-800 px-4 flex items-center justify-between">
            <h2 className="text-sm font-medium text-zinc-100">{current.title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              title="Close"
            >
              <IconClose className="w-4 h-4" />
            </button>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto p-4">
            {current.content}
          </div>
        </div>
      </div>
    </div>
  );
}
