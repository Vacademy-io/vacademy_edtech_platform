import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MyButton } from '@/components/design-system/button';
import { DotsThree, WarningCircle } from '@phosphor-icons/react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { AssessmentRevaluateStudentInterface } from '@/types/assessments/assessment-overview';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { timeLimit } from '@/constants/dummy-data';
import { ProctoringReviewDialog } from './ProctoringReviewDialog';

// Internal menu-option keys — decoupled from the translated display labels below
// so branching logic never depends on the current locale's text.
const MENU_OPTION_INCREASE_TIME = 'INCREASE_TIME';
const MENU_OPTION_CLOSE_SUBMISSION = 'CLOSE_SUBMISSION';

const CloseSubmissionComponent = ({
    student,
    onClose,
}: {
    student: AssessmentRevaluateStudentInterface;
    onClose: () => void;
}) => {
    const { t } = useTranslation('assessmentStudentOngoingDropdown');
    return (
        <DialogContent className="flex flex-col p-0">
            <h1 className="rounded-md bg-primary-50 p-4 text-primary-500">
                {t('dialogs.closeSubmission.title')}
            </h1>
            <div className="flex flex-col gap-2 p-4">
                <div className="flex items-center text-danger-600">
                    <p>{t('dialogs.attentionLabel')}</p>
                    <WarningCircle size={18} />
                </div>
                <h1>
                    {t('dialogs.closeSubmission.confirmMessagePrefix')}{' '}
                    <span className="text-primary-500">{student.full_name}</span>?
                </h1>
                <div className="flex justify-end">
                    <MyButton
                        type="button"
                        scale="large"
                        buttonType="primary"
                        className="mt-4 font-medium"
                        onClick={onClose}
                    >
                        {t('dialogs.close')}
                    </MyButton>
                </div>
            </div>
        </DialogContent>
    );
};

