import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MyButton } from '@/components/design-system/button';
import { DotsThree, Envelope, WarningCircle, WhatsappLogo } from '@phosphor-icons/react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { AssessmentRevaluateStudentInterface } from '@/types/assessments/assessment-overview';
import { useDialogStore } from '@/routes/manage-students/students-list/-hooks/useDialogStore';
import { toStudentTable } from '@/routes/study-library/live-session/-utils/dashboard-export';

// Internal menu-option keys — decoupled from the translated display labels below
// so branching logic never depends on the current locale's text.
const MENU_OPTION_REMOVE_PARTICIPANTS = 'REMOVE_PARTICIPANTS';

const RemoveParticipantComponent = ({
    student,
    onClose,
}: {
    student: AssessmentRevaluateStudentInterface;
    onClose: () => void;
}) => {
    const { t } = useTranslation('assessmentStudentPendingDropdown');
    return (
        <DialogContent className="flex flex-col p-0">
            <h1 className="rounded-md bg-primary-50 p-4 text-primary-500">
                {t('dialogs.removeParticipant.title')}
            </h1>
            <div className="flex flex-col gap-2 p-4">
                <div className="flex items-center text-danger-600">
                    <p>{t('dialogs.attentionLabel')}</p>
                    <WarningCircle size={18} />
                </div>
                <h1>
                    {t('dialogs.removeParticipant.confirmMessagePrefix')}{' '}
                    <span className="text-primary-500">{student.full_name}</span>{' '}
                    {t('dialogs.removeParticipant.confirmMessageSuffix')}
                </h1>
                <div className="flex justify-end">
                    <MyButton
                        type="button"
                        scale="large"
                        buttonType="primary"
                        className="mt-4 font-medium"
                        onClick={onClose}
                    >
                        {t('dialogs.removeParticipant.remove')}
                    </MyButton>
                </div>
            </div>
        </DialogContent>
    );
};

const StudentPendingDropdown = ({ student }: { student: AssessmentRevaluateStudentInterface }) => {
    const { t } = useTranslation('assessmentStudentPendingDropdown');
    const [selectedOption, setSelectedOption] = useState<string | null>(null);
    const [openDialog, setOpenDialog] = useState(false);
    const { openIndividualSendMessageDialog, openIndividualSendEmailDialog } = useDialogStore();
    const handleMenuOptionsChange = (value: string) => {
        setSelectedOption(value);
        setOpenDialog(true);
    };
    // The Pending row carries the learner's contact details at runtime (see
    // getAssessmentSubmissionsFilteredDataStudentData); the shared WhatsApp / email
    // dialogs send the reminder. package_session_id on this row is a batch NAME, so
    // it is not passed on.
    const contact = student as AssessmentRevaluateStudentInterface & {
        email?: string;
        mobile_number?: string;
    };
    const asStudentTable = () =>
        toStudentTable({
            userId: student.id,
            name: student.full_name,
            email: contact.email || null,
            mobile: contact.mobile_number || null,
            packageSessionId: null,
        });

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger>
                    <MyButton
                        type="button"
                        scale="small"
                        buttonType="secondary"
                        className="w-6 !min-w-6"
                    >
                        <DotsThree />
                    </MyButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                    <DropdownMenuItem
                        className="cursor-pointer gap-2"
                        onClick={() => openIndividualSendMessageDialog(asStudentTable())}
                    >
                        <WhatsappLogo size={16} />
                        {t('dropdown.sendWhatsApp')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        className="cursor-pointer gap-2"
                        onClick={() => openIndividualSendEmailDialog(asStudentTable())}
                    >
                        <Envelope size={16} />
                        {t('dropdown.sendEmail')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() => handleMenuOptionsChange(MENU_OPTION_REMOVE_PARTICIPANTS)}
                    >
                        {t('dropdown.removeParticipants')}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            {/* Dialog should be controlled by openDialog state */}
            <Dialog open={openDialog} onOpenChange={setOpenDialog}>
                {selectedOption === MENU_OPTION_REMOVE_PARTICIPANTS && (
                    <RemoveParticipantComponent
                        student={student}
                        onClose={() => setOpenDialog(false)}
                    />
                )}
            </Dialog>
        </>
    );
};

export default StudentPendingDropdown;
