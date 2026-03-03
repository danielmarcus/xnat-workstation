import { useCallback, useEffect, useRef, useState } from 'react';

export function useUnsavedNavigationDialog(onDiscard: () => void) {
  const [open, setOpen] = useState(false);
  const resolverRef = useRef<((proceed: boolean) => void) | null>(null);

  const resolve = useCallback((proceed: boolean) => {
    if (proceed) {
      onDiscard();
    }
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setOpen(false);
    resolver?.(proceed);
  }, [onDiscard]);

  const prompt = useCallback(async (): Promise<boolean> => {
    if (resolverRef.current) {
      resolverRef.current(false);
      resolverRef.current = null;
    }
    return new Promise<boolean>((resolvePromise) => {
      resolverRef.current = resolvePromise;
      setOpen(true);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (resolverRef.current) {
        resolverRef.current(false);
        resolverRef.current = null;
      }
    };
  }, []);

  return {
    open,
    prompt,
    resolve,
  };
}
