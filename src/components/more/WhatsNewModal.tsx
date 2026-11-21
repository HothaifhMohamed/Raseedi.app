/**
 * Bilingual "What's New" (ما الجديد) changelog modal highlighting recent practical improvements.
 */
import React from 'react';
import {
  Sparkles,
  X,
  Landmark,
  Wand2,
  LayoutGrid,
  SlidersHorizontal,
  TrendingUp,
  Palette,
} from 'lucide-react';

interface WhatsNewModalProps {
  isOpen: boolean;
  onClose: () => void;
  isRTL: boolean;
}

interface ReleaseHighlight {
  id: string;
  icon: React.ReactNode;
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
  scopeAr: string;
  scopeEn: string;
}

const HIGHLIGHTS: ReleaseHighlight[] = [
  {
    id: 'net-worth-assets',
    icon: <Landmark className="w-4 h-4 text-[var(--color-gold-text)]" />,
    titleAr: 'صافي الثروة وفصل السيولة عن الأصول',
    titleEn: 'Net Worth & Spendable vs Owned Assets',
    bodyAr:
      'صنّف محافظك بين أموال متاحة للصرف (كاش، بنك، بطاقة) وأصول وممتلكات (ذهب، شهادات، عقارات، استثمارات) مع حساب صافي الثروة ومخطط تطوّرها خلال شهر / ٣ شهور / سنة / الكل.',
    bodyEn:
      'Separate Spendable Cash from Owned Assets (gold, CDs, investments, real estate) with Net Worth tracking and 1M / 3M / 1Y / All trend charts.',
    scopeAr: 'حساب شخصي',
    scopeEn: 'Personal',
  },
  {
    id: 'savings-cashflow',
    icon: <TrendingUp className="w-4 h-4 text-[var(--color-income)]" />,
    titleAr: 'معدل الادخار وصافي التدفق النقدي',
    titleEn: 'Savings Rate & Net Cashflow Indicators',
    bodyAr:
      'عرض واضح لنسبة الادخار من دخلك في الحساب الشخصي، ومؤشر صافي التدفق النقدي (إيجابي/سلبي) في الرئيسية والإحصائيات للشخصي والمؤسسات.',
    bodyEn:
      'Track your percentage of income saved in Personal mode alongside clear positive/negative Net Cashflow indicators across Dashboard and Analytics.',
    scopeAr: 'شخصي ومؤسسات',
    scopeEn: 'Personal & Org',
  },
  {
    id: 'merchant-rules',
    icon: <Wand2 className="w-4 h-4 text-[var(--color-accent)]" />,
    titleAr: 'قواعد التصنيف التلقائي للتجار',
    titleEn: 'Merchant Auto-Categorization Rules',
    bodyAr:
      'اربط أسماء التجار والموردين بتصنيف ومحفظة (ومركز تكلفة في المؤسسات) ليتم تطبيقها تلقائياً عند تسجيل المعاملات أو عند استيراد ملفات CSV/Excel.',
    bodyEn:
      'Map merchant keywords to a default category, wallet, and optional cost center — auto-applied during manual entry and spreadsheet imports.',
    scopeAr: 'مؤسسات وشخصي',
    scopeEn: 'Org & Personal',
  },
  {
    id: 'arrange-home',
    icon: <LayoutGrid className="w-4 h-4 text-[var(--color-accent)]" />,
    titleAr: 'إعادة ترتيب أقسام الرئيسية وإجراءات سريعة',
    titleEn: 'Arrange Home Sections & Quick Actions',
    bodyAr:
      'رتّب أقسام الشاشة الرئيسية كما يناسبك مع حفظ مستقل لكل مساحة عمل، واستفد من شريط الإجراءات السريعة وبطاقات البدء السريع القابلة للإخفاء.',
    bodyEn:
      'Customize Home section order independently per workspace, with instant Quick Actions and dismissible Get Started onboarding cards.',
    scopeAr: 'مشترك',
    scopeEn: 'Shared',
  },
  {
    id: 'adjust-balance',
    icon: <SlidersHorizontal className="w-4 h-4 text-[var(--color-gold-text)]" />,
    titleAr: 'تعديل الرصيد السريع من قائمة المحفظة',
    titleEn: 'One-Tap Adjust Balance on Wallets',
    bodyAr:
      'عدّل رصيد أي محفظة أو أصل إلى الرصيد الفعلي الحالي بسهولة مع إنشاء قيد تسوية تلقائي يحافظ على دقة السجل المالي.',
    bodyEn:
      'Reconcile any wallet or asset to its real-world balance in seconds with an automatic balancing entry that preserves ledger integrity.',
    scopeAr: 'مشترك',
    scopeEn: 'Shared',
  },
  {
    id: 'visual-stability',
    icon: <Palette className="w-4 h-4 text-[var(--color-accent)]" />,
    titleAr: 'الهوية البصرية المستوحاة من الأيقونة وثبات الأداء',
    titleEn: 'Icon-Inspired Theme Identity & Instant Boot',
    bodyAr:
      'تصميم عاجي دافئ نهاراً وبترولي زمردي مع الذهبي ليلاً، مع ثبات تام للثيم واستعادة فورية لصفحتك ومساحة عملك بعد التحديث.',
    bodyEn:
      'Warm ivory light mode and deep petrol-emerald & gold dark mode with rock-solid theme persistence and instant refresh restoration.',
    scopeAr: 'النظام',
    scopeEn: 'System',
  },
];

export const WhatsNewModal: React.FC<WhatsNewModalProps> = ({ isOpen, onClose, isRTL }) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-[2px] p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        data-testid="whats-new-modal"
        className="w-full sm:max-w-lg bg-[var(--color-surface)] border border-[var(--color-line)] rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--color-line)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-[var(--color-gold-soft)] text-[var(--color-gold-text)] flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-extrabold text-[var(--color-ink)] truncate">
                {isRTL ? 'ما الجديد في رَصِيدِي' : "What's New in Raseedi"}
              </h2>
              <p className="text-xs text-[var(--color-muted)]">
                {isRTL ? 'أحدث المزايا والتحسينات العملية' : 'Latest practical features & improvements'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={isRTL ? 'إغلاق' : 'Close'}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-surface-subtle)] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Highlights */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
          {HIGHLIGHTS.map((item) => (
            <div
              key={item.id}
              className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-subtle)] p-3.5 flex items-start gap-3"
            >
              <div className="w-9 h-9 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] flex items-center justify-center shrink-0 mt-0.5">
                {item.icon}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <h3 className="text-sm font-extrabold text-[var(--color-ink)]">
                    {isRTL ? item.titleAr : item.titleEn}
                  </h3>
                  <span className="text-[11px] font-bold text-[var(--color-muted)]">
                    · {isRTL ? item.scopeAr : item.scopeEn}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--color-muted)] leading-relaxed">
                  {isRTL ? item.bodyAr : item.bodyEn}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-[var(--color-line)] bg-[var(--color-surface)]">
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-[44px] rounded-xl bg-[var(--color-accent)] hover:bg-[var(--color-accent-strong)] text-[var(--color-on-accent)] text-sm font-bold transition-colors"
          >
            {isRTL ? 'فهمت، رائع!' : 'Got it!'}
          </button>
        </div>
      </div>
    </div>
  );
};
