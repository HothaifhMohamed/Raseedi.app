import React, { useMemo } from 'react';
import { Delete, Check } from 'lucide-react';
import { evaluateCalculatorExpression, toArabicNumerals } from '../services/calculations';
import { useApp } from '../context/AppContext';

interface CalculatorKeypadProps {
  expression: string;
  onChange: (val: string) => void;
  currencyCode: string;
  onOpenCurrencyPicker: () => void;
  onDone?: () => void;
}

export const CalculatorKeypad: React.FC<CalculatorKeypadProps> = ({
  expression,
  onChange,
  currencyCode,
  onOpenCurrencyPicker,
  onDone,
}) => {
  const { settings } = useApp();

  const preview = useMemo(() => {
    return evaluateCalculatorExpression(expression);
  }, [expression]);

  const handleKeyPress = (btn: string) => {
    if (btn === 'C') {
      onChange('');
    } else if (btn === '⌫') {
      onChange(expression.slice(0, -1));
    } else if (btn === '=') {
      if (!preview.error && preview.result > 0) {
        onChange(String(preview.result));
      }
    } else {
      onChange(expression + btn);
    }
  };

  const formattedDisplay = settings.digitFormat === 'arabic' ? toArabicNumerals(expression || '0') : (expression || '0');
  const formattedPreview = settings.digitFormat === 'arabic' ? toArabicNumerals(preview.result) : preview.result;

  return (
    <div className="w-full bg-[var(--color-surface)] border border-[var(--color-line)] rounded-xl p-3 flex flex-col gap-2.5">
      {/* Top Display Area */}
      <div className="flex items-center justify-between px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-lg">
        <button
          type="button"
          onClick={onOpenCurrencyPicker}
          className="flex items-center gap-1.5 px-2.5 py-1 bg-[var(--color-accent)]/10 hover:bg-[var(--color-accent)]/20 text-[var(--color-accent)] font-semibold rounded-md text-xs transition border border-[var(--color-accent)]/30 min-h-[32px]"
        >
          <span>{currencyCode}</span>
        </button>

        <div className="text-right">
          <div className="text-xl font-bold text-[var(--color-ink)] font-mono tracking-tight">
            {formattedDisplay}
          </div>
          {expression && (expression.includes('+') || expression.includes('−') || expression.includes('×') || expression.includes('÷')) && (
            <div className="text-xs text-[var(--color-accent)] font-medium">
              = {formattedPreview}
            </div>
          )}
        </div>
      </div>

      {/* Keypad Grid */}
      <div className="grid grid-cols-4 gap-1.5 select-none">
        {/* Row 1 */}
        <button
          type="button"
          onClick={() => handleKeyPress('(')}
          className="h-11 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-ink)] font-bold active:scale-95 transition"
        >
          (
        </button>
        <button
          type="button"
          onClick={() => handleKeyPress(')')}
          className="h-11 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-ink)] font-bold active:scale-95 transition"
        >
          )
        </button>
        <button
          type="button"
          onClick={() => handleKeyPress('C')}
          className="h-11 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-expense)] font-bold active:scale-95 transition"
        >
          C
        </button>
        <button
          type="button"
          onClick={() => handleKeyPress('÷')}
          className="h-11 rounded-lg bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30 text-[var(--color-accent)] font-bold hover:bg-[var(--color-accent)]/20 active:scale-95 transition text-lg"
        >
          ÷
        </button>

        {/* Row 2 */}
        <button
          type="button"
          onClick={() => handleKeyPress('7')}
          className="h-11 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-ink)] font-bold text-lg hover:bg-[var(--color-surface)] active:scale-95 transition"
        >
          7
        </button>
        <button
          type="button"
          onClick={() => handleKeyPress('8')}
          className="h-11 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-ink)] font-bold text-lg hover:bg-[var(--color-surface)] active:scale-95 transition"
        >
          8
        </button>
        <button
          type="button"
          onClick={() => handleKeyPress('9')}
          className="h-11 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-ink)] font-bold text-lg hover:bg-[var(--color-surface)] active:scale-95 transition"
        >
          9
        </button>
        <button
          type="button"
          onClick={() => handleKeyPress('×')}
          className="h-11 rounded-lg bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30 text-[var(--color-accent)] font-bold hover:bg-[var(--color-accent)]/20 active:scale-95 transition text-lg"
        >
          ×
        </button>

        {/* Row 3 */}
        <button
          type="button"
          onClick={() => handleKeyPress('4')}
          className="h-11 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-ink)] font-bold text-lg hover:bg-[var(--color-surface)] active:scale-95 transition"
        >
          4
        </button>
        <button
          type="button"
          onClick={() => handleKeyPress('5')}
          className="h-11 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-ink)] font-bold text-lg hover:bg-[var(--color-surface)] active:scale-95 transition"
        >
          5
        </button>
        <button
          type="button"
          onClick={() => handleKeyPress('6')}
          className="h-11 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-ink)] font-bold text-lg hover:bg-[var(--color-surface)] active:scale-95 transition"
        >
          6
        </button>
        <button
          type="button"
          onClick={() => handleKeyPress('−')}
          className="h-11 rounded-lg bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30 text-[var(--color-accent)] font-bold hover:bg-[var(--color-accent)]/20 active:scale-95 transition text-lg"
        >
          −
        </button>

        {/* Row 4 */}
        <button
          type="button"
          onClick={() => handleKeyPress('1')}
          className="h-11 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-ink)] font-bold text-lg hover:bg-[var(--color-surface)] active:scale-95 transition"
        >
          1
        </button>
        <button
          type="button"
          onClick={() => handleKeyPress('2')}
          className="h-11 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-ink)] font-bold text-lg hover:bg-[var(--color-surface)] active:scale-95 transition"
        >
          2
        </button>
        <button
          type="button"
          onClick={() => handleKeyPress('3')}
          className="h-11 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-ink)] font-bold text-lg hover:bg-[var(--color-surface)] active:scale-95 transition"
        >
          3
        </button>
        <button
          type="button"
          onClick={() => handleKeyPress('+')}
          className="h-11 rounded-lg bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30 text-[var(--color-accent)] font-bold hover:bg-[var(--color-accent)]/20 active:scale-95 transition text-lg"
        >
          +
        </button>

        {/* Row 5 */}
        <button
          type="button"
          onClick={() => handleKeyPress('.')}
          className="h-11 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-ink)] font-bold text-lg hover:bg-[var(--color-surface)] active:scale-95 transition"
        >
          .
        </button>
        <button
          type="button"
          onClick={() => handleKeyPress('0')}
          className="h-11 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-ink)] font-bold text-lg hover:bg-[var(--color-surface)] active:scale-95 transition"
        >
          0
        </button>
        <button
          type="button"
          onClick={() => handleKeyPress('⌫')}
          className="h-11 rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-ink)] active:scale-95 transition flex items-center justify-center"
          aria-label="Backspace"
        >
          <Delete className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={() => {
            handleKeyPress('=');
            if (onDone) onDone();
          }}
          className="h-11 rounded-lg bg-[var(--color-accent)] hover:opacity-90 text-[var(--color-on-accent)] font-bold active:scale-95 transition flex items-center justify-center shadow-xs"
          aria-label="Calculate / Done"
        >
          <Check className="w-5 h-5 stroke-[3]" />
        </button>
      </div>
    </div>
  );
};
