import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import sectionDetailsSchema from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-utils/section-details-schema';
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StarFour, X } from '@phosphor-icons/react';
import { AICenterProvider } from '@/routes/ai-center/-contexts/useAICenterContext';
import GenerateAIAssessmentComponent from '@/routes/ai-center/ai-tools/vsmart-upload/-components/GenerateAssessment';
import { GenerateQuestionsFromAudio } from '@/routes/ai-center/ai-tools/vsmart-audio/-components/GenerateQuestionsFromAudio';
import { GenerateQuestionsFromText } from '@/routes/ai-center/ai-tools/vsmart-prompt/-components/GenerateQuestionsFromText';
import GenerateAiQuestionPaperComponent from '@/routes/ai-center/ai-tools/vsmart-extract/-components/GenerateQuestionPaper';
import GenerateAiQuestionFromImageComponent from '@/routes/ai-center/ai-tools/vsmart-image/-components/GenerateQuestionPaper';
import { UploadQuestionPaperFormType } from '@/routes/assessment/question-papers/-components/QuestionPaperUpload';

type SectionFormType = z.infer<typeof sectionDetailsSchema>;

const BRIDGE_DEFAULTS: SectionFormType = {
    status: 'INCOMPLETE',
    testDuration: {
        entireTestDuration: { checked: true, testDuration: { hrs: '0', min: '0' } },
        sectionWiseDuration: false,
        questionWiseDuration: false,
    },
    section: [
        {
            sectionId: '',
            sectionName: 'Quiz',
            questionPaperTitle: '',
            uploaded_question_paper: null,
            subject: '',
            yearClass: '',
            question_duration: { hrs: '0', min: '0' },
            section_description: '',
            section_duration: { hrs: '0', min: '0' },
            marks_per_question: '1',
            total_marks: '0',
            negative_marking: { checked: false, value: '0' },
            partial_marking: false,
            cutoff_marks: { checked: false, value: '0' },
            problem_randomization: false,
            adaptive_marking_for_each_question: [],
        },
    ],
};

interface QuizAddViaAIDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onQuestionsReady: (questions: UploadQuestionPaperFormType['questions']) => void;
}

