/**
 * Each Segmentation tool family's last-used tool (annotation-panel-modes): clicking a family
 * button re-activates the mode the user last chose in it, however that tool was reached
 * (a mode button, a hotkey). Session-only.
 */
import { create } from 'zustand';

interface ToolFamilyState {
  last: Partial<Record<string, string>>;
  remember: (familyId: string, toolId: string) => void;
}

export const useToolFamilyStore = create<ToolFamilyState>((set) => ({
  last: {},
  remember: (familyId, toolId) => set((s) => (s.last[familyId] === toolId ? s : { last: { ...s.last, [familyId]: toolId } })),
}));
