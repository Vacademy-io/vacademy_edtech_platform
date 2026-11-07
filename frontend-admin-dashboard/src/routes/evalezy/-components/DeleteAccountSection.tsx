import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Trash } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { DELETE_DISABLE_USER_URL } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { removeCookiesAndLogout } from '@/lib/auth/sessionUtility';

/**
 * Stores require deleting an account from inside the app. This uses the same self-delete
 * call as the learner app: the backend allows a member to mark only their own rows DELETED.
 */
export const DeleteAccountSection = ({
    userId,
    instituteName,
}: {
    userId: string;
    instituteName?: string;
}) => {
    const { t } = useTranslation('evalezy');
    const [open, setOpen] = useState(false);
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const remove = useMutation({
        mutationFn: async () => {
            const instituteId = getCurrentInstituteId();
            if (!instituteId) throw new Error('No institute selected');
            await authenticatedAxiosInstance.put(DELETE_DISABLE_USER_URL, [userId], {
                params: { instituteId, status: 'DELETED' },
            });
        },
        onSuccess: () => {
            toast.success(t('profile.delete.done'));
            queryClient.clear();
            removeCookiesAndLogout();
            void navigate({ to: '/login' });
        },
        onError: () => {
            toast.error(t('profile.delete.failed'));
        },
    });

    return (
        <section className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-4">
            <p className="text-body font-semibold text-neutral-800">{t('profile.delete.title')}</p>
            <p className="text-caption text-neutral-500">{t('profile.delete.hint')}</p>
            <div>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="small"
                    className="border-danger-500 text-danger-600"
                    onClick={() => setOpen(true)}
                >
                    <Trash size={16} />
                    {t('profile.delete.action')}
                </MyButton>
            </div>
            {open && (
                <MyDialog
                    open
                    heading={t('profile.delete.confirmTitle')}
                    dialogWidth="max-w-md"
                    onOpenChange={(next) => {
                        if (!next && !remove.isPending) setOpen(false);
                    }}
                    footer={
                        <>
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                disable={remove.isPending}
                                onClick={() => setOpen(false)}
                            >
                                {t('profile.delete.cancel')}
                            </MyButton>
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="small"
                                className="border-danger-600 bg-danger-600 hover:bg-danger-700"
                                disable={remove.isPending}
                                onClick={() => remove.mutate()}
                            >
                                {remove.isPending
                                    ? t('profile.delete.working')
                                    : t('profile.delete.confirm')}
                            </MyButton>
                        </>
                    }
                >
                    <div className="flex flex-col gap-2 text-body text-neutral-700">
                        <p>
                            {t('profile.delete.confirmBody', {
                                institute: instituteName || t('profile.institute'),
                            })}
                        </p>
                        <p>{t('profile.delete.confirmHelp')}</p>
                    </div>
                </MyDialog>
            )}
        </section>
    );
};