const IncreaseAssessmentTimeComponent = ({
    student,
    distributionDuration,
    onClose,
}: {
    student: AssessmentRevaluateStudentInterface;
    distributionDuration: string;
    onClose: () => void;
}) => {
    const { t } = useTranslation('assessmentStudentOngoingDropdown');
    console.log(student);
    const [selectedSection, setSelectedSection] = useState<string>(timeLimit[0] as string);

    return (
        <DialogContent className="flex flex-col p-0">
            <h1 className="rounded-md bg-primary-50 p-4 text-primary-500">
                {t('dialogs.increaseTime.title')}
            </h1>
            {distributionDuration === 'ASSESSMENT' && (
                <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto p-4"> {/* design-lint-ignore: viewport-relative scrollable dialog body, no vh token exists */}
                    <h1>{t('dialogs.increaseTime.entireAssessment')}</h1>
                    <h3>{t('dialogs.increaseTime.increaseByLabel')}</h3>
                    <Select value={selectedSection} onValueChange={setSelectedSection}>
                        <SelectTrigger className="w-44">
                            <SelectValue
                                placeholder={t('dialogs.increaseTime.selectSectionPlaceholder')}
                            />
                        </SelectTrigger>
                        <SelectContent>
                            {timeLimit.map((sec, idx) => (
                                <SelectItem key={idx} value={sec}>
                                    {sec}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <div className="flex justify-center">
                        <MyButton
                            type="button"
                            scale="large"
                            buttonType="primary"
                            className="mt-4 font-medium"
                            onClick={onClose}
                        >
                            {t('dialogs.close')}
                        </MyButton>
                    </div>
                </div>
            )}
            {distributionDuration === 'SECTION' && (
                <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto p-4"> {/* design-lint-ignore: viewport-relative scrollable dialog body, no vh token exists */}
                    <h1>{t('dialogs.increaseTime.section', { number: 1 })}</h1>
                    <h3>{t('dialogs.increaseTime.increaseByLabel')}</h3>
                    <Select value={selectedSection} onValueChange={setSelectedSection}>
                        <SelectTrigger className="w-44">
                            <SelectValue
                                placeholder={t('dialogs.increaseTime.selectSectionPlaceholder')}
                            />
                        </SelectTrigger>
                        <SelectContent>
                            {timeLimit.map((sec, idx) => (
                                <SelectItem key={idx} value={sec}>
                                    {sec}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <h1>{t('dialogs.increaseTime.section', { number: 2 })}</h1>
                    <h3>{t('dialogs.increaseTime.increaseByLabel')}</h3>
                    <Select value={selectedSection} onValueChange={setSelectedSection}>
                        <SelectTrigger className="w-44">
                            <SelectValue
                                placeholder={t('dialogs.increaseTime.selectSectionPlaceholder')}
                            />
                        </SelectTrigger>
                        <SelectContent>
                            {timeLimit.map((sec, idx) => (
                                <SelectItem key={idx} value={sec}>
                                    {sec}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <div className="flex justify-center">
                        <MyButton
                            type="button"
                            scale="large"
                            buttonType="primary"
                            className="mt-4 font-medium"
                            onClick={onClose}
                        >
                            {t('dialogs.close')}
                        </MyButton>
                    </div>
                </div>
            )}
            {distributionDuration === 'QUESTION' && (
                <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto p-4"> {/* design-lint-ignore: viewport-relative scrollable dialog body, no vh token exists */}
                    <h1>{t('dialogs.increaseTime.question', { number: 1 })}</h1>
                    <h3>{t('dialogs.increaseTime.increaseByLabel')}</h3>
                    <Select value={selectedSection} onValueChange={setSelectedSection}>
                        <SelectTrigger className="w-44">
                            <SelectValue
                                placeholder={t('dialogs.increaseTime.selectSectionPlaceholder')}
                            />
                        </SelectTrigger>
                        <SelectContent>
                            {timeLimit.map((sec, idx) => (
                                <SelectItem key={idx} value={sec}>
                                    {sec}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <h1>{t('dialogs.increaseTime.question', { number: 2 })}</h1>
                    <h3>{t('dialogs.increaseTime.increaseByLabel')}</h3>
                    <Select value={selectedSection} onValueChange={setSelectedSection}>
                        <SelectTrigger className="w-44">
                            <SelectValue
                                placeholder={t('dialogs.increaseTime.selectSectionPlaceholder')}
                            />
                        </SelectTrigger>
                        <SelectContent>
                            {timeLimit.map((sec, idx) => (
                                <SelectItem key={idx} value={sec}>
                                    {sec}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <div className="flex justify-center">
                        <MyButton
                            type="button"
                            scale="large"
                            buttonType="primary"
                            className="mt-4 font-medium"
                            onClick={onClose}
                        >
                            {t('dialogs.close')}
                        </MyButton>
                    </div>
                </div>
            )}
        </DialogContent>
    );
};

const StudentOngoingDropdown = ({ student }: { student: AssessmentRevaluateStudentInterface }) => {
    const { t } = useTranslation('assessmentStudentOngoingDropdown');
    const [selectedOption, setSelectedOption] = useState<string | null>(null);
    const [openDialog, setOpenDialog] = useState(false);
    const [proctoringOpen, setProctoringOpen] = useState(false);

    const handleMenuOptionsChange = (value: string) => {
        setSelectedOption(value);
        setOpenDialog(true);
    };

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
                        className="cursor-pointer"
                        onClick={() => handleMenuOptionsChange(MENU_OPTION_INCREASE_TIME)}
                    >
                        {t('dropdown.increaseSubmissionTime')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() => handleMenuOptionsChange(MENU_OPTION_CLOSE_SUBMISSION)}
                    >
                        {t('dropdown.closeSubmission')}
                    </DropdownMenuItem>
                    {/* Watching a live attempt is the main reason to open this;
                        the dialog refreshes itself while it is open. */}
                    <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() => setProctoringOpen(true)}
                    >
                        {t('dropdown.proctoring')}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            <ProctoringReviewDialog
                attemptId={student.attempt_id}
                studentName={student.full_name}
                open={proctoringOpen}
                onOpenChange={setProctoringOpen}
            />
            {/* Dialog should be controlled by openDialog state */}
            <Dialog open={openDialog} onOpenChange={setOpenDialog}>
                {selectedOption === MENU_OPTION_INCREASE_TIME && (
                    <IncreaseAssessmentTimeComponent
                        student={student}
                        distributionDuration="ASSESSMENT"
                        onClose={() => setOpenDialog(false)}
                    />
                )}
                {selectedOption === MENU_OPTION_CLOSE_SUBMISSION && (
                    <CloseSubmissionComponent
                        student={student}
                        onClose={() => setOpenDialog(false)}
                    />
                )}
            </Dialog>
        </>
    );
};

export default StudentOngoingDropdown;
