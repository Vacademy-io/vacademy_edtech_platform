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

const CloseSubmissionComponent = ({
    student,
    onClose,
}: {
    student: AssessmentRevaluateStudentInterface;
    onClose: () => void;
}) => {
    const { t } = useTranslation('homeworkCreationStudentOngoingDropdown');
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
                        {t('dialogs.closeButton')}
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
    const { t } = useTranslation('homeworkCreationStudentOngoingDropdown');
    console.log(student);
    const [selectedSection, setSelectedSection] = useState<string>(timeLimit[0] as string);

    return (
        <DialogContent className="flex flex-col p-0">
            <h1 className="rounded-md bg-primary-50 p-4 text-primary-500">
                {t('dialogs.increaseAssessmentTime.title')}
            </h1>
            {distributionDuration === 'ASSESSMENT' && (
                <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto p-4"> {/* design-lint-ignore: viewport-relative scrollable dialog body, no vh token exists */}
                    <h1>{t('dialogs.increaseAssessmentTime.entireAssessment')}</h1>
                    <h3>{t('dialogs.increaseAssessmentTime.increaseBy')}</h3>
                    <Select value={selectedSection} onValueChange={setSelectedSection}>
                        <SelectTrigger className="w-44">
                            <SelectValue
                                placeholder={t(
                                    'dialogs.increaseAssessmentTime.selectSectionPlaceholder'
                                )}
                            />
                        </SelectTrigger>
                        <SelectContent>
                            {timeLimit.map((section, idx) => (
                                <SelectItem key={idx} value={section}>
                                    {section}
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
                            {t('dialogs.closeButton')}
                        </MyButton>
                    </div>
                </div>
            )}
            {distributionDuration === 'SECTION' && (
                <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto p-4"> {/* design-lint-ignore: viewport-relative scrollable dialog body, no vh token exists */}
                    <h1>{t('dialogs.increaseAssessmentTime.sectionNumber', { number: 1 })}</h1>
                    <h3>{t('dialogs.increaseAssessmentTime.increaseBy')}</h3>
                    <Select value={selectedSection} onValueChange={setSelectedSection}>
                        <SelectTrigger className="w-44">
                            <SelectValue
                                placeholder={t(
                                    'dialogs.increaseAssessmentTime.selectSectionPlaceholder'
                                )}
                            />
                        </SelectTrigger>
                        <SelectContent>
                            {timeLimit.map((section, idx) => (
                                <SelectItem key={idx} value={section}>
                                    {section}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <h1>{t('dialogs.increaseAssessmentTime.sectionNumber', { number: 2 })}</h1>
                    <h3>{t('dialogs.increaseAssessmentTime.increaseBy')}</h3>
                    <Select value={selectedSection} onValueChange={setSelectedSection}>
                        <SelectTrigger className="w-44">
                            <SelectValue
                                placeholder={t(
                                    'dialogs.increaseAssessmentTime.selectSectionPlaceholder'
                                )}
                            />
                        </SelectTrigger>
                        <SelectContent>
                            {timeLimit.map((section, idx) => (
                                <SelectItem key={idx} value={section}>
                                    {section}
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
                            {t('dialogs.closeButton')}
                        </MyButton>
                    </div>
                </div>
            )}
            {distributionDuration === 'QUESTION' && (
                <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto p-4"> {/* design-lint-ignore: viewport-relative scrollable dialog body, no vh token exists */}
                    <h1>{t('dialogs.increaseAssessmentTime.questionNumber', { number: 1 })}</h1>
                    <h3>{t('dialogs.increaseAssessmentTime.increaseBy')}</h3>
                    <Select value={selectedSection} onValueChange={setSelectedSection}>
                        <SelectTrigger className="w-44">
                            <SelectValue
                                placeholder={t(
                                    'dialogs.increaseAssessmentTime.selectSectionPlaceholder'
                                )}
                            />
                        </SelectTrigger>
                        <SelectContent>
                            {timeLimit.map((section, idx) => (
                                <SelectItem key={idx} value={section}>
                                    {section}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <h1>{t('dialogs.increaseAssessmentTime.questionNumber', { number: 2 })}</h1>
                    <h3>{t('dialogs.increaseAssessmentTime.increaseBy')}</h3>
                    <Select value={selectedSection} onValueChange={setSelectedSection}>
                        <SelectTrigger className="w-44">
                            <SelectValue
                                placeholder={t(
                                    'dialogs.increaseAssessmentTime.selectSectionPlaceholder'
                                )}
                            />
                        </SelectTrigger>
                        <SelectContent>
                            {timeLimit.map((section, idx) => (
                                <SelectItem key={idx} value={section}>
                                    {section}
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
                            {t('dialogs.closeButton')}
                        </MyButton>
                    </div>
                </div>
            )}
        </DialogContent>
    );
};

const StudentOngoingDropdown = ({ student }: { student: AssessmentRevaluateStudentInterface }) => {
    const { t } = useTranslation('homeworkCreationStudentOngoingDropdown');
    const [selectedOption, setSelectedOption] = useState<string | null>(null);
    const [openDialog, setOpenDialog] = useState(false);

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
                        onClick={() => handleMenuOptionsChange('Increase Submission Time')}
                    >
                        {t('dropdown.increaseSubmissionTime')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() => handleMenuOptionsChange('Close Submission')}
                    >
                        {t('dropdown.closeSubmission')}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            {/* Dialog should be controlled by openDialog state */}
            <Dialog open={openDialog} onOpenChange={setOpenDialog}>
                {selectedOption === 'Increase Submission Time' && (
                    <IncreaseAssessmentTimeComponent
                        student={student}
                        distributionDuration="ASSESSMENT"
                        onClose={() => setOpenDialog(false)}
                    />
                )}
                {selectedOption === 'Close Submission' && (
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
