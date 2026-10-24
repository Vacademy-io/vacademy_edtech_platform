import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { PaperPlaneTilt, WhatsappLogo, Copy } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useStudentCredentialsStore } from '@/stores/students/students-list/useStudentCredentialsStore';
import { StudentTable } from '@/types/student-table-types';
import { getInstituteId } from '@/constants/helper';
import { IndividualSendDialog } from '../student-email-notifications/individual-send-dialog';
import { InitiateReportDialog } from '../student-reports/InitiateReportDialog';
import { EditStudentDetails } from './EditStudentDetails';

type ActiveDialog = 'none' | 'email' | 'whatsapp';

/**
 * Quick Actions row — a horizontal strip of the 5 most common actions a
 * school admin takes from a learner's Overview tab. Every button reuses an
 * existing dialog (no new business logic):
 *
 *  - Edit Details     → EditStudentDetails component (its own dialog)
 *  - Send Email       → IndividualSendDialog (channel=EMAIL)
 *  - Send WhatsApp    → IndividualSendDialog (channel=WHATSAPP)
 *  - Generate Report  → InitiateReportDialog
 *  - Copy Credentials → clipboard + toast (no dialog)
 *
 * Buttons that depend on data (Email needs an email, WhatsApp needs a phone)
 * hide themselves when that data is missing. This avoids the dead-button
 * problem where a counsellor clicks something then sees "no email on file".
 */
export const OverviewQuickActions = ({
    student,
    onReportSuccess,
}: {
    student: StudentTable | null;
    /** Optional callback fired after a report is initiated successfully. */
    onReportSuccess?: () => void;
}) => {
    const { t } = useTranslation('manageStudentsOverviewQuickActions');
    const { getCredentials } = useStudentCredentialsStore();
    const [active, setActive] = useState<ActiveDialog>('none');

    if (!student) return null;

    const userId = student.user_id || student.id || '';
    const instituteId = getInstituteId() || '';
    const hasEmail = !!student.email;
    const hasMobile = !!student.mobile_number;

    const handleCopyCredentials = async () => {
        if (!userId) return;
        const creds = getCredentials(userId);
        if (!creds?.username && !creds?.password) {
            toast.error(t('toasts.noCredentials'));
            return;
        }
        const text = `${t('credentialsText.username')}: ${creds.username || '—'}\n${t('credentialsText.password')}: ${creds.password || '—'}`;
        try {
            await navigator.clipboard.writeText(text);
            toast.success(t('toasts.copySuccess'));
        } catch {
            toast.error(t('toasts.copyFailure'));
        }
    };

    return (
        <>
            <div className="flex flex-wrap items-center gap-1.5">
                <EditStudentDetails />
                {hasEmail && (
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        onClick={() => setActive('email')}
                    >
                        <PaperPlaneTilt className="size-3.5" />
                        {t('buttons.email')}
                    </MyButton>
                )}
                {hasMobile && (
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        onClick={() => setActive('whatsapp')}
                    >
                        <WhatsappLogo className="size-3.5" />
                        {t('buttons.whatsapp')}
                    </MyButton>
                )}
                <InitiateReportDialog onSuccess={onReportSuccess ?? (() => {})} />
                <MyButton
                    buttonType="text"
                    scale="small"
                    onClick={handleCopyCredentials}
                >
                    <Copy className="size-3.5" />
                    {t('buttons.copyCredentials')}
                </MyButton>
            </div>

            {active === 'email' && (
                <IndividualSendDialog
                    open
                    onOpenChange={(o) => !o && setActive('none')}
                    student={student}
                    channel="EMAIL"
                    instituteId={instituteId}
                />
            )}
            {active === 'whatsapp' && (
                <IndividualSendDialog
                    open
                    onOpenChange={(o) => !o && setActive('none')}
                    student={student}
                    channel="WHATSAPP"
                    instituteId={instituteId}
                />
            )}
        </>
    );
};
