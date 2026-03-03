export type EventListenerLike = EventListenerOrEventListenerObject;

interface ListenerEntry {
  type: string;
  listener: EventListenerLike;
}

function invokeListener(listener: EventListenerLike, event: Event): void {
  if (typeof listener === 'function') {
    listener(event);
    return;
  }
  listener.handleEvent(event);
}

export class FakeEventTarget {
  private readonly listeners = new Map<string, Set<EventListenerLike>>();

  addEventListener(type: string, listener: EventListenerLike | null): void {
    if (!listener) return;
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)?.add(listener);
  }

  removeEventListener(type: string, listener: EventListenerLike | null): void {
    if (!listener) return;
    const set = this.listeners.get(type);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) {
      this.listeners.delete(type);
    }
  }

  dispatch(type: string, detail?: unknown): void {
    const event = { type, detail } as Event & { detail?: unknown };
    const set = this.listeners.get(type);
    if (!set || set.size === 0) return;
    for (const listener of Array.from(set)) {
      invokeListener(listener, event);
    }
  }

  listenerCount(type?: string): number {
    if (type) {
      return this.listeners.get(type)?.size ?? 0;
    }
    let count = 0;
    for (const set of this.listeners.values()) {
      count += set.size;
    }
    return count;
  }

  hasListener(type: string, listener: EventListenerLike): boolean {
    return this.listeners.get(type)?.has(listener) ?? false;
  }

  listListeners(): ListenerEntry[] {
    const entries: ListenerEntry[] = [];
    for (const [type, set] of this.listeners.entries()) {
      for (const listener of set.values()) {
        entries.push({ type, listener });
      }
    }
    return entries;
  }

  clear(): void {
    this.listeners.clear();
  }
}
