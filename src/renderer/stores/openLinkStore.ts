/**
 * A link waiting for sign-in to its server (useOpenLink). The login form prefills that server;
 * the session opens once a sign-in to it succeeds, and any other sign-in drops the link.
 */
import { create } from 'zustand';
import type { OpenLinkRequest } from '@shared/openLink';

interface OpenLinkStore {
  pending: OpenLinkRequest | null;
  setPending: (link: OpenLinkRequest | null) => void;
}

export const useOpenLinkStore = create<OpenLinkStore>((set) => ({
  pending: null,
  setPending: (pending) => set({ pending }),
}));
