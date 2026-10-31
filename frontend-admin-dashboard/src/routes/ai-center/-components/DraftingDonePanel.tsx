import type { Dispatch, SetStateAction } from 'react';
import { Sparkle } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { AITaskIndividualListInterface } from '@/types/ai/generate-assessment/generate-complete-assessment';
import AIQuestionsPreview from './AIQuestionsPreview';
import AIPlanLecturePreview from './AIPlanLecturePreview';
import AIEvaluatePreview from './AIEvaluatePreview';
import AIChatWithPDFPreview from './AIChatWithPDFPreview';
import type { QuestionsFromTextData } from '../ai-tools/vsmart-prompt/-components/GenerateQuestionsFromText';
import { UseFormReturn } from 'react-hook-form';
import { SectionFormType } from '@/types/assessments/assessment-steps';

type Props = {
    readyTask: AITaskIndividualListInterface;
    openPreview: boolean;
    setOpenPreview: Dispatch<SetStateAction<boolean>>;
    onDraftAnother: () => void;
    heading: string;
    title?: string;
    subtitle?: string;
    draftAnotherLabel?: string;
    pollGenerateAssessment?: (prompt?: string, taskId?: string) => void;
    handleGenerateQuestionsForAssessment?: (
        pdfId?: string,
        prompt?: string,
        taskId?: string
    ) => void;
    pollGenerateQuestionsFromText?: (data: QuestionsFromTextData) => void;
    pollGenerateQuestionsFromAudio?: (data: QuestionsFromTextData, taskId: string) => void;
    sectionsForm?: UseFormReturn<SectionFormType>;
    currentSectionIndex?: number;
    allowSectionSplit?: boolean;
};

export const DraftingDonePanel = ({
    readyTask,
    openPreview,
    setOpenPreview,
    onDraftAnother,
    heading,
    title,
    subtitle,
    draftAnotherLabel,
    pollGenerateAssessment,
    handleGenerateQuestionsForAssessment,
    pollGenerateQuestionsFromText,
    pollGenerateQuestionsFromAudio,
    sectionsForm,
    currentSectionIndex,
    allowSectionSplit,
}: Props) => {
    const { t } = useTranslation('aiCenterDraftingDonePanel');
    const resolvedTitle = title ?? t('defaultTitle');
    const resolvedSubtitle = subtitle ?? t('defaultSubtitle');
    const resolvedDraftAnotherLabel = draftAnotherLabel ?? t('draftAnotherLabel');
    const renderPreview = () => {
        if (heading === 'Vsmart Lecturer') {
            return (
                <AIPlanLecturePreview
                    task={readyTask}
                    openPlanLecturePreview={openPreview}
                    setOpenPlanLecturePreview={setOpenPreview}
                />
            );
        }
        if (heading === 'Vsmart Feedback') {
            return (
                <AIEvaluatePreview
                    task={readyTask}
                    openEvaluatePreview={openPreview}
                    setOpenEvaluatePreview={setOpenPreview}
                />
            );
        }
        if (heading === 'Vsmart Chat') {
            return (
                <AIChatWithPDFPreview
                    task={readyTask}
                    openAIPreview={openPreview}
                    setOpenAIPreview={setOpenPreview}
                />
            );
        }
        return (
            <AIQuestionsPreview
                task={readyTask}
                openQuestionsPreview={openPreview}
                setOpenQuestionsPreview={setOpenPreview}
                heading={heading}
                pollGenerateAssessment={pollGenerateAssessment}
                handleGenerateQuestionsForAssessment={handleGenerateQuestionsForAssessment}
                pollGenerateQuestionsFromText={pollGenerateQuestionsFromText}
                pollGenerateQuestionsFromAudio={pollGenerateQuestionsFromAudio}
                sectionsForm={sectionsForm}
                currentSectionIndex={currentSectionIndex}
                allowSectionSplit={allowSectionSplit}
            />
        );
    };

    return (
        <div className="relative overflow-hidden rounded-2xl border border-primary-100 bg-gradient-to-br from-primary-50 via-white to-blue-50 p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-4">
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary-500 text-white shadow-lg shadow-primary-500/20">
                        <Sparkle size={22} weight="fill" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <p className="text-base font-semibold text-gray-900">{resolvedTitle}</p>
                            <span className="inline-flex items-center gap-1 rounded-md bg-primary-50 px-2 py-0.5 text-caption font-medium text-primary-600 ring-1 ring-inset ring-primary-200">
                                <Sparkle size={10} weight="fill" />
                                {t('aiGeneratedBadge')}
                            </span>
                        </div>
                        <p className="text-sm text-neutral-600">{resolvedSubtitle}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 self-end sm:self-auto">
                    {renderPreview()}
                    <button
                        type="button"
                        onClick={onDraftAnother}
                        className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:border-primary-200 hover:bg-primary-50"
                    >
                        {resolvedDraftAnotherLabel}
                    </button>
                </div>
            </div>
        </div>
    );
};
