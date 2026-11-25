/**
 * A link waiting for sign-in to its server (useOpenLink). The login form prefills that server;
 * the session opens once a sign-in to it succeeds, and any other sign-in drops the link. It
 * survives a failed or cancelled sign-in, so trying again opens it, but not for long: a link
 * older than LINK_WAIT_MS is dropped instead of opened, and the login form can drop it at once.
 */
import { create } from 'zustand';
import type { OpenLinkRequest } from '@shared/openLink';

/** As long as a browser sign-in may take (BROWSER_LOGIN_TIMEOUT_MS). */
export const LINK_WAIT_MS = 10 * 60 * 1000;

interface OpenLinkStore {
  pending: OpenLinkRequest | null;
  /** Date.now() when `pending` was set. */
  pendingSince: number;
  setPending: (link: OpenLinkRequest | null) => void;
  /** The waiting link, or null (and dropped) when there is none or it waited too long. */
  takeFresh: (now?: number) => OpenLinkRequest | null;
}

export const useOpenLinkStore = create<OpenLinkStore>((set, get) => ({
  pending: null,
  pendingSince: 0,
  setPending: (pending) => set({ pending, pendingSince: pending ? Date.now() : 0 }),
  takeFresh: (now = Date.now()) => {
    const { pending, pendingSince } = get();
    set({ pending: null, pendingSince: 0 });
    return pending && now - pendingSince <= LINK_WAIT_MS ? pending : null;
  },
}));
