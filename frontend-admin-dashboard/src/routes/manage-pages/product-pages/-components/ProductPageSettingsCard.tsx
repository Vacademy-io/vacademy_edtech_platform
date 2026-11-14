import { Input } from '@/components/ui/input';
import {
    BookOpen,
    ShoppingCart,
    CreditCard,
    CaretRight as ChevronRight,
    CheckCircle as CheckCircle2,
    FileText,
    Envelope as Mail,
    ChatCircle as MessageCircle,
    Receipt,
    Sparkle as Sparkles,
    ArrowsLeftRight as ArrowLeftRight,
    Tag,
    Percent,
    Plus,
    Trash as Trash2,
    ArrowSquareOut as ExternalLink,
    MagicWand,
    Warning,
} from '@phosphor-icons/react';
import type { MappingRow, ProductPageSettings } from '../-types/product-page-types';
import {
    MAX_REDIRECT_DELAY_SECONDS,
    REDIRECT_DELAY_PRESETS,
    clampRedirectDelay,
    redirectDelayLabel,
    resolveRedirectTarget,
} from '../-utils/redirect-settings';
import { BasketPricingEditor } from './BasketPricingEditor';
import { CourseFinderEditor } from './CourseFinderEditor';
import { OffersEditor } from './OffersEditor';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

interface ProductPageSettingsCardProps {
    settings: ProductPageSettings;
    onChange: (updated: ProductPageSettings) => void;
    /** The page's courses — the source of real level / course names to pick from. */
    courses?: MappingRow[];
}

