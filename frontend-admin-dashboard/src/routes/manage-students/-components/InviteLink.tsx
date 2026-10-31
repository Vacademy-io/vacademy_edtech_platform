import { Check, Copy, DotsThreeVertical } from '@phosphor-icons/react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import createInviteLink from '../invite/-utils/createInviteLink';
import { MyButton } from '@/components/design-system/button';
import { toast } from 'sonner';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { UtmLinkMenuItem } from '@/components/common/utm/utm-link-menu-item';
import { UtmBuilderDialog } from '@/components/common/utm/utm-builder-dialog';
import { useUtmBuilderEnabled } from '@/hooks/use-utm-builder-enabled';

export const InviteLink = ({
    inviteCode,
    inviteName,
}: {
    inviteCode: string;
    /** Shown in the UTM builder header so an admin knows which invite they are tagging. */
    inviteName?: string;
}) => {
    const { t } = useTranslation('manageStudentsInviteLinkComponent');
    const [copySuccess, setCopySuccess] = useState<string | null>(null);
    const [openUtmDialog, setOpenUtmDialog] = useState(false);
    const { instituteDetails } = useInstituteDetailsStore();
    // The ⋮ menu holds exactly one action today, so it would render as an empty
    // popover for every institute that has not switched the builder on. Ask the
    // same gate the item asks and skip the trigger entirely when it is off.
    const { enabled: utmEnabled } = useUtmBuilderEnabled();
    const inviteLink = createInviteLink(inviteCode, instituteDetails?.learner_portal_base_url);
    const handleCopyClick = (link: string) => {
        navigator.clipboard
            .writeText(link)
            .then(() => {
                setCopySuccess(link);
                setTimeout(() => {
                    setCopySuccess(null);
                }, 2000);
            })
            .catch((err) => {
                console.log('Failed to copy link: ', err);
                toast.error(t('copyFailedToast'));
            });
    };
    return (
        <div className="flex items-center gap-4">
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger>
                        <a
                            href={inviteLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-body text-neutral-600 underline hover:text-primary-500"
                        >
                            {`${inviteLink}`}
                        </a>
                    </TooltipTrigger>
                    <TooltipContent className="cursor-pointer border border-neutral-300 bg-neutral-50 text-neutral-600 hover:text-primary-500">
                        <a href={inviteLink} target="_blank" rel="noopener noreferrer">
                            {inviteLink}
                        </a>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
            <div className="flex items-center gap-2">
                <MyButton
                    buttonType="secondary"
                    scale="medium"
                    layoutVariant="icon"
                    onClick={() => handleCopyClick(inviteLink)}
                >
                    <Copy />
                </MyButton>
                {copySuccess == inviteLink && (
                    <div className="text-primary-500">
                        <Check />
                    </div>
                )}
                {utmEnabled && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <MyButton buttonType="secondary" scale="medium" layoutVariant="icon">
                                <DotsThreeVertical />
                            </MyButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <UtmLinkMenuItem
                                hidden={!inviteCode}
                                onSelect={() => setOpenUtmDialog(true)}
                            />
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>

            <UtmBuilderDialog
                open={openUtmDialog}
                onOpenChange={setOpenUtmDialog}
                baseUrl={inviteLink}
                sourceType="ENROLL_INVITE"
                entityName={inviteName}
            />
        </div>
    );
};
