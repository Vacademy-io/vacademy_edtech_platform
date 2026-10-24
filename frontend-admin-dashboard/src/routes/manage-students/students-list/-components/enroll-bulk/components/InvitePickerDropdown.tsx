import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useTranslation } from 'react-i18next';
import { useInvitesForPackageSession } from '../../../-hooks/useInvitesForPackageSession';

interface Props {
    instituteId: string;
    packageSessionId: string;
    value: string | null;
    onValueChange: (inviteId: string | null, inviteName: string | undefined) => void;
}

export const InvitePickerDropdown = ({
    instituteId,
    packageSessionId,
    value,
    onValueChange,
}: Props) => {
    const { t } = useTranslation('manageStudentsInvitePickerDropdown');
    const { data, isLoading } = useInvitesForPackageSession({
        instituteId,
        packageSessionId,
        enabled: !!instituteId && !!packageSessionId,
    });

    const invites = (data?.content ?? []).filter((invite) => {
        if (!invite.id) return false;
        const tag = (invite.tag ?? '').trim().toUpperCase();
        // Hide only the bare SUB_ORG admin/scoped invites — enrolling a learner
        // through those makes them a ROOT_ADMIN. SUBORG_LEARNER stays selectable.
        return tag !== 'SUB_ORG';
    });

    if (isLoading) {
        return (
            <div className="flex h-9 items-center rounded-md border border-neutral-200 bg-neutral-50 px-3 text-xs text-neutral-400">
                {t('loading')}
            </div>
        );
    }

    return (
        <Select
            value={value ?? '__auto__'}
            onValueChange={(v) => {
                if (v === '__auto__') {
                    onValueChange(null, undefined);
                } else {
                    const invite = invites.find((i) => i.id === v);
                    onValueChange(v, invite?.name);
                }
            }}
        >
            <SelectTrigger>
                <SelectValue placeholder={t('placeholder')} />
            </SelectTrigger>
            <SelectContent className="z-popover-above-modal">
                <SelectItem value="__auto__">
                    <span className="text-neutral-500 italic">{t('autoResolveOption')}</span>
                </SelectItem>
                {invites.map((invite) => (
                    <SelectItem key={invite.id} value={invite.id}>
                        <div className="flex flex-col">
                            <span className="font-medium">{invite.name}</span>
                            {invite.tag && (
                                <span className="text-xs text-neutral-400">
                                    {invite.tag}
                                    {invite.invite_code ? ` · ${invite.invite_code}` : ''}
                                </span>
                            )}
                        </div>
                    </SelectItem>
                ))}
                {invites.length === 0 && (
                    <div className="px-3 py-2 text-xs text-neutral-400">
                        {t('emptyState')}
                    </div>
                )}
            </SelectContent>
        </Select>
    );
};
