import { create } from 'zustand';

type DialogKind = 'confirm' | 'alert';
type DialogTone = 'default' | 'danger';

interface DialogRequest {
  id: number;
  kind: DialogKind;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: DialogTone;
}

interface DialogStore {
  active: DialogRequest | null;
  queue: DialogRequest[];
  enqueue: (request: DialogRequest) => void;
  resolveActive: (confirmed: boolean) => void;
}

interface ConfirmDialogOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
}

interface AlertDialogOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
}

const resolvers = new Map<number, (result: boolean) => void>();
let nextDialogId = 1;

export const useDialogStore = create<DialogStore>((set, get) => ({
  active: null,
  queue: [],

  enqueue: (request) =>
    set((state) => {
      if (!state.active) {
        return { ...state, active: request };
      }
      return { ...state, queue: [...state.queue, request] };
    }),

  resolveActive: (confirmed) => {
    const { active, queue } = get();
    if (!active) return;

    const resolver = resolvers.get(active.id);
    if (resolver) {
      resolver(confirmed);
      resolvers.delete(active.id);
    }

    const [next, ...rest] = queue;
    set({
      active: next ?? null,
      queue: rest,
    });
  },
}));

export function showConfirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const id = nextDialogId++;
    resolvers.set(id, resolve);
    useDialogStore.getState().enqueue({
      id,
      kind: 'confirm',
      title: options.title ?? 'Confirm Action',
      message: options.message,
      confirmLabel: options.confirmLabel ?? 'Confirm',
      cancelLabel: options.cancelLabel ?? 'Cancel',
      tone: options.tone ?? 'default',
    });
  });
}

export function showAlertDialog(options: AlertDialogOptions): Promise<void> {
  return new Promise((resolve) => {
    const id = nextDialogId++;
    resolvers.set(id, () => resolve());
    useDialogStore.getState().enqueue({
      id,
      kind: 'alert',
      title: options.title ?? 'Notice',
      message: options.message,
      confirmLabel: options.confirmLabel ?? 'OK',
      cancelLabel: 'Cancel',
      tone: 'default',
    });
  });
}
