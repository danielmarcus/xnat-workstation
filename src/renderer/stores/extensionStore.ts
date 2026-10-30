/** The edition's extensions as the main process last reported them (extension framework X1). */
import { create } from 'zustand';
import type { ExtensionSummary } from '@shared/extensions/types';

interface ExtensionStore {
  extensions: ExtensionSummary[];
  setExtensions: (extensions: ExtensionSummary[]) => void;
}

export const useExtensionStore = create<ExtensionStore>((set) => ({
  extensions: [],
  setExtensions: (extensions) => set({ extensions }),
}));
