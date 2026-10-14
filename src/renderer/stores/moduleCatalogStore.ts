/**
 * The modules the Operations picker offers (branch 9, M4): installed or bundled, enabled, and
 * passing their checks. Filled by lib/modules/moduleCatalog — at startup and whenever Settings ›
 * Modules changes something.
 */
import { create } from 'zustand';
import type { ModuleSummary } from '@shared/modules/types';

export const useModuleCatalogStore = create<{ modules: ModuleSummary[] }>(() => ({ modules: [] }));