const Toggle = ({ checked, onChange }: { checked: boolean; onChange: () => void }) => (
    <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
            checked ? 'bg-primary-500' : 'bg-neutral-200'
        }`}
    >
        <span
            className={`pointer-events-none inline-block size-5 rounded-full bg-white shadow ring-0 transition-transform ${
                checked ? 'translate-x-5' : 'translate-x-0'
            }`}
        />
    </button>
);

// ─── Step preview illustrations ───────────────────────────────────────────────

const CatalogIllustration = () => (
    <div className="w-full space-y-1.5">
        <div className="grid grid-cols-2 gap-1">
            {[0, 1, 2, 3].map((i) => (
                <div key={i} className="rounded-md border border-neutral-100 bg-white p-1.5 shadow-sm">
                    <div className="mb-1 h-6 w-full rounded bg-neutral-100" />
                    <div className="h-1.5 w-3/4 rounded bg-neutral-200" />
                    <div className="mt-1 h-1.5 w-1/2 rounded bg-primary-200" />
                </div>
            ))}
        </div>
        <div className="flex gap-1">
            {['All', 'Level', 'Price'].map((f) => (
                <div key={f} className="rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[8px] text-neutral-400">
                    {f}
                </div>
            ))}
        </div>
    </div>
);

const CartIllustration = () => (
    <div className="w-full space-y-1.5">
        <div className="rounded-md border border-neutral-100 bg-white p-2 shadow-sm">
            <div className="flex items-center gap-1.5">
                <div className="h-5 w-5 rounded bg-neutral-100" />
                <div className="flex-1 space-y-1">
                    <div className="h-1.5 w-3/4 rounded bg-neutral-200" />
                    <div className="h-1.5 w-1/2 rounded bg-primary-200" />
                </div>
                <div className="h-3 w-3 rounded-full bg-primary-100" />
            </div>
        </div>
        <div className="rounded-md border border-neutral-100 bg-white p-2 shadow-sm">
            <div className="flex items-center gap-1.5">
                <div className="h-5 w-5 rounded bg-neutral-100" />
                <div className="flex-1 space-y-1">
                    <div className="h-1.5 w-2/3 rounded bg-neutral-200" />
                    <div className="h-1.5 w-1/3 rounded bg-primary-200" />
                </div>
                <div className="h-3 w-3 rounded-full bg-primary-400" />
            </div>
        </div>
        <div className="h-5 w-full rounded-md bg-primary-500" />
    </div>
);

const PaymentIllustration = () => (
    <div className="w-full space-y-1.5">
        <div className="rounded-md border border-neutral-100 bg-white p-2 shadow-sm">
            <div className="mb-1 h-1.5 w-1/3 rounded bg-neutral-200" />
            <div className="h-4 rounded bg-neutral-100" />
        </div>
        <div className="grid grid-cols-2 gap-1">
            <div className="rounded-md border border-neutral-100 bg-white p-2 shadow-sm">
                <div className="mb-1 h-1.5 w-2/3 rounded bg-neutral-200" />
                <div className="h-3 rounded bg-neutral-100" />
            </div>
            <div className="rounded-md border border-neutral-100 bg-white p-2 shadow-sm">
                <div className="mb-1 h-1.5 w-1/2 rounded bg-neutral-200" />
                <div className="h-3 rounded bg-neutral-100" />
            </div>
        </div>
        <div className="h-5 w-full rounded-md bg-primary-500" />
    </div>
);

const STEPS = [
    {
        id: 'CATALOG' as const,
        label: 'Catalog',
        icon: BookOpen,
        // Getter, not a string: STEPS is module-scope, so the institute's term
        // must be read at render time, not frozen at import.
        get description() {
            return `Browse & select ${getTerminologyPlural(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}`;
        },
        illustration: CatalogIllustration,
        color: 'blue',
    },
    {
        id: 'CART' as const,
        label: 'Cart',
        icon: ShoppingCart,
        get description() {
            return `Review selected ${getTerminologyPlural(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}`;
        },
        illustration: CartIllustration,
        color: 'violet',
    },
    {
        id: 'PAYMENT' as const,
        label: 'Payment',
        icon: CreditCard,
        description: 'Complete payment',
        illustration: PaymentIllustration,
        color: 'emerald',
    },
] as const;

// ─── Settings card ────────────────────────────────────────────────────────────

export const ProductPageSettingsCard = ({
    settings,
    onChange,
    courses = [],
}: ProductPageSettingsCardProps) => {
    const update = (patch: Partial<ProductPageSettings>) => onChange({ ...settings, ...patch });
    const selectedStepIndex = STEPS.findIndex((s) => s.id === settings.defaultStep);

    // Post-enrollment redirect, resolved exactly as the checkout resolves it.
    const redirectRaw = settings.afterPaymentRedirectUrl ?? '';
    const redirectTarget = resolveRedirectTarget(redirectRaw);
    const isAbsoluteRedirect = redirectTarget !== null && !redirectTarget.startsWith('/');
    const delaySeconds = clampRedirectDelay(settings.afterPaymentRedirectDelaySeconds);
    const redirectSummaryPrefix =
        delaySeconds > 0
            ? `Learners see the success screen for ${redirectDelayLabel(delaySeconds)}, then go to `
            : 'Learners go straight to ';

    return (
        <div className="space-y-5">

            {/* ── Default Landing Step ──────────────────────────────────────── */}
            <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
                <div className="border-b border-neutral-100 bg-neutral-50/60 px-6 py-4">
                    <h3 className="text-sm font-semibold text-neutral-800">Default Landing Step</h3>
                    <p className="mt-0.5 text-xs text-neutral-500">
                        Choose which step learners land on when they open the page link.
                    </p>
                </div>

                {/* Step flow indicator */}
                <div className="px-6 pt-5 pb-3">
                    <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 mb-4">
                        <span className={selectedStepIndex >= 0 ? 'text-primary-500' : ''}>Catalog</span>
                        <ChevronRight className="size-3 text-neutral-300" />
                        <span className={selectedStepIndex >= 1 ? 'text-primary-500' : ''}>Cart</span>
                        <ChevronRight className="size-3 text-neutral-300" />
                        <span className={selectedStepIndex >= 2 ? 'text-primary-500' : ''}>Payment</span>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                        {STEPS.map((step, idx) => {
                            const isSelected = settings.defaultStep === step.id;
                            const Icon = step.icon;
                            const Illustration = step.illustration;
                            return (
                                <button
                                    key={step.id}
                                    type="button"
                                    onClick={() => update({ defaultStep: step.id })}
                                    className={`group relative flex flex-col rounded-xl border-2 p-3 text-left transition-all ${
                                        isSelected
                                            ? 'border-primary-500 bg-primary-50 shadow-md shadow-primary-100'
                                            : 'border-neutral-200 bg-white hover:border-primary-200 hover:bg-primary-50/30'
                                    }`}
                                >
                                    {/* Selected check */}
                                    {isSelected && (
                                        <div className="absolute right-2.5 top-2.5">
                                            <CheckCircle2 className="size-4 text-primary-500" />
                                        </div>
                                    )}

                                    {/* Step number badge */}
                                    <div className={`mb-2.5 flex items-center gap-1.5`}>
                                        <div className={`flex size-6 items-center justify-center rounded-full text-[10px] font-bold ${
                                            isSelected ? 'bg-primary-500 text-white' : 'bg-neutral-100 text-neutral-500'
                                        }`}>
                                            {idx + 1}
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <Icon className={`size-3.5 ${isSelected ? 'text-primary-500' : 'text-neutral-400'}`} />
                                            <span className={`text-xs font-semibold ${isSelected ? 'text-primary-700' : 'text-neutral-600'}`}>
                                                {step.label}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Mini illustration */}
                                    <div className={`mb-2.5 rounded-lg p-2 ${isSelected ? 'bg-white/80' : 'bg-neutral-50'}`}>
                                        <Illustration />
                                    </div>

                                    <p className={`text-[10px] leading-snug ${isSelected ? 'text-primary-600' : 'text-neutral-400'}`}>
                                        {step.description}
                                    </p>
                                </button>
                            );
                        })}
                    </div>

                    {/* A finder lives on the catalogue step. Landing anywhere
                        else skips the question and drops the visitor on an
                        empty basket, so the learner app now forces the
                        catalogue — say so rather than letting the picker
                        silently disagree with what is selected here. */}
                    {settings.courseFinder?.enabled && settings.defaultStep !== 'CATALOG' && (
                        <div className="mt-3 rounded-lg border border-warning-300 bg-warning-50 px-3 py-2">
                            <p className="text-xs text-warning-700">
                                {getTerminology(ContentTerms.Course, SystemTerms.Course)} Finder is
                                on, so learners still land on <strong>Catalog</strong> — the class
                                question has to be asked before there is anything in the cart. Turn
                                the {getTerminology(ContentTerms.Course, SystemTerms.Course)} Finder
                                off to use this landing step.
                            </p>
                        </div>
                    )}

                    {/* Flow label */}
                    <div className="mt-3 flex items-center gap-1 rounded-lg bg-neutral-50 px-3 py-2">
                        <span className="text-[10px] text-neutral-400">Learner flow:</span>
                        {STEPS.map((step, idx) => (
                            <span key={step.id} className="flex items-center gap-1">
                                <span className={`text-[10px] font-medium ${step.id === settings.defaultStep ? 'text-primary-600 underline underline-offset-2' : 'text-neutral-500'}`}>
                                    {step.label}
                                </span>
                                {idx < STEPS.length - 1 && <ChevronRight className="size-3 text-neutral-300" />}
                            </span>
                        ))}
                        <span className="ml-1 text-[10px] text-neutral-400">· starts at <span className="font-semibold text-primary-600">{STEPS.find(s => s.id === settings.defaultStep)?.label}</span></span>
                    </div>
                </div>
            </div>

            {/* ── Toggle settings ───────────────────────────────────────────── */}
            <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm divide-y divide-neutral-100">
                {[
                    {
                        icon: ShoppingCart,
                        color: 'text-primary-500 bg-primary-50',
                        label: `${getTerminology(ContentTerms.Course, SystemTerms.Course)} Deselection`,
                        description: `Learners can remove pre-selected ${getTerminologyPlural(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}`,
                        checked: settings.allowCourseDeselection,
                        onChange: () => update({ allowCourseDeselection: !settings.allowCourseDeselection }),
                    },
                    {
                        icon: ArrowLeftRight,
                        color: 'text-rose-500 bg-rose-50',
                        label: 'Disable Back Navigation',
                        description: 'Hide back button on cart, form & payment',
                        checked: !!settings.disableBackNavigation,
                        onChange: () => update({ disableBackNavigation: !settings.disableBackNavigation }),
                    },
                    {
                        icon: FileText,
                        color: 'text-amber-500 bg-amber-50',
                        label: 'Terms & Conditions',
                        description: 'Require T&C acceptance on registration',
                        checked: settings.tnc.enabled,
                        onChange: () => update({ tnc: { ...settings.tnc, enabled: !settings.tnc.enabled } }),
                    },
                    {
                        icon: Sparkles,
                        color: 'text-violet-500 bg-violet-50',
                        label: `Suggested ${getTerminologyPlural(ContentTerms.Course, SystemTerms.Course)}`,
                        description: 'Show "people also buy" upsell in the cart',
                        checked: settings.suggestedCourses.enabled,
                        onChange: () => update({ suggestedCourses: { ...settings.suggestedCourses, enabled: !settings.suggestedCourses.enabled } }),
                    },
                    {
                        icon: Tag,
                        color: 'text-orange-500 bg-orange-50',
                        label: 'Coupon Code',
                        description: 'Accept discount codes at checkout',
                        checked: settings.coupon?.enabled ?? false,
                        onChange: () => update({ coupon: { enabled: !(settings.coupon?.enabled ?? false) } }),
                    },
                    {
                        icon: Tag,
                        color: 'text-rose-500 bg-rose-50',
                        label: 'Offers',
                        description: '“₹99 off above ₹500” — no code, applied automatically',
                        checked: settings.offers?.enabled ?? false,
                        panel: settings.offers ? (
                            <OffersEditor
                                value={settings.offers}
                                onChange={(offers) => update({ offers })}
                            />
                        ) : null,
                        onChange: () =>
                            update({
                                offers: {
                                    rules: settings.offers?.rules?.length
                                        ? settings.offers.rules
                                        : [
                                              {
                                                  id: 'offer-default-1',
                                                  label: '',
                                                  minAmount: 500,
                                                  discountType: 'FIXED',
                                                  discountValue: 99,
                                              },
                                          ],
                                    enabled: !(settings.offers?.enabled ?? false),
                                },
                            }),
                    },
                    {
                        icon: MagicWand,
                        color: 'text-sky-500 bg-sky-50',
                        label: `${getTerminology(ContentTerms.Course, SystemTerms.Course)} Finder`,
                        description: `Ask “which class?” first, then show only those ${getTerminologyPlural(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}`,
                        checked: settings.courseFinder?.enabled ?? false,
                        panel: settings.courseFinder ? (
                            <CourseFinderEditor
                                value={settings.courseFinder}
                                courses={courses ?? []}
                                onChange={(courseFinder) => update({ courseFinder })}
                            />
                        ) : null,
                        onChange: () =>
                            update({
                                courseFinder: {
                                    // Buttons are kept across an off/on cycle —
                                    // turning the screen off to preview the page
                                    // must not throw away the grouping work.
                                    heading: settings.courseFinder?.heading ?? '',
                                    subheading: settings.courseFinder?.subheading ?? '',
                                    changeLabel: settings.courseFinder?.changeLabel ?? '',
                                    allowSkip: settings.courseFinder?.allowSkip ?? false,
                                    skipLabel: settings.courseFinder?.skipLabel ?? '',
                                    groups: settings.courseFinder?.groups ?? [],
                                    enabled: !(settings.courseFinder?.enabled ?? false),
                                },
                            }),
                    },
                    {
                        icon: Percent,
                        color: 'text-pink-500 bg-pink-50',
                        label: 'Basket Pricing',
                        description: `Price by how many ${getTerminologyPlural(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()} they pick, not per ${getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}`,
                        checked: settings.basketPricing?.enabled ?? false,
                        panel: settings.basketPricing ? (
                            <BasketPricingEditor
                                value={settings.basketPricing}
                                courses={courses}
                                onChange={(basketPricing) => update({ basketPricing })}
                            />
                        ) : null,
                        onChange: () =>
                            update({
                                basketPricing: {
                                    // Seeded so the panel has something real to edit
                                    // the first time it is opened.
                                    ladder: settings.basketPricing?.ladder ?? {
                                        prices: [349, 599, 799],
                                        perExtra: 150,
                                    },
                                    groups: settings.basketPricing?.groups ?? [],
                                    wholeGroupPrices: settings.basketPricing?.wholeGroupPrices ?? {},
                                    combos: settings.basketPricing?.combos ?? [],
                                    enabled: !(settings.basketPricing?.enabled ?? false),
                                },
                            }),
                    },
                    {
                        icon: Receipt,
                        color: 'text-emerald-500 bg-emerald-50',
                        label: 'Invoice / Receipt',
                        description: 'Send a receipt after successful payment',
                        checked: settings.invoice.enabled,
                        onChange: () => update({ invoice: { ...settings.invoice, enabled: !settings.invoice.enabled } }),
                    },
                ].map(({ icon: Icon, color, label, description, checked, onChange, panel }) => (
                    <div key={label}>
                        <div className="flex items-center gap-4 px-5 py-4">
                            <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${checked ? color : 'bg-neutral-100 text-neutral-400'}`}>
                                <Icon className="size-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-neutral-800">{label}</p>
                                <p className="text-xs text-neutral-400">{description}</p>
                            </div>
                            <Toggle checked={checked} onChange={onChange} />
                        </div>
                        {checked && panel}
                    </div>
                ))}

                {/* Invoice delivery channels */}
                {settings.invoice.enabled && (
                    <div className="bg-neutral-50/60 px-5 py-3 pl-[3.75rem]">
                        <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-neutral-400">Channels</p>
                        <div className="flex gap-2">
                            {([
                                { id: 'EMAIL' as const, label: 'Email', icon: Mail },
                                { id: 'WHATSAPP' as const, label: 'WhatsApp', icon: MessageCircle },
                            ]).map(({ id, label, icon: Icon }) => {
                                const isChecked = settings.invoice.channels.includes(id);
                                return (
                                    <button
                                        key={id}
                                        type="button"
                                        onClick={() => {
                                            const channels = isChecked
                                                ? settings.invoice.channels.filter((c) => c !== id)
                                                : [...settings.invoice.channels, id];
                                            update({ invoice: { ...settings.invoice, channels } });
                                        }}
                                        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                                            isChecked
                                                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                                : 'border-neutral-200 bg-white text-neutral-500 hover:border-neutral-300'
                                        }`}
                                    >
                                        <Icon className={`size-3.5 ${isChecked ? 'text-emerald-500' : 'text-neutral-400'}`} />
                                        {label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* T&C expanded config */}
            {settings.tnc.enabled && (
                <div className="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm space-y-3">
                    <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">T&C Content</p>
                    <textarea
                        rows={3}
                        placeholder="<p>By enrolling you agree to our <a href='...'>terms</a>.</p>"
                        value={settings.tnc.content}
                        onChange={(e) => update({ tnc: { ...settings.tnc, content: e.target.value } })}
                        className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-xs focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-300"
                    />
                    <Input
                        placeholder="Or paste an external URL — https://yoursite.com/terms"
                        value={settings.tnc.externalUrl}
                        onChange={(e) => update({ tnc: { ...settings.tnc, externalUrl: e.target.value } })}
                        className="text-xs border-neutral-200 focus:border-amber-400 focus:ring-amber-300"
                    />
                </div>
            )}

            {/* Suggested Courses expanded config */}
            {settings.suggestedCourses.enabled && (
                <div className="rounded-2xl border border-violet-200 bg-white p-4 shadow-sm space-y-3">
                    <p className="text-xs text-neutral-500">
                        Configure how "people also buy" upsell{' '}
                        {getTerminologyPlural(
                            ContentTerms.Course,
                            SystemTerms.Course
                        ).toLocaleLowerCase()}{' '}
                        appear to learners during checkout.
                    </p>
                    <div>
                        <p className="mb-2 text-xs font-semibold text-violet-700 uppercase tracking-wide">Section Heading</p>
                        <Input
                            placeholder="People also buy"
                            value={settings.suggestedCourses.heading}
                            onChange={(e) => update({ suggestedCourses: { ...settings.suggestedCourses, heading: e.target.value } })}
                            className="border-neutral-200 bg-neutral-50 focus:border-violet-400 focus:ring-violet-300"
                        />
                    </div>
                    <div>
                        <p className="mb-2 text-xs font-semibold text-violet-700 uppercase tracking-wide">Show On Step</p>
                        <div className="flex gap-2">
                            {(['CART', 'FORM', 'BOTH'] as const).map((val) => (
                                <button
                                    key={val}
                                    type="button"
                                    onClick={() => update({ suggestedCourses: { ...settings.suggestedCourses, showOn: val } })}
                                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                                        (settings.suggestedCourses.showOn ?? 'BOTH') === val
                                            ? 'border-violet-300 bg-violet-50 text-violet-700'
                                            : 'border-neutral-200 bg-white text-neutral-500 hover:border-neutral-300'
                                    }`}
                                >
                                    {val === 'CART' ? 'Cart' : val === 'FORM' ? 'Details' : 'Both'}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Post Enrollment Configuration */}
            <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
                {/* Header */}
                <div className="flex items-center gap-3 border-b border-neutral-100 bg-neutral-50/60 px-5 py-3">
                    <ExternalLink className="size-4 text-blue-500" />
                    <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Post Enrollment Configuration</p>
                </div>

                {/* Redirect after enrollment */}
                <div className="space-y-3 px-5 py-4">
                    <div>
                        <p className="text-sm font-semibold text-neutral-800">
                            Redirect After Enrollment{' '}
                            <span className="font-normal text-neutral-400">(Optional)</span>
                        </p>
                        <p className="mt-0.5 text-caption text-neutral-400">
                            Hand the learner over to your own thank-you page once the enrollment is
                            through. Leave empty to keep the built-in success page.
                        </p>
                    </div>

                    <Input
                        placeholder="https://example.com/thank-you or /dashboard"
                        value={redirectRaw}
                        onChange={(e) => update({ afterPaymentRedirectUrl: e.target.value })}
                        className="border-neutral-200 bg-neutral-50 text-sm focus:border-blue-400 focus:ring-blue-300"
                    />

                    {/* What will actually happen, spelled out. A redirect can only
                        be checked by enrolling, so the settings screen has to say
                        where the learner lands and after how long — a typo that
                        silently keeps the success page is otherwise invisible. */}
                    {redirectRaw.trim() === '' ? (
                        <p className="text-caption text-neutral-400">
                            No redirect — learners stay on the success page.
                        </p>
                    ) : redirectTarget ? (
                        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-success-200 bg-success-50 px-3 py-2">
                            <CheckCircle2 className="size-4 shrink-0 text-success-600" />
                            <p className="min-w-0 flex-1 text-caption text-success-700">
                                {redirectSummaryPrefix}
                                <span className="break-all font-semibold">{redirectTarget}</span>
                            </p>
                            {isAbsoluteRedirect && (
                                <a
                                    href={redirectTarget}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex shrink-0 items-center gap-1 text-caption font-semibold text-success-700 underline underline-offset-2"
                                >
                                    Test <ExternalLink className="size-3" />
                                </a>
                            )}
                        </div>
                    ) : (
                        <div className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2">
                            <Warning className="mt-0.5 size-4 shrink-0 text-warning-600" />
                            <p className="text-caption text-warning-700">
                                This isn&apos;t a destination a browser can open, so it will be
                                ignored and learners will stay on the success page. Use a full
                                address starting with{' '}
                                <span className="font-semibold">https://</span> or a path on this
                                site starting with <span className="font-semibold">/</span>.
                            </p>
                        </div>
                    )}

                    {/* Delay — only meaningful once there is somewhere to go. */}
                    {redirectTarget && (
                        <div className="space-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                            <div>
                                <p className="text-sm font-semibold text-neutral-800">
                                    Wait Before Redirecting
                                </p>
                                <p className="mt-0.5 text-caption text-neutral-400">
                                    How long the &quot;You&apos;re enrolled!&quot; screen stays up
                                    first. Keep a moment so the learner sees the enrollment went
                                    through — and so any conversion tag on this page has time to
                                    fire before the browser leaves.
                                </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                {REDIRECT_DELAY_PRESETS.map((preset) => (
                                    <button
                                        key={preset}
                                        type="button"
                                        onClick={() =>
                                            update({ afterPaymentRedirectDelaySeconds: preset })
                                        }
                                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                                            delaySeconds === preset
                                                ? 'border-primary-300 bg-primary-50 text-primary-500'
                                                : 'border-neutral-200 bg-white text-neutral-500 hover:border-neutral-300'
                                        }`}
                                    >
                                        {preset === 0 ? 'Instant' : `${preset}s`}
                                    </button>
                                ))}
                                <div className="flex items-center gap-2">
                                    <Input
                                        type="number"
                                        min={0}
                                        max={MAX_REDIRECT_DELAY_SECONDS}
                                        step={1}
                                        value={delaySeconds}
                                        onChange={(e) =>
                                            update({
                                                afterPaymentRedirectDelaySeconds:
                                                    clampRedirectDelay(Number(e.target.value)),
                                            })
                                        }
                                        className="w-20 border-neutral-200 bg-white text-sm focus:border-blue-400 focus:ring-blue-300"
                                    />
                                    <span className="text-caption text-neutral-500">
                                        seconds (max {MAX_REDIRECT_DELAY_SECONDS})
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Show Login Button toggle */}
                <div className="flex items-center gap-4 border-t border-neutral-100 px-5 py-4">
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-neutral-800">Show Login Button</p>
                        <p className="text-xs text-neutral-400">
                            Display the login button on the success page. Ignored while a redirect
                            is set — the learner is on their way out.
                        </p>
                    </div>
                    <Toggle
                        checked={settings.showLoginButton ?? true}
                        onChange={() => update({ showLoginButton: !(settings.showLoginButton ?? true) })}
                    />
                </div>

                {/* Auto-login after purchase toggle */}
                <div className="flex items-center gap-4 border-t border-neutral-100 px-5 py-4">
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-neutral-800">Log In Automatically After Purchase</p>
                        <p className="text-xs text-neutral-400">
                            Once the payment goes through, take a new buyer straight to their
                            dashboard, already logged in. Buyers who had an account before still
                            see the success page and log in themselves. Takes priority over the
                            redirect path.
                        </p>
                    </div>
                    <Toggle
                        checked={settings.autoLoginAfterPayment ?? false}
                        onChange={() => update({ autoLoginAfterPayment: !(settings.autoLoginAfterPayment ?? false) })}
                    />
                </div>

                {/* Success Page Content */}
                <div className="border-t border-neutral-100 px-5 py-4 space-y-2">
                    <p className="text-sm font-semibold text-neutral-800">Success Page Content <span className="font-normal text-neutral-400">(Optional)</span></p>
                    <textarea
                        rows={4}
                        placeholder="HTML/Text Content"
                        value={settings.successPageContent ?? ''}
                        onChange={(e) => update({ successPageContent: e.target.value })}
                        className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-xs focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300 resize-y"
                    />
                    <p className="text-[11px] text-neutral-400">Custom content to display on the success page. Overrides the default message. You may use HTML.</p>
                </div>
            </div>

        </div>
    );
};
