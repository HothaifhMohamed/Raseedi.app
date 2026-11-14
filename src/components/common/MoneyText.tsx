import React from 'react';
import { getCurrency, getCurrencyDecimals } from '../../services/currency';
import { toArabicNumerals } from '../../services/calculations';
import { useApp } from '../../context/AppContext';

interface MoneyTextProps {
  amount: number;
  currency?: string;
  sign?: string; // explicit sign override, e.g. '+', '−', '⇄'
  type?: 'expense' | 'income' | 'transfer';
  showSign?: boolean;
  className?: string;
  colorByType?: boolean;
}

export const MoneyText: React.FC<MoneyTextProps> = ({
  amount,
  currency = 'EGP',
  sign,
  type,
  showSign = false,
  className = '',
  colorByType = false,
}) => {
  const { settings } = useApp();
  const currencyInfo = getCurrency(currency);
  const symbol = settings.language === 'en' ? currencyInfo?.code || currency : currencyInfo?.symbol || currency;

  // Respect 3-decimal currencies (KWD, BHD, OMR, JOD, TND, LYD, IQD) and user decimal setting
  const currencyDefaultDecimals = getCurrencyDecimals(currency, 2);
  const decimals =
    settings.decimalPlaces === 2 || settings.decimalPlaces === undefined
      ? currencyDefaultDecimals
      : Math.max(0, Math.min(3, settings.decimalPlaces));

  const absVal = Math.abs(Number.isFinite(amount) ? amount : 0);
  const formattedRaw = absVal.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const formattedAmount =
    settings.digitFormat === 'arabic' ? toArabicNumerals(formattedRaw) : formattedRaw;

  let signPrefix = '';
  if (sign !== undefined) {
    signPrefix = sign;
  } else if (type === 'income') {
    signPrefix = '+';
  } else if (type === 'expense') {
    signPrefix = '−';
  } else if (type === 'transfer') {
    signPrefix = '⇄';
  } else if (amount < 0) {
    signPrefix = '−';
  } else if (showSign && amount > 0) {
    signPrefix = '+';
  }

  let colorClass = '';
  if (colorByType) {
    if (type === 'expense' || signPrefix === '−' || (!type && amount < 0)) {
      colorClass = 'text-[var(--color-expense)]';
    } else if (type === 'income' || signPrefix === '+' || (!type && amount > 0)) {
      colorClass = 'text-[var(--color-income)]';
    } else {
      colorClass = 'text-[var(--color-ink)]';
    }
  }

  return (
    <bdi dir="ltr" className={`num-tabular font-bold ${colorClass} ${className}`.trim()}>
      {signPrefix}
      {formattedAmount} {symbol}
    </bdi>
  );
};
