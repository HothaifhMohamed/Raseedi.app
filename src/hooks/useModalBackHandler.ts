import { useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';

/**
 * Registers an open modal overlay with the browser history back stack so
 * hardware/browser Back closes the topmost modal instead of leaving the screen.
 */
export function useModalBackHandler(
  isOpen: boolean,
  onClose: () => void,
  modalId: string
): void {
  const { registerModalBackHandler, unregisterModalBackHandler } = useApp();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    registerModalBackHandler(modalId, () => onCloseRef.current());
    return () => {
      unregisterModalBackHandler(modalId);
    };
  }, [isOpen, modalId, registerModalBackHandler, unregisterModalBackHandler]);
}
