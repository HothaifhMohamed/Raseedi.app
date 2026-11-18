import { useEffect, useLayoutEffect } from 'react';
import type { DependencyList, RefObject } from 'react';

export interface ScrollableTarget {
  scrollTop: number;
  scrollTo?: (options: ScrollToOptions) => void;
  parentElement?: ScrollableTarget | null;
}

/**
 * Resets scrollTop to 0 for the window, document root, target container, and
 * any scrollable ancestor containers without triggering smooth scroll lag.
 */
export function resetElementAndAncestorsScroll(target: ScrollableTarget | null | undefined): void {
  let cursor: ScrollableTarget | null | undefined = target;
  const visited = new Set<ScrollableTarget>();

  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    if (cursor.scrollTop !== 0) {
      cursor.scrollTop = 0;
    }
    if (typeof cursor.scrollTo === 'function') {
      try {
        cursor.scrollTo({ top: 0, behavior: 'instant' });
      } catch {
        cursor.scrollTop = 0;
      }
    }
    cursor = cursor.parentElement;
  }
}

export function resetScrollToTop(container?: HTMLElement | null): void {
  if (typeof window !== 'undefined') {
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    } catch {
      window.scrollTo(0, 0);
    }
  }

  if (typeof document !== 'undefined') {
    if (document.documentElement) {
      document.documentElement.scrollTop = 0;
    }
    if (document.body) {
      document.body.scrollTop = 0;
    }
  }

  if (container) {
    resetElementAndAncestorsScroll(container);
  }
}

/**
 * Forces window and any scrollable container ref to open at the very top
 * immediately on mount (and whenever dependencies change).
 */
export function useScrollToTop(
  containerRef?: RefObject<HTMLElement | null>,
  deps: DependencyList = []
): void {
  useLayoutEffect(() => {
    resetScrollToTop(containerRef?.current ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    resetScrollToTop(containerRef?.current ?? null);
    const rafId =
      typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame(() => {
            resetScrollToTop(containerRef?.current ?? null);
          })
        : null;

    return () => {
      if (rafId !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(rafId);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
