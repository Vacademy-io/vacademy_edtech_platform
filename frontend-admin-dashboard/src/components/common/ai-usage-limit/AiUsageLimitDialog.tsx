/**
 * "AI limit reached" modal, opened by the shared axios instance when an AI
 * call is refused with 429 AI_USAGE_LIMIT (see src/lib/ai-usage-limit.ts).
 *
 * It mounts itself into its own root on first use, so no layout has to host
 * it and nothing renders until a limit is actually hit. A second refusal while
 * the modal is open replaces its content instead of stacking dialogs.
 */
import { useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import {
    ArrowSquareOut,
    Clock,
    Gauge,
    HandPalm,
    SealCheck,
    ShieldCheck,
} from '@phosphor-icons/react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { MyButton } from '@/components/design-system/button';
import { formatDateTime, formatNumber, formatRelative } from '@/lib/formatters';
import { getInstituteId } from '@/constants/helper';
import { isAdminForInstitute } from '@/lib/auth/roleUtils';
import { usePlatformBrand } from '@/lib/platform-brand';
import { PLANS_SETTINGS_PATH } from '@/services/ai-plans/storefront';
import { useStorefrontProbe } from '@/components/common/ai-credits/PlanEntryPoints';
import {
    AI_LIMITS_SETTINGS_PATH,
    prettifyUseCase,
    type AiUsageLimitBody,
} from '@/lib/ai-usage-limit';

type Listener = (body: AiUsageLimitBody | null) => void;

let current: AiUsageLimitBody | null = null;
const listeners = new Set<Listener>();
let root: Root | null = null;

function publish(body: AiUsageLimitBody | null) {
    current = body;
    listeners.forEach((l) => l(body));
}

function ensureMounted() {
    if (root || typeof document === 'undefined') return;
    const el = document.createElement('div');
    el.setAttribute('data-ai-usage-limit-root', '');
    document.body.appendChild(el);
    root = createRoot(el);
    root.render(<AiUsageLimitDialogHost />);
}

/** Opens (or refreshes) the modal with a refusal body. */
export function openAiUsageLimitDialog(body: AiUsageLimitBody) {
    ensureMounted();
    publish(body);
}

/** When the limit resets: the server's resets_at, else now + Retry-After. */
function resetInstant(body: AiUsageLimitBody): Date | null {
    if (body.resets_at) {
        const d = new Date(body.resets_at);
        if (!Number.isNaN(d.getTime())) return d;
    }
    if (body.retry_after_seconds !== null && body.retry_after_seconds >= 0) {
        return new Date(Date.now() + body.retry_after_seconds * 1000);
    }
    return null;
}

function AiUsageLimitDialogHost() {
    const { t } = useTranslation('aiUsageLimit');
    const { t: tPlans } = useTranslation('aiPlans');
    const [body, setBody] = useState<AiUsageLimitBody | null>(current);
    const instituteId = (() => {
        try {
            return getInstituteId() ?? null;
        } catch {
            return null;
        }
    })();
    const brand = usePlatformBrand(instituteId);
    // A plan's fair-use cap was hit: admins may see plans (storefront on only).
    const storefront = useStorefrontProbe(instituteId, body?.period === 'PLAN_PERIOD');

    useEffect(() => {
        const l: Listener = (b) => setBody(b);
        listeners.add(l);
        return () => {
            listeners.delete(l);
        };
    }, []);

    if (!body) return null;

    const feature = body.use_case_label || prettifyUseCase(body.use_case) || t('fallbackFeature');
    const unitKey = body.unit === 'requests' || body.unit === 'usd' ? body.unit : 'credits';
    const fmt = (n: number) => formatNumber(n, { maximumFractionDigits: 2 });
    const usedText =
        body.used !== null && body.limit !== null
            ? t(`usedOfLimit.${unitKey}`, { used: fmt(body.used), limit: fmt(body.limit) })
            : null;
    const reset = resetInstant(body);
    const periodKey = ['DAY', 'WEEK', 'MONTH', 'PLAN_PERIOD'].includes(body.period ?? '')
        ? (body.period as string)
        : 'OTHER';
    const scopeKey = ['USER', 'ROLE', 'ROLE_CLASS', 'INSTITUTE', 'PLATFORM'].includes(
        body.scope ?? ''
    )
        ? (body.scope as string)
        : 'OTHER';
    const setByKey = body.set_by === 'PLATFORM' ? 'PLATFORM' : 'INSTITUTE';
    const isAdmin = (() => {
        try {
            return isAdminForInstitute(getInstituteId());
        } catch {
            return false;
        }
    })();

    const close = () => publish(null);

    return (
        <Dialog open onOpenChange={(open) => !open && close()}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <HandPalm className="size-5 text-warning-600" weight="fill" />
                        {t('title')}
                    </DialogTitle>
                    <DialogDescription>
                        {body.message || t('defaultMessage', { feature })}
                    </DialogDescription>
                </DialogHeader>

                <dl className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm">
                    <div className="flex items-start justify-between gap-4">
                        <dt className="text-neutral-500">{t('fields.feature')}</dt>
                        <dd className="text-end font-medium text-neutral-800">{feature}</dd>
                    </div>
                    {usedText && (
                        <div className="flex items-start justify-between gap-4">
                            <dt className="flex items-center gap-1.5 text-neutral-500">
                                <Gauge className="size-4" />
                                {t(`periodUsage.${periodKey}`)}
                            </dt>
                            <dd className="text-end font-medium text-neutral-800">{usedText}</dd>
                        </div>
                    )}
                    {reset && (
                        <div className="flex items-start justify-between gap-4">
                            <dt className="flex items-center gap-1.5 text-neutral-500">
                                <Clock className="size-4" />
                                {t('fields.resets')}
                            </dt>
                            <dd className="text-end font-medium text-neutral-800">
                                {formatDateTime(reset)}
                                <span className="block text-xs font-normal text-neutral-500">
                                    {formatRelative(reset)}
                                </span>
                            </dd>
                        </div>
                    )}
                    <div className="flex items-start justify-between gap-4">
                        <dt className="flex items-center gap-1.5 text-neutral-500">
                            <ShieldCheck className="size-4" />
                            {t('fields.setBy')}
                        </dt>
                        <dd className="text-end font-medium text-neutral-800">
                            {t(`setBy.${setByKey}`, brand.vars)}
                            <span className="block text-xs font-normal text-neutral-500">
                                {t(`scope.${scopeKey}`)}
                            </span>
                        </dd>
                    </div>
                </dl>

                <p className="text-xs text-neutral-500">
                    {isAdmin
                        ? setByKey === 'PLATFORM'
                            ? t('hint.adminPlatform', brand.vars)
                            : t('hint.admin')
                        : t('hint.member')}
                </p>

                <DialogFooter className="gap-2 sm:gap-2">
                    {isAdmin && storefront && periodKey === 'PLAN_PERIOD' && (
                        <a
                            href={PLANS_SETTINGS_PATH}
                            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
                        >
                            <SealCheck className="size-4" />
                            {tPlans('entry.seePlans')}
                        </a>
                    )}
                    {isAdmin && setByKey === 'INSTITUTE' && (
                        <a
                            href={AI_LIMITS_SETTINGS_PATH}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
                        >
                            <ArrowSquareOut className="size-4" />
                            {t('actions.reviewLimits')}
                        </a>
                    )}
                    <MyButton buttonType="primary" scale="medium" onClick={close}>
                        {t('actions.ok')}
                    </MyButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
