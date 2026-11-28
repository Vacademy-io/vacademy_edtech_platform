import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { GET_INVITE_LINKS } from '@/constants/urls';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { FieldHint } from '../primitives';

interface InviteOption {
    id: string;
    name: string;
}

/** Radix Select cannot hold an empty value, so "no invite" travels as this sentinel. */
const MEMBER_OWN_INVITE = '__member_own_invite__';

async function searchInvites(search: string): Promise<InviteOption[]> {
    const response = await authenticatedAxiosInstance<{ content?: InviteOption[] }>({
        method: 'POST',
        url: `${GET_INVITE_LINKS}?instituteId=${getCurrentInstituteId()}&pageNo=0&pageSize=20`,
        data: {
            search_name: search,
            package_session_ids: [],
            payment_option_ids: [],
            sort_columns: {},
            tags: [],
        },
    });
    return (response.data?.content ?? []).map((invite) => ({ id: invite.id, name: invite.name }));
}

/**
 * Which enroll invite a member's personal referral link opens in this announcement
 * (`referral_enroll_invite_id` on the medium config), e.g. the trial a friend should join.
 * Unset, each member's stored link opens whichever invite they enrolled through.
 */
export function ReferralInvitePicker({
    value,
    onChange,
    hint,
}: {
    value: string;
    onChange: (inviteId: string) => void;
    hint: string;
}) {
    const { t } = useTranslation('announcementCreateConstants');
    const [search, setSearch] = useState('');
    // Nothing is fetched until the admin actually opens the picker or searches, so an
    // announcement that never uses referral links makes no extra request.
    const [touched, setTouched] = useState(Boolean(value));
    const { data: invites = [], isLoading } = useQuery({
        queryKey: ['announcement-referral-invites', search],
        queryFn: () => searchInvites(search.trim()),
        staleTime: 60_000,
        enabled: touched,
    });

    return (
        <div className="space-y-1">
            <Label className="text-caption font-semibold">
                {t('referralInvite.label', { defaultValue: 'Referral links open' })}
            </Label>
            <Input
                value={search}
                onChange={(e) => {
                    setTouched(true);
                    setSearch(e.target.value);
                }}
                placeholder={t('referralInvite.search', { defaultValue: 'Search invites by name' })}
            />
            <Select
                value={value || MEMBER_OWN_INVITE}
                onValueChange={(picked) => onChange(picked === MEMBER_OWN_INVITE ? '' : picked)}
                onOpenChange={(open) => open && setTouched(true)}
            >
                <SelectTrigger>
                    <SelectValue
                        placeholder={
                            touched && isLoading
                                ? t('referralInvite.loading', { defaultValue: 'Loading invites…' })
                                : t('referralInvite.choose', { defaultValue: 'Choose an invite' })
                        }
                    />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={MEMBER_OWN_INVITE}>
                        {t('referralInvite.memberOwn', {
                            defaultValue: "Each member's own invite (default)",
                        })}
                    </SelectItem>
                    {invites.map((invite) => (
                        <SelectItem key={invite.id} value={invite.id}>
                            {invite.name}
                        </SelectItem>
                    ))}
                    {/* Keep a chosen invite visible after the search moves on. */}
                    {value && !invites.some((invite) => invite.id === value) && (
                        <SelectItem value={value}>
                            {t('referralInvite.selected', { defaultValue: 'Selected invite' })}
                        </SelectItem>
                    )}
                </SelectContent>
            </Select>
            <FieldHint>{hint}</FieldHint>
        </div>
    );
}
