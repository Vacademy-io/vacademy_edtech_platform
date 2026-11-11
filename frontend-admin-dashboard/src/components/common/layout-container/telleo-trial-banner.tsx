import { useQuery } from '@tanstack/react-query';
import { Warning } from '@phosphor-icons/react';
import { readCurrentInstituteIdSafely } from '@/services/capabilities';
import { useNavSnapshotStore } from '@/lib/capabilities/use-entitlement';
import { cn } from '@/lib/utils';
import { fetchOnboarding } from '@/routes/telleo/-services/telleo-onboarding';

/** Telleo sales on WhatsApp (telleo.ai docs/PRODUCT_FACTS.md) until in-product payment exists. */
const UPGRADE_URL =
    'https://wa.me/919993336616?text=' + encodeURIComponent('I want to upgrade my Telleo account');

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Days left of a Telleo self sign-up's free trial, or that it has ended, above every dashboard
 * page. Only asks the server for accounts whose display settings are an allow-list (how Telleo
 * sign-ups are set up), so no other institute makes the request.
 */
export const TelleoTrialBanner = () => {
    const allowListOnly = useNavSnapshotStore((s) => s.snapshot?.allowListOnly === true);
    const instituteId = readCurrentInstituteIdSafely();
    const { data } = useQuery({
        queryKey: ['TELLEO_ONBOARDING', instituteId],
        queryFn: () => fetchOnboarding(instituteId!),
        enabled: allowListOnly && !!instituteId,
        staleTime: 5 * 60 * 1000,
        retry: false,
    });
    if (!data || data.account_state !== 'TRIAL' || !data.trial_ends_at) return null;

    const msLeft = new Date(data.trial_ends_at).getTime() - Date.now();
    const expired = msLeft <= 0;
    const daysLeft = Math.max(1, Math.ceil(msLeft / DAY_MS));

    return (
        <div
            className={cn(
                'border-b px-4 py-2 text-caption',
                expired
                    ? 'border-danger-200 bg-danger-50 text-danger-700'
                    : 'border-warning-200 bg-warning-50 text-warning-700'
            )}
        >
            <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-1">
                    {expired && <Warning size={14} weight="fill" className="shrink-0" />}
                    {expired
                        ? 'Your free trial has ended, so calls are paused.'
                        : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left in your free trial. Your agent can call only your verified number.`}
                </span>
                <a
                    href={UPGRADE_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 font-semibold underline"
                >
                    Upgrade
                </a>
            </div>
        </div>
    );
};
