import { useTranslation } from 'react-i18next';
import { CircleNotch } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useMutation } from '@tanstack/react-query';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import {
    resendSubOrgAdminCredentials,
    type SubOrgListItem,
} from '../../-services/custom-team-services';

interface ShareAdminCredentialsDialogProps {
    /** The row whose admin gets the mail; null keeps the dialog closed. */
    org: SubOrgListItem | null;
    onOpenChange: (open: boolean) => void;
}

/**
 * Manage VLEs → row menu → "Share credentials".
 *
 * Re-sends the sub-org admin's current login details by email. It is a confirm step rather
 * than a fire-and-forget menu item because the mail carries a password: an admin should see
 * who it is going to before it goes.
 *
 * Not the learner list's ShareCredentialsDialog: that one's built-in mail is unbranded and
 * links to the learner portal, which is the wrong door for a channel-partner admin. The
 * backend sends a mail branded for this institute with a sign-in link to its admin portal.
 */
export function ShareAdminCredentialsDialog({
    org,
    onOpenChange,
}: ShareAdminCredentialsDialogProps) {
    const { t } = useTranslation('manageCustomTeamsShareAdminCredentialsDialog');
    const recipient = org?.admin_name || org?.admin_email || '';
    const showEmail = !!org?.admin_email && org.admin_email !== recipient;

    const mutation = useMutation({
        mutationFn: (subOrgId: string) => resendSubOrgAdminCredentials(subOrgId),
        onSuccess: (result) => {
            // The backend answers 200 even when the notification service accepted nothing, so
            // read its counts rather than treating the response as delivery.
            if (result.sent > 0) {
                toast.success(t('toasts.sent', { email: org?.admin_email || recipient }));
                onOpenChange(false);
            } else {
                toast.error(result.message || t('toasts.nothingSent'));
            }
        },
        onError: (err: { response?: { data?: { message?: string } }; message?: string }) => {
            toast.error(err?.response?.data?.message || err?.message || t('toasts.failed'));
        },
    });

    const isSending = mutation.isPending;

    return (
        <MyDialog
            heading={t('title')}
            open={!!org}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-md"
            footer={
                <div className="flex w-full justify-end gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        disable={isSending}
                        onClick={() => onOpenChange(false)}
                    >
                        {t('cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disable={isSending || !org?.suborg_id}
                        onClick={() => org?.suborg_id && mutation.mutate(org.suborg_id)}
                    >
                        {isSending ? (
                            <>
                                <CircleNotch
                                    className="mr-2 size-4 animate-spin"
                                    aria-hidden="true"
                                />
                                {t('sending')}
                            </>
                        ) : (
                            t('send')
                        )}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-3">
                <p className="text-body text-neutral-600">
                    {t('descriptionPrefix')} <span className="font-medium">{recipient}</span>
                    {showEmail && (
                        <>
                            {' '}
                            (<span className="break-all">{org?.admin_email}</span>)
                        </>
                    )}{' '}
                    {t('descriptionSuffix')}
                </p>
                <p className="text-caption text-neutral-500">{t('note')}</p>
            </div>
        </MyDialog>
    );
}
