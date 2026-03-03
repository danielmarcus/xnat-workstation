interface DispatchKeyOptions {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  target?: EventTarget;
  targetTag?: 'INPUT' | 'TEXTAREA' | 'SELECT';
  isContentEditable?: boolean;
}

export function makeInputTarget(tag: 'INPUT' | 'TEXTAREA' | 'SELECT' = 'INPUT'): HTMLElement {
  const element = document.createElement(tag.toLowerCase()) as HTMLElement;
  document.body.appendChild(element);
  return element;
}

export function makeDivTarget(options?: { contentEditable?: boolean }): HTMLDivElement {
  const element = document.createElement('div');
  if (options?.contentEditable) {
    element.setAttribute('contenteditable', 'true');
    Object.defineProperty(element, 'isContentEditable', {
      configurable: true,
      value: true,
    });
  }
  document.body.appendChild(element);
  return element;
}

export function dispatchKey(options: DispatchKeyOptions): KeyboardEvent {
  let target: EventTarget = options.target ?? window;

  if (!options.target && options.targetTag) {
    target = makeInputTarget(options.targetTag);
  } else if (!options.target && options.isContentEditable) {
    target = makeDivTarget({ contentEditable: true });
  }

  const event = new KeyboardEvent('keydown', {
    key: options.key,
    ctrlKey: !!options.ctrl,
    shiftKey: !!options.shift,
    altKey: !!options.alt,
    metaKey: !!options.meta,
    bubbles: true,
    cancelable: true,
  });

  (target as EventTarget).dispatchEvent(event);
  return event;
}
