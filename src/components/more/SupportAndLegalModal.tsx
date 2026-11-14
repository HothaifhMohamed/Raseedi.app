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
  Edit3,
  Check,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { SUPPORT_CONFIG } from '../../constants/support';
import { isEeaOrUkUser, resetAdConsentChoice } from '../common/AdConsentBanner';

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
  const { isRTL, isPro, settings, updateSettings } = useApp();
  const [activeTab, setActiveTab] = useState<'support' | 'legal'>(initialTab);
  const [editingSocial, setEditingSocial] = useState(false);
  const [facebookUrl, setFacebookUrl] = useState(
    settings.socialLinks?.facebookUrl || SUPPORT_CONFIG.defaultFacebookUrl
  );
  const [instagramUrl, setInstagramUrl] = useState(
    settings.socialLinks?.instagramUrl || SUPPORT_CONFIG.defaultInstagramUrl
  );
  const [socialSaved, setSocialSaved] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setFacebookUrl(settings.socialLinks?.facebookUrl || SUPPORT_CONFIG.defaultFacebookUrl);
      setInstagramUrl(settings.socialLinks?.instagramUrl || SUPPORT_CONFIG.defaultInstagramUrl);
      setSocialSaved(false);
      setEditingSocial(false);
    }
  }, [isOpen, initialTab, settings.socialLinks]);

  if (!isOpen) return null;

  const resolvedFacebookUrl =
    settings.socialLinks?.facebookUrl?.trim() || SUPPORT_CONFIG.defaultFacebookUrl;
  const resolvedInstagramUrl =
    settings.socialLinks?.instagramUrl?.trim() || SUPPORT_CONFIG.defaultInstagramUrl;

  const handleSaveSocialLinks = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings({
      socialLinks: {
        facebookUrl: facebookUrl.trim(),
        instagramUrl: instagramUrl.trim(),
      },
    });
    setEditingSocial(false);
    setSocialSaved(true);
    window.setTimeout(() => setSocialSaved(false), 2500);
  };

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
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Share2 className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
                    <span className="font-bold text-[var(--color-ink)] text-xs">
                      {isRTL ? 'حسابات التواصل الاجتماعي' : 'Social Media Pages'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingSocial((prev) => !prev)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--color-accent)] hover:underline min-h-[32px] px-1"
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>{editingSocial ? (isRTL ? 'إلغاء' : 'Cancel') : isRTL ? 'تعديل الروابط' : 'Edit Links'}</span>
                  </button>
                </div>

                {socialSaved && (
                  <div className="p-2 rounded-lg bg-[var(--color-income)]/10 border border-[var(--color-income)]/30 text-[var(--color-income)] text-[11px] font-medium flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 shrink-0" />
                    <span>{isRTL ? 'تم حفظ روابط التواصل بنجاح' : 'Social links updated'}</span>
                  </div>
                )}

                {editingSocial ? (
                  <form onSubmit={handleSaveSocialLinks} className="space-y-2.5 pt-1">
                    <div>
                      <label className="block text-[11px] font-semibold text-[var(--color-muted)] mb-1">
                        {isRTL ? 'رابط صفحة فيسبوك' : 'Facebook Page URL'}
                      </label>
                      <input
                        type="url"
                        dir="ltr"
                        value={facebookUrl}
                        onChange={(e) => setFacebookUrl(e.target.value)}
                        placeholder="https://facebook.com/..."
                        className="w-full px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[40px]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-[var(--color-muted)] mb-1">
                        {isRTL ? 'رابط حساب إنستقرام' : 'Instagram Profile URL'}
                      </label>
                      <input
                        type="url"
                        dir="ltr"
                        value={instagramUrl}
                        onChange={(e) => setInstagramUrl(e.target.value)}
                        placeholder="https://instagram.com/..."
                        className="w-full px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg text-xs text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] min-h-[40px]"
                      />
                    </div>
                    <button
                      type="submit"
                      className="w-full py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-semibold min-h-[40px]"
                    >
                      {isRTL ? 'حفظ الروابط' : 'Save Social Links'}
                    </button>
                  </form>
                ) : !resolvedFacebookUrl && !resolvedInstagramUrl ? (
                  <p className="text-[11px] text-[var(--color-muted)]">
                    {isRTL
                      ? 'لم تتم إضافة روابط تواصل اجتماعي بعد. اضغط «تعديل الروابط» لإضافة روابطك.'
                      : 'No social links added yet. Click "Edit Links" to add your pages.'}
                  </p>
                ) : (
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
                )}
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
                      يحترم تطبيق <strong className="text-[var(--color-ink)]">رَصِيدِي</strong> خصوصيتك المالية بالكامل. تُحفظ جميع معاملاتك، محافظك، ميزانياتك، ديونك، وأهدافك محلياً على جهازك عبر <bdi dir="ltr">IndexedDB</bdi> و<bdi dir="ltr">localStorage</bdi> للعمل دون اتصال.
                    </p>
                    <p>
                      عند تفعيلك اختيارياً لميزة «النسخ الاحتياطي السحابي عبر حساب جوجل»، تُستخدم خدمات <bdi dir="ltr">Firebase Authentication</bdi> و<bdi dir="ltr">Cloud Firestore</bdi> لحفظ نسخة خاصة بك من بياناتك وسجل باقة <bdi dir="ltr">PRO</bdi> تحت معرّف حسابك فقط، ويمكنك حذف حسابك وبياناتك السحابية نهائياً من الإعدادات في أي وقت.
                    </p>
                    <p>
                      عند استخدامك لميزة «مسح الفاتورة بالذكاء الاصطناعي» اختيارياً، تُرسل الصورة المختارة حصراً إلى <bdi dir="ltr">Google Gemini API</bdi> عبر خادم التطبيق الآمن لاستخراج المبلغ والتاريخ والتصنيف، ولا تُخزَّن الصورة على خوادمنا.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5 text-[var(--color-muted)]">
                    <p>
                      <strong className="text-[var(--color-ink)]">Raseedi</strong> respects your financial privacy. Your transactions, wallets, budgets, debts, and goals are stored locally on your device via IndexedDB and localStorage for offline use.
                    </p>
                    <p>
                      When you optionally enable Cloud Sync or redeem a PRO code, <strong>Firebase Authentication</strong> and <strong>Cloud Firestore</strong> store your private account backup and PRO status under your user ID. You can permanently delete your account and cloud data anytime from Settings.
                    </p>
                    <p>
                      When you optionally trigger AI Receipt Scanning, the selected receipt image is transmitted over HTTPS to <strong>Google Gemini API</strong> via our authenticated server proxy solely to extract receipt fields and is not retained on our servers.
                    </p>
                  </div>
                )}
              </section>

              {/* 2. Cookies & Google AdSense */}
              <section className="p-3.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] space-y-2">
                <div className="flex items-center gap-2">
                  <Cookie className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
                  <h3 className="font-bold text-[var(--color-ink)] text-xs">
                    {isRTL ? (
                      <>
                        2. ملفات تعريف الارتباط وإعلانات <bdi dir="ltr">Google AdSense</bdi>
                      </>
                    ) : (
                      '2. Cookies & Google AdSense Advertising'
                    )}
                  </h3>
                </div>
                {isRTL ? (
                  <div className="space-y-1.5 text-[var(--color-muted)]">
                    <p>
                      تعرض النسخة المجانية من التطبيق إعلانات غير مزعجة عبر <bdi dir="ltr">Google AdSense</bdi> لدعم استمرارية الخدمة مجاناً.
                    </p>
                    <p>
                      تستخدم <bdi dir="ltr">Google</bdi> وشركاؤها ملفات تعريف الارتباط (<bdi dir="ltr">Cookies</bdi>) لعرض إعلانات ملاءمة بناءً على زياراتك السابقة، مع احترام موافقة الخصوصية للمستخدمين في المنطقة الاقتصادية الأوروبية والمملكة المتحدة. يمكنك تعديل الإعلانات عبر <bdi dir="ltr">adssettings.google.com</bdi>.
                    </p>
                    <p>
                      عند الاشتراك في باقة <bdi dir="ltr">PRO</bdi>، تُزال جميع الإعلانات وسكربتات <bdi dir="ltr">AdSense</bdi> نهائياً. {isPro ? '(حالتك الحالية: مشترك PRO — الإعلانات معطلة بالكامل).' : ''}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5 text-[var(--color-muted)]">
                    <p>
                      The free tier of Raseedi displays unobtrusive advertisements served by <strong>Google AdSense</strong> to help keep core features free.
                    </p>
                    <p>
                      Google and third-party vendors use cookies to serve ads based on consent (with a consent banner shown to EEA/UK users prior to loading AdSense scripts). You can manage ad personalization at <strong>adssettings.google.com</strong>.
                    </p>
                    <p>
                      Upgrading to <strong>Raseedi PRO</strong> permanently removes all ads and AdSense scripts. {isPro ? '(Current status: PRO active — ads disabled.)' : ''}
                    </p>
                  </div>
                )}
                {isEeaOrUkUser() && !isPro && (
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
