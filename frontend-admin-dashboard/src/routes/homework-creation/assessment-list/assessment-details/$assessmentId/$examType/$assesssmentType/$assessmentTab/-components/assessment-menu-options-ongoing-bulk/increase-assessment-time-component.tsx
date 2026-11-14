import { ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { useSubmissionsBulkActionsDialogStoreOngoing } from '../bulk-actions-zustand-store/useSubmissionsBulkActionsDialogStoreOngoing';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { timeLimit } from '@/constants/dummy-data';

interface ProvideDialogDialogProps {
    trigger: ReactNode;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    durationDistribution: string;
}

const IncreaseAssessmentTimeDialogContent = ({
    durationDistribution,
}: {
    durationDistribution: string;
}) => {
    const { t } = useTranslation('homeworkCreationIncreaseAssessmentTime');
    const [selectedSection, setSelectedSection] = useState<string>(timeLimit[0] as string);
    const { selectedStudent, bulkActionInfo, isBulkAction, closeAllDialogs } =
        useSubmissionsBulkActionsDialogStoreOngoing();

    const handleSubmit = () => {
        if (isBulkAction && bulkActionInfo?.selectedStudents) {
            console.log('bulk actions');
        } else if (selectedStudent) {
            console.log('individual student');
        }
        closeAllDialogs();
    };

    return (
        <div className="flex max-h-[60vh] flex-col gap-6 overflow-y-auto text-neutral-600"> {/* design-lint-ignore: viewport-relative scrollable dialog body, no vh token exists */}
            {durationDistribution === 'ASSESSMENT' && (
                <div className="flex flex-col gap-2 p-4">
                    <h1>{t('assessment.title')}</h1>
                    <h3>{t('assessment.increaseByLabel')}</h3>
                    <Select value={selectedSection} onValueChange={setSelectedSection}>
                        <SelectTrigger className="w-44">
                            <SelectValue placeholder={t('assessment.selectSectionPlaceholder')} />
                        </SelectTrigger>
                        <SelectContent>
                            {timeLimit.map((sec, idx) => (
                                <SelectItem key={idx} value={sec}>
                                    {sec}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <div className="mt-4 flex justify-center">
                        <MyButton
                            buttonType="primary"
                            scale="large"
                            layoutVariant="default"
                            onClick={handleSubmit}
                        >
                            {t('assessment.doneButton')}
                        </MyButton>
                    </div>
                </div>
            )}
            {durationDistribution === 'SECTION' && (
                <div className="flex flex-col gap-2 p-4">
                    <h1>{t('section.title', { index: 1 })}</h1>
                    <h3>{t('section.increaseByLabel')}</h3>
                    <Select value={selectedSection} onValueChange={setSelectedSection}>
                        <SelectTrigger className="w-44">
                            <SelectValue placeholder={t('section.selectSectionPlaceholder')} />
                        </SelectTrigger>
                        <SelectContent>
                            {timeLimit.map((sec, idx) => (
                                <SelectItem key={idx} value={sec}>
                                    {sec}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <h1>{t('section.title', { index: 2 })}</h1>
                    <h3>{t('section.increaseByLabel')}</h3>
                    <Select value={selectedSection} onValueChange={setSelectedSection}>
                        <SelectTrigger className="w-44">
                            <SelectValue placeholder={t('section.selectSectionPlaceholder')} />
                        </SelectTrigger>
                        <SelectContent>
                            {timeLimit.map((sec, idx) => (
                                <SelectItem key={idx} value={sec}>
                                    {sec}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <div className="mt-4 flex justify-center">
                        <MyButton
                            buttonType="primary"
                            scale="large"
                            layoutVariant="default"
                            onClick={handleSubmit}
                        >
                            {t('section.doneButton')}
                        </MyButton>
                    </div>
                </div>
            )}
            {durationDistribution === 'QUESTION' && (
                <div className="flex flex-col gap-2 p-4">
                    <h1>{t('question.title', { index: 1 })}</h1>
                    <h3>{t('question.increaseByLabel')}</h3>
                    <Select value={selectedSection} onValueChange={setSelectedSection}>
                        <SelectTrigger className="w-44">
                            <SelectValue placeholder={t('question.selectSectionPlaceholder')} />
                        </SelectTrigger>
                        <SelectContent>
                            {timeLimit.map((sec, idx) => (
                                <SelectItem key={idx} value={sec}>
                                    {sec}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <h1>{t('question.title', { index: 2 })}</h1>
                    <h3>{t('question.increaseByLabel')}</h3>
                    <Select value={selectedSection} onValueChange={setSelectedSection}>
                        <SelectTrigger className="w-44">
                            <SelectValue placeholder={t('question.selectSectionPlaceholder')} />
                        </SelectTrigger>
                        <SelectContent>
                            {timeLimit.map((sec, idx) => (
                                <SelectItem key={idx} value={sec}>
                                    {sec}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <div className="mt-4 flex justify-center">
                        <MyButton
                            buttonType="primary"
                            scale="large"
                            layoutVariant="default"
                            onClick={handleSubmit}
                        >
                            {t('question.doneButton')}
                        </MyButton>
                    </div>
                </div>
            )}
        </div>
    );
};

export const IncreaseAssessmentTimeDialog = ({
    trigger,
    open,
    onOpenChange,
    durationDistribution,
}: ProvideDialogDialogProps) => {
    const { t } = useTranslation('homeworkCreationIncreaseAssessmentTime');
    return (
        <MyDialog
            trigger={trigger}
            heading={t('dialog.heading')}
            dialogWidth="w-96 max-w-sm"
            content={
                <IncreaseAssessmentTimeDialogContent durationDistribution={durationDistribution} />
            }
            open={open}
            onOpenChange={onOpenChange}
        />
    );
};
