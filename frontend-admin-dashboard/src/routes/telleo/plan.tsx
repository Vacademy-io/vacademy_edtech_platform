import { useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, CheckCircle, Crown, Warning } from '@phosphor-icons/react';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { MyButton } from '@/components/design-system/button';
import { getInstituteId } from '@/constants/helper';
import { cn } from '@/lib/utils';
import { isIOS } from '@/native/platform';
import { useStorefrontQuery } from '@/services/ai-plans/storefront';
import { AiPlanBilling } from '@/routes/settings/-components/ai-plan/AiPlanBilling';
import {
    usePlanAccess,
    type PlanAccess,
    type ProductPlan,
} from '@/routes/evalezy/-hooks/usePlanAccess';
import { fetchOnboarding, type AccessMode } from './-services/telleo-onboarding';

/**
 * Telleo's plans: the workspace's trial or plan, and the plans it can buy. Telleo is sold two ways,
 * the dashboard and the API, each with its own plans (product plans tagged access_mode). The list
 * opens on the kind the workspace chose at setup; the other is one tap away. Paying is the AI plans
 * checkout (AiPlanBilling), which also manages a live plan. Outside the dashboard layout, like
 * /telleo/setup, so the four-page sidebar block does not apply. Mails and the trial banner link here.
 */
export const Route = createFileRoute('/telleo/plan')({
    // buy=<plan>: "Pay now" from setup, or a website Buy link; opens that plan's checkout.
    // Passthrough: the payment return (plan_pp, razorpay_*) is read from the URL by its own code.
    validateSearch: (search: Record<string, unknown>): { buy?: string } => ({
        ...search,
        buy: typeof search.buy === 'string' && search.buy ? search.buy : undefined,
    }),
    component: TelleoPlanPage,
});

/** Where the support mails go (telleo.ai's contact address). */
const SUPPORT_EMAIL = 'support@telleo.ai';
/** One minute of AI calling (ai_call_out), as the trial's 50 credits = 10 minutes. */
const CREDITS_PER_MINUTE = 5;

const inr = (amount: number) =>
    new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
    }).format(amount);

const shortDate = (iso: string | null | undefined) =>
    iso
        ? new Date(iso).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
          })
        : '';

/** A plan for this kind of workspace: tagged with it, or not tagged (sold to every workspace). */
const plansFor = (plans: ProductPlan[] | null | undefined, mode: AccessMode) =>
    (plans ?? []).filter((p) => !p.access_mode || p.access_mode === mode);

function TelleoPlanPage() {
    const { t } = useTranslation('telleoSetup');
    const instituteId = getInstituteId() ?? '';
    const access = usePlanAccess();
    const onboarding = useQuery({
        queryKey: ['TELLEO_ONBOARDING', instituteId],
        queryFn: () => fetchOnboarding(instituteId),
        enabled: !!instituteId,
        retry: false,
    });
    // An account set up before the choice, or not through Telleo sign-up, is the dashboard.
    const chosen: AccessMode = onboarding.data?.access_mode === 'API' ? 'API' : 'PLATFORM';
    const [track, setTrack] = useState<AccessMode | null>(null);
    const shown = track ?? chosen;

    const { buy } = Route.useSearch();
    const navigate = Route.useNavigate();
    // A checkout request: n changes on every Buy, so the checkout opens again for a second click.
    const [checkout, setCheckout] = useState<{ plan: string; n: number } | null>(() =>
        buy && !isIOS() ? { plan: buy, n: 0 } : null
    );
    useEffect(() => {
        if (buy) void navigate({ search: (prev) => ({ ...prev, buy: undefined }), replace: true });
    }, [buy, navigate]);
    // Plans are sold online when the storefront answers for this workspace (never on iOS).
    const storefront = useStorefrontQuery(instituteId, !isIOS());

    if (access.isLoading || (onboarding.isLoading && !!instituteId)) return <DashboardLoader />;
    const backTo = chosen === 'API' ? '/calling/ai-agents' : '/audience-manager/list';

    return (
        <main className="min-h-screen-safe flex w-full min-w-0 flex-col items-center bg-neutral-50 p-4 sm:py-8">
            <div className="flex w-full max-w-3xl flex-col gap-4">
                <a
                    href={backTo}
                    className="flex w-fit items-center gap-1 text-caption font-medium text-neutral-500 hover:text-neutral-800"
                >
                    <ArrowLeft size={14} />
                    {t('plans.back', 'Back to Telleo')}
                </a>
                <h1 className="text-h3 font-semibold text-neutral-800">
                    {t('plans.title', 'Plans')}
                </h1>
                {!access.data ? (
                    <div className="flex flex-col items-center gap-2 rounded-lg border border-neutral-200 bg-white p-6 text-center">
                        <Warning size={28} className="text-warning-600" />
                        <p className="text-body text-neutral-600">
                            {t('plans.loadFailed', 'Your plan could not be loaded.')}
                        </p>
                        <MyButton buttonType="secondary" onClick={() => void access.refetch()}>
                            {t('plans.retry', 'Try again')}
                        </MyButton>
                    </div>
                ) : (
                    <>
                        <CurrentPlanCard access={access.data} />
                        {access.data.status !== 'MANAGED' && (
                            <PlanList
                                access={access.data}
                                track={shown}
                                chosen={chosen}
                                onTrack={setTrack}
                                onBuy={(plan) =>
                                    setCheckout((c) => ({ plan, n: (c?.n ?? 0) + 1 }))
                                }
                            />
                        )}
                    </>
                )}
                {checkout && !storefront.isLoading && !storefront.data && (
                    <p className="flex items-start gap-1 rounded-md bg-warning-50 p-3 text-body text-warning-700">
                        <Warning size={16} className="mt-0.5 shrink-0" weight="fill" />
                        {t('plans.checkoutUnavailable', {
                            email: SUPPORT_EMAIL,
                            defaultValue:
                                'Online payment is not open for your account yet. Write to {{email}} and we will send you a payment link.',
                        })}
                    </p>
                )}
                {/* The checkout, and a live plan's management and invoices. Plans are listed above. */}
                {storefront.data && (
                    <section className="rounded-lg border border-neutral-200 bg-white p-4">
                        <AiPlanBilling
                            key={checkout?.n ?? -1}
                            buyPlanKey={checkout?.plan}
                            hideHeading
                            hideCatalog
                        />
                    </section>
                )}
            </div>
        </main>
    );
}

