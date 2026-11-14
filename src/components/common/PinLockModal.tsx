import React, { useEffect, useState } from 'react';
import { Lock, Delete, ShieldAlert } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  verifyPin,
  getPinLockoutState,
  recordFailedPinAttempt,
  resetPinLockout,
  PinLockoutState,
} from '../../services/security';

interface PinLockModalProps {
  isOpen: boolean;
  onSuccess: () => void;
  onCancel?: () => void;
  title?: string;
  lockoutKey?: string;
  expectedPin?: string;
  expectedPinHash?: string;
  expectedPinSalt?: string;
  onVerify?: (enteredPin: string) => Promise<boolean> | boolean;
}

export const PinLockModal: React.FC<PinLockModalProps> = ({
  isOpen,
  onSuccess,
  onCancel,
  title,
  lockoutKey = 'app-pin',
  expectedPin,
  expectedPinHash,
  expectedPinSalt,
  onVerify,
}) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [lockout, setLockout] = useState<PinLockoutState>(() => getPinLockoutState(lockoutKey));
  const { settings, t } = useApp();
  const isEnglish = settings.language === 'en';

  useEffect(() => {
    if (!isOpen) return;
    setLockout(getPinLockoutState(lockoutKey));
    setPin('');
    setError(false);
  }, [isOpen, lockoutKey]);

  useEffect(() => {
    if (!isOpen || !lockout.isLocked) return;
    const timer = window.setInterval(() => {
      setLockout(getPinLockoutState(lockoutKey));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isOpen, lockout.isLocked, lockoutKey]);

  const handleDigit = async (digit: string) => {
    const currentLock = getPinLockoutState(lockoutKey);
    if (currentLock.isLocked) {
      setLockout(currentLock);
      return;
    }
    if (isVerifying || pin.length >= 4) return;

    const nextPin = pin + digit;
    setPin(nextPin);
    setError(false);

    if (nextPin.length === 4) {
      setIsVerifying(true);
      let isValid = false;

      try {
        if (onVerify) {
          isValid = await onVerify(nextPin);
        } else if (expectedPinHash) {
          isValid = await verifyPin(nextPin, expectedPinHash, expectedPinSalt);
        } else if (expectedPin) {
          isValid = await verifyPin(nextPin, expectedPin, expectedPinSalt);
        } else if (settings.appPin) {
          isValid = await verifyPin(nextPin, settings.appPin, settings.appPinSalt);
        }
      } catch (err) {
        console.error('Error verifying PIN:', err);
        isValid = false;
      }

      setIsVerifying(false);

      if (isValid) {
        resetPinLockout(lockoutKey);
        setLockout(getPinLockoutState(lockoutKey));
        setTimeout(() => {
          onSuccess();
          setPin('');
        }, 120);
      } else {
        const nextLock = recordFailedPinAttempt(lockoutKey);
        setLockout(nextLock);
        setError(true);
        setTimeout(() => {
          setPin('');
        }, 400);
      }
    }
  };

  const handleBackspace = () => {
    if (isVerifying || lockout.isLocked) return;
    setPin((prev) => prev.slice(0, -1));
    setError(false);
  };

  if (!isOpen) return null;

  const isKeypadDisabled = isVerifying || lockout.isLocked;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-bg)] p-4">
      <div className="w-full max-w-xs flex flex-col items-center text-center">
        <div
          className={`w-16 h-16 rounded-2xl border flex items-center justify-center mb-4 ${
            lockout.isLocked
              ? 'bg-[var(--color-expense)]/10 border-[var(--color-expense)]/30 text-[var(--color-expense)]'
              : 'bg-[var(--color-accent)]/10 border-[var(--color-accent)]/20 text-[var(--color-accent)]'
          }`}
        >
          <Lock className="w-8 h-8" />
        </div>

        <h2 className="text-lg font-bold text-[var(--color-ink)] mb-1">
          {title || t('enterPin')}
        </h2>
        <p className="text-xs text-[var(--color-muted)] mb-6">
          {lockout.isLocked
            ? isEnglish
              ? `Too many failed attempts. Try again in ${lockout.remainingLockSeconds}s`
              : `تم إيقاف المحاولة مؤقتاً لكثرة الأخطاء. انتظر ${lockout.remainingLockSeconds} ثانية`
            : isEnglish
            ? 'Enter your 4-digit security PIN'
            : 'أدخل رمز الحماية المكون من 4 أرقام'}
        </p>

        {/* PIN Dots */}
        <div className="flex items-center justify-center gap-4 mb-6">
          {[0, 1, 2, 3].map((idx) => {
            const isFilled = pin.length > idx;
            return (
              <div
                key={idx}
                className={`w-4 h-4 rounded-full transition-all duration-150 ${
                  error || lockout.isLocked
                    ? 'bg-[var(--color-expense)] scale-110'
                    : isFilled
                    ? 'bg-[var(--color-accent)] scale-110'
                    : 'bg-[var(--color-surface)] border border-[var(--color-line)]'
                }`}
              />
            );
          })}
        </div>

        {lockout.isLocked ? (
          <div className="flex items-center gap-1.5 text-xs text-[var(--color-expense)] font-semibold mb-4 px-3 py-2 rounded-lg bg-[var(--color-expense)]/10 border border-[var(--color-expense)]/25">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>
              {isEnglish
                ? `Locked for ${lockout.remainingLockSeconds} seconds`
                : `مقفل لمدة ${lockout.remainingLockSeconds} ثانية`}
            </span>
          </div>
        ) : (
          error && (
            <div className="flex items-center gap-1.5 text-xs text-[var(--color-expense)] mb-4 animate-shake">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>
                {t('pinIncorrect')} (
                {isEnglish
                  ? `${lockout.attemptsRemaining} tries left`
                  : `متبقي ${lockout.attemptsRemaining} محاولات`}
                )
              </span>
            </div>
          )
        )}

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-3 w-full">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
            <button
              key={digit}
              onClick={() => void handleDigit(digit)}
              disabled={isKeypadDisabled}
              className="h-14 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] text-xl font-bold text-[var(--color-ink)] hover:bg-[var(--color-bg)] active:scale-95 transition disabled:opacity-45 disabled:cursor-not-allowed"
            >
              {digit}
            </button>
          ))}
          <div className="flex items-center justify-center">
            {onCancel && (
              <button
                onClick={onCancel}
                className="text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)] py-3 min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                {t('cancel')}
              </button>
            )}
          </div>
          <button
            onClick={() => void handleDigit('0')}
            disabled={isKeypadDisabled}
            className="h-14 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] text-xl font-bold text-[var(--color-ink)] hover:bg-[var(--color-bg)] active:scale-95 transition disabled:opacity-45 disabled:cursor-not-allowed"
          >
            0
          </button>
          <button
            onClick={handleBackspace}
            disabled={isKeypadDisabled}
            className="h-14 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-bg)] active:scale-95 transition flex items-center justify-center min-h-[44px] disabled:opacity-45 disabled:cursor-not-allowed"
            aria-label="Backspace"
          >
            <Delete className="w-6 h-6" />
          </button>
        </div>
      </div>
    </div>
  );
};
