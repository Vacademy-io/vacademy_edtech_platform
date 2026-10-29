import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { HandCoins, Warning } from '@phosphor-icons/react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { ProfileSectionCard, ProfileFieldRow } from '../profile-ui';
import {
    fetchMemberReferral,
    memberReferralQueryKey,
    type MemberReferral,
} from '@/services/member-referral';

/**
 * "Refer a friend" for this member: their referral code, a link to share for a chosen
 * invite, the people they referred and the discounts they earned for it.
 *
 * Renders nothing for someone who is not a member of the institute (a lead, say) and has
 * referred nobody: there is no code to show. The first open for a member without a code
 * creates one, the same way sending them a referral announcement would.
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
        // Keep the card on screen while a different invite's link loads.
        placeholderData: (previous) => previous,
    });

    if (!data) return null;
    if (data.unavailable_reason === 'NOT_A_MEMBER' && data.referrals.length === 0) return null;

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

    // The member's own invite may have no referral programme; keep it selectable so the
    // picker always shows what the link currently opens.
    const inviteOptions =
        data.invite_id && !data.invites.some((i) => i.id === data.invite_id)
            ? [{ id: data.invite_id, name: data.invite_name || data.invite_id }, ...data.invites]
            : data.invites;

    const formatDate = (raw: string | null) => {
        if (!raw) return '';
        const parsed = new Date(raw);
        return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString();
    };

    return (
        <ProfileSectionCard icon={HandCoins} heading={t('heading')}>
            <div className={cn('space-y-3', isFetching && 'opacity-60')}>
                {data.unavailable_reason === 'NO_INVITE' ? (
                    <p className="text-2xs text-muted-foreground">{t('noInvite')}</p>
                ) : data.referral_code ? (
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
                                onCopy={() =>
                                    copy(data.short_referral_link ?? '', t('fields.link'), 'link')
                                }
                            />
                        </dl>
                        {inviteOptions.length > 0 && (
                            <div className="mt-1 flex items-center justify-between gap-3">
                                <span className="shrink-0 text-2xs text-muted-foreground">
                                    {t('fields.opens')}
                                </span>
                                <Select value={data.invite_id ?? undefined} onValueChange={setInviteId}>
                                    <SelectTrigger className="h-7 min-w-0 max-w-[65%] text-2xs">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {inviteOptions.map((invite) => (
                                            <SelectItem key={invite.id} value={invite.id} className="text-xs">
                                                {invite.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                        {!data.invite_has_referral_program && (
                            <p className="mt-2 flex items-start gap-1.5 rounded-md bg-warning-50 p-2 text-2xs text-warning-700">
                                <Warning className="mt-0.5 size-3.5 shrink-0" />
                                {t('noProgram')}
                            </p>
                        )}
                    </div>
                ) : null}

                <div className="border-t border-neutral-200 pt-2">
                    <p className="mb-1 text-caption font-semibold uppercase tracking-wide text-neutral-400">
                        {t('labels.rewards')}
                    </p>
                    <dl>
                        <ProfileFieldRow label={t('rewards.ready')} value={String(data.rewards_ready)} />
                        <ProfileFieldRow label={t('rewards.pending')} value={String(data.rewards_pending)} />
                        <ProfileFieldRow label={t('rewards.used')} value={String(data.rewards_used)} />
                    </dl>
                </div>

                <div className="border-t border-neutral-200 pt-2">
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
        </ProfileSectionCard>
    );
};

export default StudentReferral;