const CurrentPlanCard = ({ access }: { access: PlanAccess }) => {
    const { t } = useTranslation('telleoSetup');
    const onPlan = access.status === 'PLAN';
    const onTrial = access.status === 'TRIAL';
    const pending = access.status === 'PAYMENT_PENDING';
    return (
        <section className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-caption font-medium uppercase text-neutral-500">
                    {t('plans.current', 'Current plan')}
                </span>
                {onTrial && (
                    <span
                        className={cn(
                            'rounded-full px-2 py-0.5 text-caption font-semibold',
                            access.trial_expired
                                ? 'bg-danger-50 text-danger-700'
                                : 'bg-warning-50 text-warning-700'
                        )}
                    >
                        {access.trial_expired
                            ? t('plans.trialEnded', 'Trial ended')
                            : t('plans.trialBadge', 'Trial')}
                    </span>
                )}
            </div>
            <p className="flex items-center gap-2 text-h3 font-semibold text-neutral-800">
                {onPlan && <Crown size={20} weight="fill" className="text-warning-500" />}
                {onPlan
                    ? access.plan_name
                    : onTrial
                      ? t('plans.freeTrial', 'Free trial')
                      : pending
                        ? t('plans.pendingTitle', 'Waiting for payment')
                        : t('plans.managed', 'Set up by our team')}
            </p>
            {pending && (
                <p className="flex items-start gap-1 rounded-md bg-warning-50 p-2 text-body text-warning-700">
                    <Warning size={16} className="mt-0.5 shrink-0" weight="fill" />
                    {t(
                        'plans.pendingBody',
                        'You signed up to buy a plan. Pay for it below to start making calls.'
                    )}
                </p>
            )}
            {onPlan && access.plan_ends_at && (
                <p className="text-body text-neutral-600">
                    {t('plans.validTill', {
                        date: shortDate(access.plan_ends_at),
                        defaultValue: 'Valid till {{date}}',
                    })}
                </p>
            )}
            {onTrial && access.trial_ends_at && (
                <p className="text-body text-neutral-600">
                    {access.trial_expired
                        ? t('plans.trialEndedOn', {
                              date: shortDate(access.trial_ends_at),
                              defaultValue:
                                  'Your free trial ended on {{date}}. Choose a plan to start calling again.',
                          })
                        : t('plans.trialEndsOn', {
                              date: shortDate(access.trial_ends_at),
                              defaultValue: 'Your free trial runs until {{date}}.',
                          })}
                </p>
            )}
        </section>
    );
};

