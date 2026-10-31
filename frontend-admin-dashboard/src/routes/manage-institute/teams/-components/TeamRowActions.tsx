import { useTranslation } from 'react-i18next';
import {
    ArrowClockwise,
    Buildings,
    CheckCircle,
    DotsThree,
    Key,
    PencilSimple,
    Prohibit,
    ShieldCheck,
    Trash,
    XCircle,
} from '@phosphor-icons/react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MyButton } from '@/components/design-system/button';
import { hasNeverSignedIn, type TeamMember } from '../-utils/team-helpers';
import type { MemberSection } from './MemberDetailsSheet';

const itemClass = 'cursor-pointer gap-2.5 py-2 text-body';
const dangerClass = `${itemClass} text-danger-600 focus:bg-danger-50 focus:text-danger-700`;

/** Edit + overflow menu for an active or disabled member (≤2 inline actions). */
export function MemberRowActions({
    member,
    canAssignSubOrgs,
    subOrgLabel,
    canCopyLogin,
    onEdit,
    onCopyLogin,
    onStatus,
}: {
    member: TeamMember;
    canAssignSubOrgs: boolean;
    subOrgLabel: string;
    canCopyLogin: boolean;
    onEdit: (member: TeamMember, section?: MemberSection) => void;
    onCopyLogin: (member: TeamMember) => void;
    onStatus: (kind: 'disable' | 'enable' | 'delete' | 'resend', member: TeamMember) => void;
}) {
    const { t } = useTranslation('manageInstituteTeamsIndexLazy');
    const disabled = member.status === 'DISABLED';
    // Members are active as soon as they're added; until they first sign in the admin can
    // email the login details again.
    const canResendLogin = !disabled && hasNeverSignedIn(member);
    return (
        <div className="flex items-center justify-end gap-1">
            <MyButton
                buttonType="text"
                scale="medium"
                layoutVariant="icon"
                aria-label={t('actions.edit')}
                title={t('actions.edit')}
                onClick={() => onEdit(member)}
            >
                <PencilSimple size={17} className="text-neutral-500" />
            </MyButton>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <MyButton
                        buttonType="text"
                        scale="medium"
                        layoutVariant="icon"
                        aria-label={t('actions.more')}
                        title={t('actions.more')}
                    >
                        <DotsThree size={20} weight="bold" className="text-neutral-500" />
                    </MyButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem className={itemClass} onClick={() => onEdit(member)}>
                        <PencilSimple size={16} className="text-neutral-500" />
                        {t('actions.editDetails')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        className={itemClass}
                        onClick={() => onEdit(member, 'access')}
                    >
                        <ShieldCheck size={16} className="text-neutral-500" />
                        {t('actions.changeRole')}
                    </DropdownMenuItem>
                    {canAssignSubOrgs && (
                        <DropdownMenuItem
                            className={itemClass}
                            onClick={() => onEdit(member, 'access')}
                        >
                            <Buildings size={16} className="text-neutral-500" />
                            {subOrgLabel}
                        </DropdownMenuItem>
                    )}
                    {canCopyLogin && member.password && (
                        <DropdownMenuItem className={itemClass} onClick={() => onCopyLogin(member)}>
                            <Key size={16} className="text-neutral-500" />
                            {t('login.copyDetails')}
                        </DropdownMenuItem>
                    )}
                    {canResendLogin && (
                        <DropdownMenuItem
                            className={itemClass}
                            onClick={() => onStatus('resend', member)}
                        >
                            <ArrowClockwise size={16} className="text-neutral-500" />
                            {t('actions.resend')}
                        </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    {disabled ? (
                        <DropdownMenuItem
                            className={itemClass}
                            onClick={() => onStatus('enable', member)}
                        >
                            <CheckCircle size={16} className="text-neutral-500" />
                            {t('actions.enable')}
                        </DropdownMenuItem>
                    ) : (
                        <DropdownMenuItem
                            className={itemClass}
                            onClick={() => onStatus('disable', member)}
                        >
                            <Prohibit size={16} className="text-neutral-500" />
                            {t('actions.disable')}
                        </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                        className={dangerClass}
                        onClick={() => onStatus('delete', member)}
                    >
                        <Trash size={16} />
                        {t('actions.delete')}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}

/** Resend + overflow menu for a pending invite (left over from before members were active on creation). */
export function InviteRowActions({
    invite,
    canCopyLogin,
    onEdit,
    onResend,
    onCancel,
    onCopyLogin,
}: {
    invite: TeamMember;
    canCopyLogin: boolean;
    onEdit: (invite: TeamMember) => void;
    onResend: (invite: TeamMember) => void;
    onCancel: (invite: TeamMember) => void;
    onCopyLogin: (invite: TeamMember) => void;
}) {
    const { t } = useTranslation('manageInstituteTeamsIndexLazy');
    return (
        <div className="flex items-center justify-end gap-1">
            <MyButton buttonType="secondary" scale="small" onClick={() => onResend(invite)}>
                <ArrowClockwise size={14} />
                {t('actions.resendShort')}
            </MyButton>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <MyButton
                        buttonType="text"
                        scale="medium"
                        layoutVariant="icon"
                        aria-label={t('actions.more')}
                        title={t('actions.more')}
                    >
                        <DotsThree size={20} weight="bold" className="text-neutral-500" />
                    </MyButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem className={itemClass} onClick={() => onEdit(invite)}>
                        <PencilSimple size={16} className="text-neutral-500" />
                        {t('actions.editInvite')}
                    </DropdownMenuItem>
                    <DropdownMenuItem className={itemClass} onClick={() => onResend(invite)}>
                        <ArrowClockwise size={16} className="text-neutral-500" />
                        {t('actions.resend')}
                    </DropdownMenuItem>
                    {canCopyLogin && invite.password && (
                        <DropdownMenuItem className={itemClass} onClick={() => onCopyLogin(invite)}>
                            <Key size={16} className="text-neutral-500" />
                            {t('login.copyDetails')}
                        </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className={dangerClass} onClick={() => onCancel(invite)}>
                        <XCircle size={16} />
                        {t('actions.cancelInvite')}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
