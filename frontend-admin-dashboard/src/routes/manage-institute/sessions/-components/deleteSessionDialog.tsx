import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { useDeleteSession } from '@/services/study-library/session-management/deleteSession';
import { SessionData } from '@/types/study-library/session-types';
import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

export const DeleteSessionDialog = ({
    triggerButton,
    session,
}: {
    triggerButton: JSX.Element;
    session: SessionData;
}) => {
    const { t } = useTranslation('manageInstituteDeleteSessionDialog');
    const [open, setOpen] = useState(false);

    const handleOpenChange = () => {
        setOpen(!open);
    };

    const deleteSessionMutation = useDeleteSession();

    const handleDeleteSession = (session: SessionData) => {
        deleteSessionMutation.mutate(
            { requestData: [session.session.id] },
            {
                onSuccess: () => {
                    toast.success(
                        t('toast.deleted', {
                            session: getTerminology(ContentTerms.Session, SystemTerms.Session),
                        })
                    );
                    setOpen(false);
                },
                onError: (error) => {
                    toast.error(
                        error.message ||
                            t('toast.deleteFailed', {
                                session: getTerminology(
                                    ContentTerms.Session,
                                    SystemTerms.Session
                                ).toLocaleLowerCase(),
                            })
                    );
                },
            }
        );
    };

    return (
        <MyDialog
            heading={t('heading', {
                session: getTerminology(ContentTerms.Session, SystemTerms.Session),
            })}
            trigger={triggerButton}
            open={open}
            onOpenChange={handleOpenChange}
            dialogWidth="w-[500px]"
        >
            <div className="flex flex-col gap-6 p-4">
                <div>
                    <p className="text-danger-600">{t('attention')}</p>
                    <p>
                        {t('confirmMessage', {
                            session: getTerminology(
                                ContentTerms.Session,
                                SystemTerms.Session
                            ).toLocaleLowerCase(),
                        })}{' '}
                        <span className="text-primary-500">{session.session.session_name}</span>?
                    </p>
                </div>
                <div className="flex items-center justify-between">
                    <MyButton
                        buttonType="secondary"
                        onClick={() => {
                            setOpen(false);
                        }}
                    >
                        {t('no')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        onClick={() => {
                            handleDeleteSession(session);
                        }}
                    >
                        {t('yes')}
                    </MyButton>
                </div>
            </div>
        </MyDialog>
    );
};