const QuizAddViaAIDialog = ({ open, onOpenChange, onQuestionsReady }: QuizAddViaAIDialogProps) => {
    const { t } = useTranslation('studyLibraryQuizAddViaAIDialog');
    const [isGenerateGroupOpen, setIsGenerateGroupOpen] = useState(false);
    const [isExtractGroupOpen, setIsExtractGroupOpen] = useState(false);
    const [isUploadOpen, setIsUploadOpen] = useState(false);
    const [isAudioOpen, setIsAudioOpen] = useState(false);
    const [isTopicsOpen, setIsTopicsOpen] = useState(false);
    const [isExtractOpen, setIsExtractOpen] = useState(false);
    const [isImageOpen, setIsImageOpen] = useState(false);

    const bridgeForm = useForm<SectionFormType>({
        resolver: zodResolver(sectionDetailsSchema),
        defaultValues: BRIDGE_DEFAULTS,
    });

    const handleClose = (nextOpen: boolean) => {
        if (!nextOpen) {
            // Extract questions from bridge form when dialog closes
            const rawQuestions = bridgeForm.getValues(
                'section.0.adaptive_marking_for_each_question'
            ) as any[];

            if (rawQuestions && rawQuestions.length > 0) {
                // Convert minimal bridge-form data to UploadQuestionPaperFormType questions
                const converted: UploadQuestionPaperFormType['questions'] = rawQuestions.map(
                    (q: any) => ({
                        // q.text?.content is a fallback for questions loaded via the question-paper round-trip
                        questionName: q.questionName || q.text?.content || '',
                        questionType: q.questionType || 'MCQS',
                        questionMark: q.questionMark || '1',
                        questionPenalty: q.questionPenalty || '0',
                        questionDuration: q.questionDuration || { hrs: '0', min: '0' },
                        explanation: q.explanation || '',
                        tags: q.tags ?? [],
                        canSkip: q.canSkip ?? false,
                        validAnswers: q.validAnswers ?? [0],
                        parentRichTextContent: q.parentRichTextContent || q.parentRichText || '',
                        subjectiveAnswerText: q.subjectiveAnswerText || '',
                        decimals: q.decimals ?? 0,
                        numericType: q.numericType || '',
                        // Use length check (not ||) because [] is truthy but should use the fallback
                        singleChoiceOptions: q.singleChoiceOptions?.length > 0 ? q.singleChoiceOptions : Array(4).fill({ id: '', name: '', isSelected: false }),
                        multipleChoiceOptions: q.multipleChoiceOptions?.length > 0 ? q.multipleChoiceOptions : Array(4).fill({ id: '', name: '', isSelected: false }),
                        csingleChoiceOptions: q.csingleChoiceOptions?.length > 0 ? q.csingleChoiceOptions : Array(4).fill({ id: '', name: '', isSelected: false }),
                        cmultipleChoiceOptions: q.cmultipleChoiceOptions?.length > 0 ? q.cmultipleChoiceOptions : Array(4).fill({ id: '', name: '', isSelected: false }),
                        trueFalseOptions: q.trueFalseOptions?.length > 0 ? q.trueFalseOptions : [
                            { id: '', name: 'True', isSelected: false },
                            { id: '', name: 'False', isSelected: false },
                        ],
                    })
                );

                onQuestionsReady(converted);

                // Reset bridge form for next use
                bridgeForm.reset(BRIDGE_DEFAULTS);
            }
        }
        onOpenChange(nextOpen);
    };

    return (
        <AlertDialog open={open} onOpenChange={handleClose}>
            <AlertDialogContent className="p-0">
                <div className="flex items-center justify-between rounded-md bg-primary-50">
                    <h1 className="rounded-sm p-4 font-bold text-primary-500">
                        {t('createQuestionsFromAi')}
                    </h1>
                    <AlertDialogCancel className="border-none bg-primary-50 shadow-none hover:bg-primary-50">
                        <X className="text-neutral-600" />
                    </AlertDialogCancel>
                </div>

                <div className="flex flex-col gap-4 px-4 pb-4">
                    {/* Generate Questions Group */}
                    <Dialog open={isGenerateGroupOpen} onOpenChange={setIsGenerateGroupOpen}>
                        <DialogTrigger asChild>
                            <Card className="cursor-pointer hover:bg-neutral-50">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <StarFour weight="fill" className="text-primary-500" />
                                        {t('generateQuestions.title')}
                                    </CardTitle>
                                    <CardDescription>
                                        {t('generateQuestions.description')}
                                    </CardDescription>
                                </CardHeader>
                            </Card>
                        </DialogTrigger>
                        <DialogContent className="no-scrollbar !m-0 flex size-1/2 flex-col !gap-0 !p-0">
                            <h1 className="rounded-t-lg bg-primary-50 p-4 font-semibold text-primary-500">
                                {t('generateQuestions.title')}
                            </h1>
                            <div className="flex flex-col gap-4 overflow-auto p-4">
                                {/* VSmart Upload */}
                                <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
                                    <DialogTrigger asChild>
                                        <Card className="flex h-fit w-full cursor-pointer items-center justify-center gap-10 border-neutral-300 bg-neutral-50 text-neutral-600 sm:flex-wrap md:flex-nowrap">
                                            <CardHeader className="flex h-fit flex-col gap-3">
                                                <CardTitle className="flex items-center gap-2 text-title font-semibold">
                                                    <StarFour
                                                        size={30}
                                                        weight="fill"
                                                        className="text-primary-500"
                                                    />
                                                    {t('vsmartUpload.title')}
                                                    <p className="text-body">
                                                        {t('vsmartUpload.subtitle')}
                                                    </p>
                                                </CardTitle>
                                                <CardDescription>
                                                    {t('vsmartUpload.description')}
                                                </CardDescription>
                                            </CardHeader>
                                        </Card>
                                    </DialogTrigger>
                                    <DialogContent className="no-scrollbar !m-0 flex h-full !w-full !max-w-full flex-col !gap-0 overflow-y-auto !rounded-none !p-0">
                                        <AICenterProvider>
                                            <GenerateAIAssessmentComponent
                                                form={bridgeForm}
                                                currentSectionIndex={0}
                                            />
                                        </AICenterProvider>
                                    </DialogContent>
                                </Dialog>

                                {/* VSmart Audio */}
                                <Dialog open={isAudioOpen} onOpenChange={setIsAudioOpen}>
                                    <DialogTrigger asChild>
                                        <Card className="flex h-fit w-full cursor-pointer items-center justify-center gap-10 border-neutral-300 bg-neutral-50 text-neutral-600 sm:flex-wrap md:flex-nowrap">
                                            <CardHeader className="flex h-fit flex-col gap-3">
                                                <CardTitle className="flex items-center gap-2 text-title font-semibold">
                                                    <StarFour
                                                        size={30}
                                                        weight="fill"
                                                        className="text-primary-500"
                                                    />
                                                    {t('vsmartAudio.title')}
                                                    <p className="text-body">
                                                        {t('vsmartAudio.subtitle')}
                                                    </p>
                                                </CardTitle>
                                                <CardDescription>
                                                    {t('vsmartAudio.description')}
                                                </CardDescription>
                                            </CardHeader>
                                        </Card>
                                    </DialogTrigger>
                                    <DialogContent className="no-scrollbar !m-0 flex h-full !w-full !max-w-full flex-col !gap-0 overflow-y-auto !rounded-none !p-0">
                                        <AICenterProvider>
                                            <GenerateQuestionsFromAudio
                                                form={bridgeForm}
                                                currentSectionIndex={0}
                                            />
                                        </AICenterProvider>
                                    </DialogContent>
                                </Dialog>

                                {/* VSmart Topics */}
                                <Dialog open={isTopicsOpen} onOpenChange={setIsTopicsOpen}>
                                    <DialogTrigger asChild>
                                        <Card className="flex h-fit w-full cursor-pointer items-center justify-center gap-10 border-neutral-300 bg-neutral-50 text-neutral-600 sm:flex-wrap md:flex-nowrap">
                                            <CardHeader className="flex h-fit flex-col gap-3">
                                                <CardTitle className="flex items-center gap-2 text-title font-semibold">
                                                    <StarFour
                                                        size={30}
                                                        weight="fill"
                                                        className="text-primary-500"
                                                    />
                                                    {t('vsmartTopics.title')}
                                                    <p className="text-body">
                                                        {t('vsmartTopics.subtitle')}
                                                    </p>
                                                </CardTitle>
                                                <CardDescription>
                                                    {t('vsmartTopics.description')}
                                                </CardDescription>
                                            </CardHeader>
                                        </Card>
                                    </DialogTrigger>
                                    <DialogContent className="no-scrollbar !m-0 flex h-full !w-full !max-w-full flex-col !gap-0 overflow-y-auto !rounded-none !p-0">
                                        <AICenterProvider>
                                            <GenerateQuestionsFromText
                                                form={bridgeForm}
                                                currentSectionIndex={0}
                                            />
                                        </AICenterProvider>
                                    </DialogContent>
                                </Dialog>
                            </div>
                        </DialogContent>
                    </Dialog>

                    {/* Extract Questions Group */}
                    <Dialog open={isExtractGroupOpen} onOpenChange={setIsExtractGroupOpen}>
                        <DialogTrigger asChild>
                            <Card className="cursor-pointer hover:bg-neutral-50">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <StarFour weight="fill" className="text-primary-500" />
                                        {t('extractQuestions.title')}
                                    </CardTitle>
                                    <CardDescription>
                                        {t('extractQuestions.description')}
                                    </CardDescription>
                                </CardHeader>
                            </Card>
                        </DialogTrigger>
                        <DialogContent className="no-scrollbar !m-0 flex size-1/2 flex-col !gap-0 !p-0">
                            <h1 className="rounded-t-lg bg-primary-50 p-4 font-semibold text-primary-500">
                                {t('extractQuestions.title')}
                            </h1>
                            <div className="flex flex-col gap-4 overflow-auto p-4">
                                {/* VSmart Extract */}
                                <Dialog open={isExtractOpen} onOpenChange={setIsExtractOpen}>
                                    <DialogTrigger asChild>
                                        <Card className="flex h-fit w-full cursor-pointer items-center justify-center gap-10 border-neutral-300 bg-neutral-50 text-neutral-600 sm:flex-wrap md:flex-nowrap">
                                            <CardHeader className="flex h-fit flex-col gap-3">
                                                <CardTitle className="flex items-center gap-2 text-title font-semibold">
                                                    <StarFour
                                                        size={30}
                                                        weight="fill"
                                                        className="text-primary-500"
                                                    />
                                                    {t('vsmartExtract.title')}
                                                    <p className="text-body">
                                                        {t('vsmartExtract.subtitle')}
                                                    </p>
                                                </CardTitle>
                                                <CardDescription>
                                                    {t('vsmartExtract.description')}
                                                </CardDescription>
                                            </CardHeader>
                                        </Card>
                                    </DialogTrigger>
                                    <DialogContent className="no-scrollbar !m-0 flex h-full !w-full !max-w-full flex-col !gap-0 overflow-y-auto !rounded-none !p-0">
                                        <AICenterProvider>
                                            <GenerateAiQuestionPaperComponent
                                                form={bridgeForm}
                                                currentSectionIndex={0}
                                            />
                                        </AICenterProvider>
                                    </DialogContent>
                                </Dialog>

                                {/* VSmart Image */}
                                <Dialog open={isImageOpen} onOpenChange={setIsImageOpen}>
                                    <DialogTrigger asChild>
                                        <Card className="flex h-fit w-full cursor-pointer items-center justify-center gap-10 border-neutral-300 bg-neutral-50 text-neutral-600 sm:flex-wrap md:flex-nowrap">
                                            <CardHeader className="flex h-fit flex-col gap-3">
                                                <CardTitle className="flex items-center gap-2 text-title font-semibold">
                                                    <StarFour
                                                        size={30}
                                                        weight="fill"
                                                        className="text-primary-500"
                                                    />
                                                    {t('vsmartImage.title')}
                                                    <p className="text-body">
                                                        {t('vsmartImage.subtitle')}
                                                    </p>
                                                </CardTitle>
                                                <CardDescription>
                                                    {t('vsmartImage.description')}
                                                </CardDescription>
                                            </CardHeader>
                                        </Card>
                                    </DialogTrigger>
                                    <DialogContent className="no-scrollbar !m-0 flex h-full !w-full !max-w-full flex-col !gap-0 overflow-y-auto !rounded-none !p-0">
                                        <AICenterProvider>
                                            <GenerateAiQuestionFromImageComponent
                                                form={bridgeForm}
                                                currentSectionIndex={0}
                                            />
                                        </AICenterProvider>
                                    </DialogContent>
                                </Dialog>
                            </div>
                        </DialogContent>
                    </Dialog>
                </div>
            </AlertDialogContent>
        </AlertDialog>
    );
};

export default QuizAddViaAIDialog;
