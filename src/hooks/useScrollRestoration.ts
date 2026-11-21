import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject, UIEvent } from 'react';
import {
  clearScrollPositionInStorage,
  createThrottledScrollSaver,
  getBrowserSessionStorage,
  readScrollPositionFromStorage,
  saveScrollPositionToStorage,
} from '../services/scrollRestoration';

interface UseScrollRestorationOptions {
  restoreOnMount?: boolean;
  throttleMs?: number;
}

export function useScrollRestoration(
  containerRef: RefObject<HTMLElement | null>,
  storageKey: string,
  options: UseScrollRestorationOptions = {}
) {
  const { restoreOnMount = true, throttleMs = 90 } = options;
  const lastScrollTopRef = useRef<number>(0);
  const hasInteractedScrollRef = useRef<boolean>(false);

  const throttlerRef = useRef<ReturnType<typeof createThrottledScrollSaver> | null>(null);
  if (!throttlerRef.current) {
    throttlerRef.current = createThrottledScrollSaver((scrollTop) => {
      saveScrollPositionToStorage(getBrowserSessionStorage(), storageKey, scrollTop);
    }, throttleMs);
  }

  const saveScrollNow = useCallback(
    (explicitScrollTop?: number) => {
      const current =
        typeof explicitScrollTop === 'number'
          ? explicitScrollTop
          : containerRef.current
          ? containerRef.current.scrollTop
          : lastScrollTopRef.current;
      lastScrollTopRef.current = Math.max(0, Math.round(current));
      hasInteractedScrollRef.current = true;
      throttlerRef.current?.cancel();
      return saveScrollPositionToStorage(
        getBrowserSessionStorage(),
        storageKey,
        lastScrollTopRef.current
      );
    },
    [containerRef, storageKey]
  );

  const restoreScrollNow = useCallback((): number => {
    const saved = readScrollPositionFromStorage(getBrowserSessionStorage(), storageKey);
    const el = containerRef.current;
    if (!el) return saved;
    if (saved > 0) {
      el.scrollTop = saved;
      lastScrollTopRef.current = saved;
    }
    return saved;
  }, [containerRef, storageKey]);

  const clearSavedScroll = useCallback(() => {
    lastScrollTopRef.current = 0;
    hasInteractedScrollRef.current = false;
    throttlerRef.current?.cancel();
    clearScrollPositionInStorage(getBrowserSessionStorage(), storageKey);
  }, [storageKey]);

  const handleScroll = useCallback((e: UIEvent<HTMLElement>) => {
    const top = e.currentTarget.scrollTop;
    lastScrollTopRef.current = top;
    hasInteractedScrollRef.current = true;
    throttlerRef.current?.save(top);
  }, []);

  // Immediate layout restoration on mount prevents flash-at-top before paint
  useLayoutEffect(() => {
    if (!restoreOnMount) return;
    restoreScrollNow();
  }, [restoreOnMount, restoreScrollNow]);

  // Follow-up post-mount restoration (rAF for async/grid height layout)
  useEffect(() => {
    let rafId: number | null = null;
    if (restoreOnMount) {
      const saved = restoreScrollNow();
      if (
        saved > 0 &&
        typeof window !== 'undefined' &&
        typeof window.requestAnimationFrame === 'function'
      ) {
        rafId = window.requestAnimationFrame(() => {
          restoreScrollNow();
        });
      }
    }

    return () => {
      if (rafId !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(rafId);
      }
      throttlerRef.current?.cancel();
      // Only persist scroll position on unmount if user actually scrolled or a non-zero offset was restored,
      // preventing hydration unmounts from clobbering saved scroll positions with 0.
      if (hasInteractedScrollRef.current || lastScrollTopRef.current > 0) {
        saveScrollPositionToStorage(
          getBrowserSessionStorage(),
          storageKey,
          lastScrollTopRef.current
        );
      }
    };
  }, [restoreOnMount, restoreScrollNow, storageKey]);

  return {
    handleScroll,
    saveScrollNow,
    restoreScrollNow,
    clearSavedScroll,
  };
}