const PlanList = ({
    access,
    track,
    chosen,
    onTrack,
    onBuy,
}: {
    access: PlanAccess;
    track: AccessMode;
    chosen: AccessMode;
    onTrack: (mode: AccessMode) => void;
    onBuy: (planKey: string) => void;
}) => {
    const { t } = useTranslation('telleoSetup');
    const plans = plansFor(access.plans, track);
    const period = (p: ProductPlan) => {
        const months = p.validity_months ?? access.plan_validity_months ?? 12;
        return months === 1
            ? t('plans.perMonth', '/ month')
            : months === 12
              ? t('plans.perYear', '/ year')
              : t('plans.perMonths', { count: months, defaultValue: '/ {{count}} months' });
    };
    const tab = (mode: AccessMode, label: string) => (
        <button
            type="button"
            role="tab"
            aria-selected={track === mode}
            onClick={() => onTrack(mode)}
            className={cn(
                'flex items-center gap-1 rounded-md px-3 py-1.5 text-subtitle font-medium transition-colors',
                track === mode
                    ? 'bg-white text-neutral-800 shadow-sm'
                    : 'text-neutral-500 hover:text-neutral-800'
            )}
        >
            {label}
            {mode === chosen && (
                <span className="rounded-full bg-primary-50 px-1.5 text-caption text-primary-500">
                    {t('plans.yourTrack', 'Your setup')}
                </span>
            )}
        </button>
    );

    return (
        <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div role="tablist" className="flex w-fit gap-1 rounded-lg bg-neutral-100 p-1">
                    {tab('PLATFORM', t('plans.trackDashboard', 'Dashboard'))}
                    {tab('API', t('plans.trackApi', 'API'))}
                </div>
                <p className="text-caption text-neutral-500">
                    {track === 'API'
                        ? t(
                              'plans.trackApiBody',
                              'Place calls from your own software with an API key. No dashboard seats.'
                          )
                        : t(
                              'plans.trackDashboardBody',
                              'Upload leads, run AI agents and see every call in the Telleo dashboard.'
                          )}
                </p>
            </div>

            {plans.length === 0 ? (
                <p className="flex items-start gap-1 rounded-md bg-neutral-100 p-3 text-body text-neutral-600">
                    {t('plans.noPlans', {
                        email: SUPPORT_EMAIL,
                        defaultValue:
                            'Plans for this setup are not online yet. Write to {{email}} and we will set you up.',
                    })}
                </p>
            ) : (
                <div className="grid gap-3 sm:grid-cols-3">
                    {plans.map((p) => {
                        const current = access.status === 'PLAN' && p.key === access.plan_key;
                        const minutes = Math.round((p.credits ?? 0) / CREDITS_PER_MINUTE);
                        return (
                            <div
                                key={p.key}
                                className={cn(
                                    'flex flex-col gap-3 rounded-lg border bg-white p-4',
                                    current ? 'border-primary-500' : 'border-neutral-200'
                                )}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <h3 className="text-subtitle font-semibold text-neutral-800">
                                        {p.name}
                                    </h3>
                                    {current && (
                                        <span className="rounded-full bg-primary-50 px-2 py-0.5 text-caption font-semibold text-primary-500">
                                            {t('plans.currentBadge', 'Current')}
                                        </span>
                                    )}
                                </div>
                                <p className="text-h2 font-semibold text-neutral-800">
                                    {p.price_inr == null ? (
                                        <span className="text-subtitle">
                                            {t('plans.noPrice', 'Price on request')}
                                        </span>
                                    ) : (
                                        <>
                                            {inr(p.price_inr)}
                                            <span className="text-body font-normal text-neutral-500">
                                                {' '}
                                                {period(p)}
                                            </span>
                                        </>
                                    )}
                                </p>
                                <p className="flex flex-1 items-start gap-1 text-body text-neutral-600">
                                    <CheckCircle
                                        size={16}
                                        className="mt-0.5 shrink-0 text-success-600"
                                    />
                                    {minutes > 0
                                        ? t('plans.minutes', {
                                              minutes: minutes.toLocaleString('en-IN'),
                                              defaultValue:
                                                  'About {{minutes}} minutes of AI calling included',
                                          })
                                        : t(
                                              'plans.payPerUse',
                                              'No bundled minutes: pay per connected minute'
                                          )}
                                </p>
                                {/* No purchase in the iPhone app (Apple Guideline 3.1.1). */}
                                {!current && p.price_inr != null && !isIOS() && (
                                    <MyButton
                                        buttonType="primary"
                                        className="w-full"
                                        onClick={() => onBuy(p.key)}
                                    >
                                        {t('plans.buy', {
                                            plan: p.name,
                                            defaultValue: 'Buy {{plan}}',
                                        })}
                                    </MyButton>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
            <p className="text-caption text-neutral-500">
                {t('plans.gst', 'Prices exclude 18% GST.')}{' '}
                {t('plans.enterprise', {
                    email: SUPPORT_EMAIL,
                    defaultValue:
                        'Need volume rates or a dedicated calling line? Write to {{email}}.',
                })}
            </p>
        </section>
    );
};
