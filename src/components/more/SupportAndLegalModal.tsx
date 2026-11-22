import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  Database,
  Cookie,
  FileCheck,
  Mail,
  MessageCircle,
  Share2,
  ExternalLink,
  Headphones,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { SUPPORT_CONFIG } from '../../constants/support';
import { resetAdConsentChoice } from '../common/AdConsentBanner';
import { BrandLogo } from '../common/BrandLogo';

export interface SupportAndLegalModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'support' | 'legal';
}

export const SupportAndLegalModal: React.FC<SupportAndLegalModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'support',
}) => {
  const { isRTL, isPro } = useApp();
  const [activeTab, setActiveTab] = useState<'support' | 'legal'>(initialTab);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  if (!isOpen) return null;

  const resolvedFacebookUrl = SUPPORT_CONFIG.defaultFacebookUrl;
  const resolvedInstagramUrl = SUPPORT_CONFIG.defaultInstagramUrl;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      dir={isRTL ? 'rtl' : 'ltr'}
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg max-h-[90vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-[var(--color-surface)] border border-[var(--color-line)] shadow-xl overflow-hidden animate-in fade-in duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-[var(--color-line)] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {activeTab === 'support' ? (
              <Headphones className="w-5 h-5 text-[var(--color-accent)] shrink-0" />
            ) : (
              <ShieldCheck className="w-5 h-5 text-[var(--color-accent)] shrink-0" />
            )}
            <h2 className="font-title text-base font-bold text-[var(--color-ink)] truncate">
              {activeTab === 'support'
                ? isRTL
                  ? 'الدعم الفني والتواصل'
                  : 'Support & Contact'
                : isRTL
                ? 'سياسة الخصوصية وشروط الاستخدام'
                : 'Privacy Policy & Terms of Use'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={isRTL ? 'إغلاق' : 'Close'}
            className="w-9 h-9 rounded-lg border border-[var(--color-line)] flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors min-h-[36px] min-w-[36px]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="px-4 pt-3 shrink-0">
          <div className="grid grid-cols-2 gap-1 p-1 bg-[var(--color-bg)] border border-[var(--color-line)] rounded-xl">
            <button
              type="button"
              onClick={() => setActiveTab('support')}
              className={`py-2 rounded-lg text-xs font-semibold transition-colors min-h-[38px] ${
                activeTab === 'support'
                  ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-xs'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              {isRTL ? 'الدعم والتواصل' : 'Support & Social'}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('legal')}
              className={`py-2 rounded-lg text-xs font-semibold transition-colors min-h-[38px] ${
                activeTab === 'legal'
                  ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-xs'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              {isRTL ? 'الخصوصية والشروط' : 'Privacy & Terms'}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs leading-relaxed text-[var(--color-ink)]">
          {activeTab === 'support' ? (
            <>
              {/* About Raseedi Brand Banner */}
              <div className="p-3.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] flex items-center gap-3">
                <BrandLogo
                  className="w-12 h-12 rounded-xl object-cover shadow-sm shrink-0"
                  title={isRTL ? 'رَصِيدِي' : 'Raseedi'}
                />
                <div className="min-w-0">
                  <div className="font-title font-bold text-sm text-[var(--color-ink)]">
                    {isRTL ? 'رَصِيدِي' : 'Raseedi'}
                  </div>
                  <p className="text-[11px] text-[var(--color-muted)] mt-0.5">
                    {isRTL
                      ? 'الإدارة المالية الشخصية وإدارة الشركات دون اتصال مع مزامنة سحابية آمنة.'
                      : 'Smart personal & business finance with offline-first storage and secure cloud sync.'}
                  </p>
                </div>
              </div>

              {/* Direct Contact Actions */}
              <div className="p-3.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] space-y-2.5">
                <div className="font-bold text-[var(--color-ink)] text-xs">
                  {isRTL ? 'قنوات الدعم الفني المباشرة' : 'Direct Support Channels'}
                </div>
                <p className="text-[11px] text-[var(--color-muted)]">
                  {isRTL
                    ? 'يسعد فريق رَصِيدِي بمساعدتك في استعادة الاشتراك، المزامنة السحابية، أو أي استفسار تقني.'
                    : 'The Raseedi team is ready to help with PRO activation, cloud sync, or any technical question.'}
                </p>

                {/* Email Contact Button */}
                <a
                  href={`mailto:${SUPPORT_CONFIG.email}?subject=${encodeURIComponent(
                    isRTL ? 'دعم تطبيق رَصِيدِي (Raseedi Support)' : 'Raseedi App Support'
                  )}`}
                  className="w-full p-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] hover:border-[var(--color-accent)] flex items-center justify-between gap-3 transition-colors min-h-[52px]"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Mail className="w-5 h-5 text-[var(--color-accent)] shrink-0" />
                    <div className="min-w-0">
                      <div className="font-bold text-[var(--color-ink)]">
                        {isRTL ? 'تواصل معنا عبر البريد' : 'Contact Us via Email'}
                      </div>
                      <div className="text-[11px] text-[var(--color-muted)] truncate" dir="ltr">
                        {SUPPORT_CONFIG.email}
                      </div>
                    </div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-[var(--color-muted)] shrink-0" />
                </a>

                {/* WhatsApp Direct Button */}
                <a
                  href={SUPPORT_CONFIG.whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full p-3 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:opacity-95 flex items-center justify-between gap-3 transition-opacity min-h-[52px]"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <MessageCircle className="w-5 h-5 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-bold">
                        {isRTL ? 'تواصل سريع عبر واتساب' : 'Quick Chat on WhatsApp'}
                      </div>
                      <div className="text-[11px] opacity-90" dir="ltr">
                        {SUPPORT_CONFIG.whatsappNumber}
                      </div>
                    </div>
                  </div>
                  <ExternalLink className="w-4 h-4 shrink-0" />
                </a>
              </div>

              {/* Social Media Channels */}
              <div className="p-3.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] space-y-2.5">
                <div className="flex items-center gap-2">
                  <Share2 className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
                  <span className="font-bold text-[var(--color-ink)] text-xs">
                    {isRTL ? 'حسابات التواصل الاجتماعي' : 'Social Media Pages'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {resolvedFacebookUrl && (
                      <a
                        href={resolvedFacebookUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] hover:border-[var(--color-accent)] flex items-center justify-between gap-2 transition-colors min-h-[48px]"
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-[var(--color-ink)]">
                            {isRTL ? 'صفحة فيسبوك' : 'Facebook Page'}
                          </div>
                          <div className="text-[10px] text-[var(--color-muted)] truncate" dir="ltr">
                            {resolvedFacebookUrl.replace(/^https?:\/\//, '')}
                          </div>
                        </div>
                        <ExternalLink className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />
                      </a>
                    )}

                    {resolvedInstagramUrl && (
                      <a
                        href={resolvedInstagramUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-line)] hover:border-[var(--color-accent)] flex items-center justify-between gap-2 transition-colors min-h-[48px]"
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-[var(--color-ink)]">
                            {isRTL ? 'حساب إنستقرام' : 'Instagram'}
                          </div>
                          <div className="text-[10px] text-[var(--color-muted)] truncate" dir="ltr">
                            {resolvedInstagramUrl.replace(/^https?:\/\//, '')}
                          </div>
                        </div>
                        <ExternalLink className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />
                      </a>
                    )}
                  </div>
              </div>
            </>
          ) : (
            <>
              {/* App Notice & Effective Date */}
              <div className="p-3 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] flex items-center justify-between gap-2 text-[11px] text-[var(--color-muted)]">
                <span>
                  {isRTL ? (
                    <>
                      تطبيق <strong className="text-[var(--color-ink)]">رَصِيدِي</strong> (<bdi dir="ltr">Raseedi</bdi>)
                    </>
                  ) : (
                    <>
                      <strong className="text-[var(--color-ink)]">Raseedi</strong> Personal Finance App
                    </>
                  )}
                </span>
                <span className="shrink-0">
                  {isRTL ? 'آخر تحديث: 13 نوفمبر 2026' : 'Last updated: November 13, 2026'}
                </span>
              </div>

              {/* 1. Privacy & Offline-First / Optional Cloud Sync */}
              <section className="p-3.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] space-y-2">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
                  <h3 className="font-bold text-[var(--color-ink)] text-xs">
                    {isRTL ? (
                      <>
                        1. سياسة الخصوصية وحفظ البيانات محلياً <bdi dir="ltr">(Offline-First)</bdi>
                      </>
                    ) : (
                      '1. Privacy Policy & Local Offline-First Storage'
                    )}
                  </h3>
                </div>
                {isRTL ? (
                  <div className="space-y-1.5 text-[var(--color-muted)]">
                    <p>
                      يحترم تطبيق <strong className="text-[var(--color-ink)]">رَصِيدِي</strong> خصوصيتك المالية بالكامل. تُحفظ بياناتك الشخصية من معاملات، محافظ، ميزانيات، ديون، وأهداف محلياً على جهازك عبر <bdi dir="ltr">IndexedDB</bdi> و<bdi dir="ltr">localStorage</bdi> للعمل دون اتصال.
                    </p>
                    <p>
                      عند تفعيلك اختيارياً للنسخ الاحتياطي السحابي أو باقات <bdi dir="ltr">PRO</bdi>، تُستخدم خدمات <bdi dir="ltr">Firebase Authentication</bdi> و<bdi dir="ltr">Cloud Firestore</bdi> لحفظ بياناتك الخاصة وتفعيل اشتراكك. وعند الانضمام إلى <strong className="text-[var(--color-ink)]">مساحة عمل مؤسسة</strong> (<bdi dir="ltr">Enterprise</bdi>)، تكون قيود المؤسسة ومرفقات الفواتير المحفوظة على <bdi dir="ltr">Firebase Storage</bdi> وسجل التدقيق (<bdi dir="ltr">Audit Log</bdi>) مرئية لأعضاء الفريق المخوّلين داخل نفس المؤسسة وفق الصلاحيات المعتمدة.
                    </p>
                    <p>
                      عند استخدام ميزة «مسح الفاتورة بالذكاء الاصطناعي» اختيارياً، تُرسل الصورة حصراً عبر خادم التطبيق الموثق إلى <bdi dir="ltr">Google Gemini API</bdi> لاستخراج الحقول المالية دون الاحتفاظ بالصورة على خادم المسح، ويمكنك حذف حسابك وبياناتك السحابية نهائياً من الإعدادات في أي وقت.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5 text-[var(--color-muted)]">
                    <p>
                      <strong className="text-[var(--color-ink)]">Raseedi</strong> respects your financial privacy. Personal transactions, wallets, budgets, debts, and goals are stored locally on your device via IndexedDB and localStorage for offline use.
                    </p>
                    <p>
                      When you enable Cloud Sync or activate PRO, <strong>Firebase Authentication</strong> and <strong>Cloud Firestore</strong> store your private account backup and entitlement state. When you create or join a cloud <strong>Enterprise Organization</strong>, that organization&apos;s ledger, receipt attachments stored in <strong>Firebase Storage</strong>, and immutable <strong>Audit Log</strong> entries are shared with authorized active members of that same organization according to RBAC roles.
                    </p>
                    <p>
                      When you trigger AI Receipt Scanning, the selected receipt image is transmitted over HTTPS through our authenticated server proxy to <strong>Google Gemini API</strong> solely for field extraction and is not retained by the scanner endpoint. You may permanently delete your account and cloud data anytime from Settings.
                    </p>
                  </div>
                )}
              </section>

              {/* 2. Cookies & Google AdSense */}
              <section className="p-3.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] space-y-2">
                <div className="flex items-center gap-2">
                  <Cookie className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
                  <h3 className="font-bold text-[var(--color-ink)] text-xs">
                    {isRTL
                      ? '2. ملفات تعريف الارتباط وإعلانات النسخة المجانية'
                      : '2. Cookies & Free-Tier Advertising'}
                  </h3>
                </div>
                {isRTL ? (
                  <div className="space-y-1.5 text-[var(--color-muted)]">
                    <p>
                      تعرض النسخة المجانية من التطبيق إعلانات مدمجة محدودة وهادئة لدعم استمرارية الخدمة مجاناً.
                    </p>
                    <p>
                      نستخدم ملفات تعريف الارتباط (<bdi dir="ltr">Cookies</bdi>) لعرض إعلانات مدمجة محدودة عبر شركاء الإعلان (مثل <bdi dir="ltr">Adsterra</bdi>) فقط بعد موافقتك عبر شريط الخصوصية، دون مشاركة أي بيانات مالية من دفاترك مع المعلنين.
                    </p>
                    <p>
                      عند الاشتراك في باقة <bdi dir="ltr">PRO</bdi> أو <bdi dir="ltr">Business</bdi>، تُزال جميع الإعلانات وسكربتات الإعلان نهائياً. {isPro ? '(حالتك الحالية: اشتراك نشط — الإعلانات معطلة بالكامل).' : ''}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5 text-[var(--color-muted)]">
                    <p>
                      The free tier of Raseedi displays limited, unobtrusive native advertisements (such as <strong>Adsterra</strong>) only after your privacy consent to help keep core features free.
                    </p>
                    <p>
                      Your personal or organization financial ledger data is never shared with advertisers. You can update or withdraw your consent at any time below.
                    </p>
                    <p>
                      Upgrading to <strong>Raseedi PRO</strong> or <strong>Business</strong> permanently removes all ads and ad scripts. {isPro ? '(Current status: active subscription — ads disabled.)' : ''}
                    </p>
                  </div>
                )}
                {!isPro && (
                  <button
                    type="button"
                    onClick={() => {
                      resetAdConsentChoice();
                      onClose();
                    }}
                    className="mt-1 inline-flex items-center px-3 py-1.5 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)] text-[11px] font-semibold text-[var(--color-accent)] hover:border-[var(--color-accent)] min-h-[34px]"
                  >
                    {isRTL ? 'تغيير تفضيلات ملفات تعريف الارتباط' : 'Change Cookie Preferences'}
                  </button>
                )}
              </section>

              {/* 3. Terms of Use */}
              <section className="p-3.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] space-y-2">
                <div className="flex items-center gap-2">
                  <FileCheck className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
                  <h3 className="font-bold text-[var(--color-ink)] text-xs">
                    {isRTL ? '3. شروط الاستخدام' : '3. Terms of Use'}
                  </h3>
                </div>
                {isRTL ? (
                  <div className="space-y-1.5 text-[var(--color-muted)]">
                    <p>
                      يُقدَّم تطبيق رَصِيدِي كأداة تنظيم مالي شخصية «كما هو»، ولا يُعد بديلاً عن الاستشارات المالية أو الضريبية أو القانونية.
                    </p>
                    <p>
                      أنت المسؤول عن مراجعة بياناتك وأسعار الصرف والاحتفاظ بنسخة احتياطية سحابية أو محلية (<bdi dir="ltr">JSON / CSV</bdi>).
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5 text-[var(--color-muted)]">
                    <p>
                      Raseedi is provided &ldquo;as is&rdquo; for personal financial organization and does not constitute professional financial, tax, or legal advice.
                    </p>
                    <p>
                      You are responsible for verifying entries, exchange rates, and maintaining regular cloud or local (JSON / CSV) backups.
                    </p>
                  </div>
                )}
              </section>

              {/* 4. Official Contact Info */}
              <section className="p-3.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] space-y-2">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
                  <h3 className="font-bold text-[var(--color-ink)] text-xs">
                    {isRTL ? '4. التواصل والدعم الرسمي' : '4. Official Contact & Support'}
                  </h3>
                </div>
                <div className="space-y-1 text-[var(--color-muted)]">
                  <p>
                    {isRTL
                      ? 'للاستفسارات القانونية أو الدعم الفني، تواصل معنا مباشرة:'
                      : 'For legal, privacy, or technical support inquiries, reach out directly:'}
                  </p>
                  <div className="flex flex-wrap gap-3 pt-1">
                    <a
                      href={`mailto:${SUPPORT_CONFIG.email}`}
                      className="font-semibold text-[var(--color-accent)] hover:underline"
                      dir="ltr"
                    >
                      {SUPPORT_CONFIG.email}
                    </a>
                    <a
                      href={SUPPORT_CONFIG.whatsappUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-[var(--color-accent)] hover:underline"
                      dir="ltr"
                    >
                      WhatsApp: {SUPPORT_CONFIG.whatsappNumber}
                    </a>
                  </div>
                </div>
              </section>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--color-line)] bg-[var(--color-bg)]">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-semibold hover:opacity-95 transition-opacity min-h-[44px]"
          >
            {isRTL ? 'إغلاق' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
};
