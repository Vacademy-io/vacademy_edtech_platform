import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Warning } from '@phosphor-icons/react';
import { AI_SERVICE_BASE_URL } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { cn } from '@/lib/utils';

interface TrialStatus {
    is_trial: boolean;
    expired: boolean;
    days_left: number | null;
}

interface TrialBannerProps {
    /** Translation namespace with trial.left_one / trial.left_other / trial.ended / trial.upgrade. */
    ns: string;
    /** The way to pay, rendered on the right; gets the translated trial.upgrade label. */
    renderUpgrade: (label: string) => ReactNode;
    /** False skips the request (e.g. not a product sign-up). */
    enabled?: boolean;
}

/**
 * Days left of a self sign-up's trial, or the way forward once it has ended. Silent otherwise.
 * One banner for every product (docs/PRODUCT_SELF_SIGNUP.md): ai_service decides who is on a trial.
 */
export const TrialBanner = ({ ns, renderUpgrade, enabled = true }: TrialBannerProps) => {
    const { t } = useTranslation(ns);
    const instituteId = getCurrentInstituteId();
    const { data } = useQuery({
        queryKey: ['SELF_SIGNUP_TRIAL', instituteId],
        queryFn: async () =>
            (
                await authenticatedAxiosInstance.get<TrialStatus>(
                    `${AI_SERVICE_BASE_URL}/credits/v1/institutes/${instituteId}/trial`
                )
            ).data,
        enabled: enabled && !!instituteId,
        staleTime: 5 * 60 * 1000,
        retry: false,
    });
    if (!data?.is_trial) return null;

    return (
        <div
            className={cn(
                'border-b px-4 py-2 text-caption',
                data.expired
                    ? 'border-danger-200 bg-danger-50 text-danger-700'
                    : 'border-warning-200 bg-warning-50 text-warning-700'
            )}
        >
            <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-1">
                    {data.expired && <Warning size={14} weight="fill" className="shrink-0" />}
                    {data.expired
                        ? t('trial.ended')
                        : t('trial.left', { count: data.days_left ?? 0 })}
                </span>
                {renderUpgrade(t('trial.upgrade'))}
            </div>
        </div>
    );
};
