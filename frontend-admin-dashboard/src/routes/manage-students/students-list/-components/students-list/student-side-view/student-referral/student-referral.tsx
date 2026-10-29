import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { ProfileFieldRow } from '../profile-ui';
import {
    fetchMemberReferral,
    memberReferralQueryKey,
    type MemberReferral,
} from '@/services/member-referral';

/**
 * "Refer a friend" details for this member, rendered inside the Overview tab's existing
 * Referral Details card: their referral code, a link to share for a chosen invite, the
 * people they referred and the discounts they earned for it.
 *
 * Renders nothing unless a course the member is enrolled in is sold through an invite with
 * a referral programme: without one there is nothing they can refer friends to. The first
 * open for an eligible member without a code creates one, the same way sending them a
 * referral announcement would.
 */
export const StudentReferral = ({
    userId,
    instituteId,
}: {
    userId: string | undefined;
    instituteId: string | undefined;
}) => {
    const { t } = useTranslation('manageStudentsReferral');
    // Undefined = let the server pick (the member's own invite when it takes referrals).
    const [inviteId, setInviteId] = useState<string | undefined>(undefined);
    const [copied, setCopied] = useState('');

    const { data, isFetching } = useQuery<MemberReferral>({
        queryKey: memberReferralQueryKey(userId ?? '', instituteId ?? '', inviteId),
        queryFn: () => fetchMemberReferral(userId ?? '', instituteId ?? '', inviteId),
        enabled: Boolean(userId && instituteId),
        staleTime: 5 * 60 * 1000,
        // Keep the details on screen while a different invite's link loads.
        placeholderData: (previous) => previous,
    });

    if (!data || data.unavailable_reason === 'NO_REFERRAL_COURSE') return null;

    const copy = async (text: string, label: string, key: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(key);
            toast.success(t('toast.copied', { field: label }));
            setTimeout(() => setCopied(''), 2000);
        } catch {
            toast.error(t('toast.copyFailed', { field: label }));
        }
    };

    const formatDate = (raw: string | null) => {
        if (!raw) return '';
        const parsed = new Date(raw);
        return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString();
    };

    return (
        <div className={cn('mt-2 space-y-3 border-t border-neutral-200 pt-2', isFetching && 'opacity-60')}>
            {data.referral_code && (
                <div>
                    <dl>
                        <ProfileFieldRow
                            label={t('fields.code')}
                            value={data.referral_code}
                            copied={copied === 'code'}
                            onCopy={() => copy(data.referral_code ?? '', t('fields.code'), 'code')}
                        />
                        <ProfileFieldRow
                            label={t('fields.link')}
                            value={data.short_referral_link ?? ''}
                            copied={copied === 'link'}
                            onCopy={() => copy(data.short_referral_link ?? '', t('fields.link'), 'link')}
                        />
                    </dl>
                    {data.invites.length > 1 && (
                        <div className="mt-1 flex items-center justify-between gap-3">
                            <span className="shrink-0 text-2xs text-muted-foreground">{t('fields.opens')}</span>
                            <Select value={data.invite_id ?? undefined} onValueChange={setInviteId}>
                                <SelectTrigger className="h-7 min-w-0 max-w-[65%] text-2xs">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {data.invites.map((invite) => (
                                        <SelectItem key={invite.id} value={invite.id} className="text-xs">
                                            {invite.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                    {data.invites.length === 1 && (
                        <ProfileFieldRow label={t('fields.opens')} value={data.invite_name ?? ''} />
                    )}
                </div>
            )}

            <div>
                <p className="mb-1 text-caption font-semibold uppercase tracking-wide text-neutral-400">
                    {t('labels.rewards')}
                </p>
                <dl>
                    <ProfileFieldRow label={t('rewards.ready')} value={String(data.rewards_ready)} />
                    <ProfileFieldRow label={t('rewards.pending')} value={String(data.rewards_pending)} />
                    <ProfileFieldRow label={t('rewards.used')} value={String(data.rewards_used)} />
                </dl>
            </div>

            <div>
                <p className="mb-1 text-caption font-semibold uppercase tracking-wide text-neutral-400">
                    {t('labels.referred', { count: data.referrals.length })}
                </p>
                {data.referrals.length === 0 ? (
                    <p className="text-2xs text-muted-foreground">{t('noReferrals')}</p>
                ) : (
                    <ul className="space-y-1">
                        {data.referrals.map((friend) => {
                            const converted = friend.status === 'ACTIVE';
                            return (
                                <li
                                    key={`${friend.user_id}-${friend.referred_at ?? ''}`}
                                    className="flex items-center justify-between gap-3 rounded-md py-1"
                                >
                                    <div className="min-w-0">
                                        <p className="truncate text-2xs font-medium text-card-foreground">
                                            {friend.full_name ||
                                                friend.email ||
                                                friend.mobile_number ||
                                                t('unknownFriend')}
                                        </p>
                                        <p className="truncate text-2xs text-muted-foreground">
                                            {[friend.email, formatDate(friend.referred_at)]
                                                .filter(Boolean)
                                                .join(' · ')}
                                        </p>
                                    </div>
                                    <span
                                        className={cn(
                                            'shrink-0 rounded-full px-2 py-0.5 text-2xs font-medium',
                                            converted
                                                ? 'bg-success-50 text-success-700'
                                                : 'bg-warning-50 text-warning-700'
                                        )}
                                        title={converted ? t('status.convertedHint') : t('status.pendingHint')}
                                    >
                                        {converted ? t('status.converted') : t('status.pending')}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
};

export default StudentReferral;
