import { useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Sparkle, Warning } from '@phosphor-icons/react';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { MyButton } from '@/components/design-system/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    AnalyticsTab,
    BillingTab,
    OverviewTab,
    TransactionsTab,
} from '@/components/common/ai-credits/AiCreditsPanel';
import { TopUpModal } from '@/components/common/ai-credits/TopUpModal';
import { UsageAnalyticsV2 } from '@/components/common/ai-credits/UsageAnalyticsV2';
import { UsageHistoryV2 } from '@/components/common/ai-credits/UsageHistoryV2';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { isIOS } from '@/native';
import { consumeTopUpReturnId } from '@/services/ai-credits/credit-pack-services';
import { useAiCreditsQuery } from '@/services/ai-credits/get-ai-credits';
import { useUsageConfigQuery } from '@/services/ai-credits/usage-v2';
import { formatCredits } from './-lib/format-credits';

export const Route = createFileRoute('/evalezy/credits')({
    component: EvalezyCredits,
});

/**
 * The institute's AI credits on the phone: what is left, where it went, the bills,
 * and a recharge. The tabs are the portal's own credit panel, which is already
 * phone-wide. Apple does not allow credit purchases outside In-App Purchase, so
 * recharge and bills stay off on iOS, as in the portal.
 */
function EvalezyCredits() {
    const { t } = useTranslation('evalezy');
    const queryClient = useQueryClient();
    const instituteId = getCurrentInstituteId();
    const credits = useAiCreditsQuery(true);
    const usageConfig = useUsageConfigQuery(instituteId, true);
    const [topUpOpen, setTopUpOpen] = useState(false);
    const [resumePaymentId, setResumePaymentId] = useState<string | null>(null);

    // Only an admin may buy (the backend enforces it); an unanswered config keeps the button.
    const canRecharge = !isIOS() && usageConfig.data?.is_admin !== false;
    const usageV2 =
        !!instituteId && usageConfig.data?.history_v2_enabled === true ? instituteId : null;
    const isAdmin = usageConfig.data?.is_admin === true;

    // Back from a payment on the web: resume waiting for it to clear.
    useEffect(() => {
        const paymentId = consumeTopUpReturnId();
        if (!paymentId) return;
        setResumePaymentId(paymentId);
        setTopUpOpen(true);
    }, []);

    // Back from the browser in the app: a recharge may have landed while it was away.
    useEffect(() => {
        const refresh = () => {
            if (document.visibilityState !== 'visible') return;
            void queryClient.invalidateQueries({ queryKey: ['GET_AI_CREDITS'] });
            void queryClient.invalidateQueries({ queryKey: ['GET_AI_TRANSACTIONS'] });
            void queryClient.invalidateQueries({ queryKey: ['GET_CREDIT_PACK_INVOICES'] });
        };
        document.addEventListener('visibilitychange', refresh);
        return () => document.removeEventListener('visibilitychange', refresh);
    }, [queryClient]);

    if (credits.isLoading) return <DashboardLoader />;

    if (credits.isError || !credits.data) {
        return (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-neutral-200 bg-white p-6 text-center">
                <p className="text-body text-danger-700">{t('credits.loadError')}</p>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="small"
                    onClick={() => void credits.refetch()}
                >
                    {t('credits.retry')}
                </MyButton>
            </div>
        );
    }

    const { current_balance: balance, is_low_balance: isLow } = credits.data;

    return (
        <div className="flex flex-col gap-4">
            <h1 className="text-h3 font-semibold text-neutral-800">{t('credits.title')}</h1>

            <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4">
                <div className="flex items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-purple-50 text-purple-700">
                        <Sparkle size={20} weight="fill" />
                    </span>
                    <div className="min-w-0">
                        <p className="text-h2 font-semibold text-neutral-800">
                            {formatCredits(balance)}
                        </p>
                        <p className="text-caption text-neutral-500">{t('credits.left')}</p>
                    </div>
                </div>
                {isLow && (
                    <p className="flex items-start gap-1 rounded-md bg-warning-50 p-2 text-caption text-warning-700">
                        <Warning size={14} className="mt-px shrink-0" weight="fill" />
                        {t('credits.low')}
                    </p>
                )}
                {canRecharge && (
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        className="w-full sm:w-fit"
                        onClick={() => setTopUpOpen(true)}
                    >
                        {t('credits.recharge')}
                    </MyButton>
                )}
            </section>

            <Tabs defaultValue="overview" className="flex w-full flex-col gap-3">
                <TabsList className="grid h-auto w-full grid-cols-3 bg-neutral-100 sm:w-fit">
                    <TabsTrigger value="overview">{t('credits.tabOverview')}</TabsTrigger>
                    <TabsTrigger value="history">{t('credits.tabHistory')}</TabsTrigger>
                    <TabsTrigger value="usage">{t('credits.tabUsage')}</TabsTrigger>
                </TabsList>
                <TabsContent value="overview" className="mt-0">
                    <OverviewTab />
                </TabsContent>
                <TabsContent value="history" className="mt-0">
                    {usageV2 ? (
                        <UsageHistoryV2 instituteId={usageV2} isAdmin={isAdmin} />
                    ) : (
                        <TransactionsTab />
                    )}
                </TabsContent>
                <TabsContent value="usage" className="mt-0">
                    {usageV2 ? (
                        <UsageAnalyticsV2 instituteId={usageV2} isAdmin={isAdmin} />
                    ) : (
                        <AnalyticsTab />
                    )}
                </TabsContent>
            </Tabs>

            {!isIOS() && (
                <section className="flex flex-col gap-2">
                    <h2 className="text-subtitle font-semibold text-neutral-800">
                        {t('credits.bills')}
                    </h2>
                    <BillingTab />
                </section>
            )}

            {canRecharge && (
                <TopUpModal
                    open={topUpOpen}
                    onOpenChange={(open) => {
                        setTopUpOpen(open);
                        if (!open) setResumePaymentId(null);
                    }}
                    resumePaymentId={resumePaymentId}
                />
            )}
        </div>
    );
}
